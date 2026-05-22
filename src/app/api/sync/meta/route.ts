// Sync worker: Meta Ads → Supabase `t02_ads` table.
//
// Default (daily cron): pulls yesterday's data only so each day is fully
// accurate once the day is complete.
//
// Query params:
//   ?backfill=N — pull last N days (e.g. ?backfill=90 for historical fill)

import { NextRequest, NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import type { Ad } from '@/lib/types';

/**
 * Map a camelCase Ad object to the snake_case columns in Supabase `t02_ads`.
 */
function adToRow(ad: Ad) {
  return {
    id: ad.id,
    date: ad.date || null,
    ad_account_name: ad.adAccountName || '',
    campaign_name: ad.campaignName || '',
    ad_set_name: ad.adSetName || '',
    ad_name: ad.adName || '',
    campaign_id: ad.campaignId || null,
    ad_set_id: ad.adSetId || null,
    ad_id: ad.adId || null,
    channel: ad.channel || 'Facebook Ads',
    spend: ad.spend ?? 0,
    impressions: ad.impressions ?? 0,
    clicks: ad.clicks ?? 0,
    leads: ad.leads ?? 0,
    scheduled_calls: ad.scheduledCalls ?? 0,
    qualified_calls: ad.qualifiedCalls ?? 0,
    purchases: ad.purchases ?? 0,
    revenue: ad.revenue ?? 0,
    active: ad.active ?? true,
    updated_at: new Date().toISOString(),
    cost_per_lead: ad.costPerLead ?? null,
    meta_leads: ad.metaLeads ?? null,
    cost_per_result: ad.costPerResult ?? null,
    actions: ad.actions ?? null,
    action_values: ad.actionValues ?? null,
  };
}

/** YYYY-MM-DD for a Date object */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function handler(req: NextRequest) {
  const url = new URL(req.url);
  const backfillDays = url.searchParams.get('backfill');

  const result = await runSync('meta-ads', async (sb) => {
    const metaToken = process.env.META_ACCESS_TOKEN;
    const metaAccountId = process.env.META_AD_ACCOUNT_ID;
    if (!metaToken || !metaAccountId) {
      throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID must be set');
    }

    const { fetchMetaInsights } = await import('@/lib/mappers/meta');

    let ads: Ad[];
    if (backfillDays) {
      // Historical backfill: pull last N days
      const n = Math.min(parseInt(backfillDays, 10) || 30, 180);
      console.log(`[sync/meta] Backfill mode: pulling last ${n} days`);
      ads = await fetchMetaInsights(metaToken, metaAccountId, `last_${n}d`);
    } else {
      // Daily mode: pull yesterday only (fully complete day)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = fmtDate(yesterday);
      console.log(`[sync/meta] Daily mode: pulling ${dateStr}`);
      ads = await fetchMetaInsights(metaToken, metaAccountId, undefined, {
        since: dateStr,
        until: dateStr,
      });
    }

    if (ads.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    const rows = ads.map(adToRow);

    // Upsert in batches of 100
    let upserted = 0;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from('t02_ads')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(`[sync/meta] Upserted ${upserted} ads to Supabase`);

    // --- Enrich performance columns from t01_leads / t03_bookings / t06_deals_closed ---
    // Attribution is by the day the LEAD arrived (cohort attribution), not the
    // day a downstream deal closed. Runs over the last 90 days so late-arriving
    // bookings and deals get re-attributed to the correct ad-day.
    const { error: enrichErr } = await (sb as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error?: { message: string } }>;
    }).rpc('enrich_t02_ads_performance', { lookback_days: 90 });
    if (enrichErr) {
      console.error('[sync/meta] enrichment RPC failed:', enrichErr.message);
    } else {
      console.log('[sync/meta] Enriched t02_ads performance (90d cohort attribution)');
    }

    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
