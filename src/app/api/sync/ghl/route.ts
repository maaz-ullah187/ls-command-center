// Sync worker: GHL leads → Supabase `t01_leads` table.
// Simplified: only syncs clean lead data (who came in the door).
// All enrichment (Calendly, Grain, Whop, Slack) feeds other tables.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import type { Lead } from '@/lib/types';

/**
 * Map a camelCase Lead object to the snake_case columns in Supabase `t01_leads`.
 * Core columns + attribution IDs + timestamps.
 */
function leadToRow(lead: Lead) {
  return {
    id: lead.id,
    date: lead.date,
    name: lead.name,
    email: lead.email,
    phone: lead.phone || null,
    app_answers: lead.appAnswers || null,
    campaign_name: lead.campaignName || null,
    ad_set_name: lead.adSetName || null,
    ad_name: lead.adName || null,
    campaign_id: lead.campaignId || null,
    ad_set_id: lead.adSetId || null,
    ad_id: lead.adId || null,
    source: lead.source,
    contact_link: lead.contactLink || null,
    offer: lead.offer || null,
    updated_at: new Date().toISOString(),
  };
}

export async function POST() {
  const result = await runSync('ghl-leads', async (sb) => {
    const ghlToken = process.env.GHL_API_KEY;
    const ghlLocation = process.env.GHL_LOCATION_ID;
    if (!ghlToken || !ghlLocation) {
      throw new Error('GHL_API_KEY and GHL_LOCATION_ID must be set');
    }

    const { fetchGHLLeads } = await import('@/lib/mappers/ghl');
    const leads = await fetchGHLLeads(ghlToken, ghlLocation);

    const rows = leads.map(leadToRow);
    if (rows.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    // Fetch existing overrides for source + offer columns (manual fixes by team)
    const { data: overrides } = await sb
      .from('t16_overrides')
      .select('row_id, field, corrected')
      .eq('table_name', 't01_leads')
      .in('field', ['source', 'offer']);
    // Map: row_id → { source?: string, offer?: string }
    const overrideMap = new Map<string, Record<string, string>>();
    if (overrides) {
      for (const o of overrides) {
        const existing = overrideMap.get(o.row_id) || {};
        existing[o.field] = String(o.corrected);
        overrideMap.set(o.row_id, existing);
      }
    }

    // Apply overrides before upserting
    for (const row of rows) {
      const ov = overrideMap.get(row.id as string);
      if (ov) {
        if (ov.source) (row as any).source = ov.source;
        if (ov.offer) (row as any).offer = ov.offer;
      }
    }

    // Upsert in batches of 100
    let upserted = 0;
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await sb
        .from('t01_leads')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(`[sync/ghl] Upserted ${upserted} leads to Supabase`);

    // --- Backfill attribution IDs from t02_ads ---
    // GHL stores the Meta ad ID in the lead's ad_name field (numeric string like
    // "120243164282210373"), and sometimes the campaign ID in campaign_name.
    // We join lead.ad_name → ad.ad_id to resolve all three IDs reliably.
    const { data: adsWithIds } = await sb
      .from('t02_ads')
      .select('campaign_name, campaign_id, ad_set_name, ad_set_id, ad_name, ad_id')
      .not('ad_id', 'is', null);

    if (adsWithIds && adsWithIds.length > 0) {
      // Primary lookup: Meta ad_id → full attribution (campaign_id, ad_set_id, ad_id)
      const adIdLookup = new Map<string, { campaign_id: string; ad_set_id: string; ad_id: string }>();
      // Secondary lookups: name → ID (for leads where GHL has real names)
      const campaignNameToId = new Map<string, string>();
      const adSetNameToId = new Map<string, string>();

      for (const ad of adsWithIds) {
        if (ad.ad_id && !adIdLookup.has(ad.ad_id)) {
          adIdLookup.set(ad.ad_id, {
            campaign_id: ad.campaign_id,
            ad_set_id: ad.ad_set_id,
            ad_id: ad.ad_id,
          });
        }
        if (ad.campaign_name && ad.campaign_id && !campaignNameToId.has(ad.campaign_name)) {
          campaignNameToId.set(ad.campaign_name, ad.campaign_id);
        }
        if (ad.ad_set_name && ad.ad_set_id && !adSetNameToId.has(ad.ad_set_name)) {
          adSetNameToId.set(ad.ad_set_name, ad.ad_set_id);
        }
      }

      // Find leads missing ad_id
      const { data: leadsNeedingIds } = await sb
        .from('t01_leads')
        .select('id, campaign_name, ad_set_name, ad_name')
        .is('ad_id', null);

      const isNumericId = (s: string) => /^\d{10,}$/.test(s);
      let backfilled = 0;
      if (leadsNeedingIds) {
        for (const lead of leadsNeedingIds) {
          let cId: string | undefined;
          let asId: string | undefined;
          let aId: string | undefined;

          // GHL ad_name is usually the Meta ad_id — primary join
          if (lead.ad_name && isNumericId(lead.ad_name)) {
            const match = adIdLookup.get(lead.ad_name);
            if (match) {
              cId = match.campaign_id;
              asId = match.ad_set_id;
              aId = match.ad_id;
            } else {
              // ad_name IS the ad_id even if we don't have it in ads table yet
              aId = lead.ad_name;
            }
          }

          // campaign_name might already be a numeric campaign ID
          if (!cId && lead.campaign_name) {
            if (isNumericId(lead.campaign_name)) {
              cId = lead.campaign_name;
            } else {
              cId = campaignNameToId.get(lead.campaign_name);
            }
          }

          // ad_set_name: try name lookup
          if (!asId && lead.ad_set_name) {
            asId = adSetNameToId.get(lead.ad_set_name);
          }

          if (cId || asId || aId) {
            await sb
              .from('t01_leads')
              .update({
                campaign_id: cId || null,
                ad_set_id: asId || null,
                ad_id: aId || null,
              })
              .eq('id', lead.id);
            backfilled++;
          }
        }
      }
      console.log(`[sync/ghl] Backfilled attribution IDs on ${backfilled} leads (from ${adIdLookup.size} ads, ${campaignNameToId.size} campaigns, ${adSetNameToId.size} ad sets)`);
    }

    // --- Promote Unknown → Facebook Ads when numeric Meta campaign_id is set ---
    // Only accepts numeric Meta campaign IDs (10+ digits). `workflow_*` IDs
    // from GHL automations are NOT ad evidence. Respect ProgB organic-only rule.
    const { data: unknownWithMetaCid } = await sb
      .from('t01_leads')
      .select('id, campaign_id, offer')
      .eq('source', 'Unknown')
      .not('campaign_id', 'is', null);

    if (unknownWithMetaCid && unknownWithMetaCid.length > 0) {
      const ids = unknownWithMetaCid
        .filter((r: { id: string; campaign_id: string | null; offer: string | null }) =>
          r.campaign_id && /^\d{10,}$/.test(r.campaign_id) && r.offer !== 'ProgB',
        )
        .map((r: { id: string }) => r.id);
      if (ids.length > 0) {
        const { error: promoteErr } = await sb
          .from('t01_leads')
          .update({ source: 'Facebook Ads', updated_at: new Date().toISOString() })
          .in('id', ids);
        if (promoteErr) throw promoteErr;
        console.log(`[sync/ghl] Promoted ${ids.length} Unknown→Facebook Ads (Meta campaign_id populated)`);
      }
    }

    // --- Post-insert junk cleanup ---
    // The pre-insert junk filter in fetchGHLLeads() blocks NEW junk leads, but
    // existing rows in t01_leads from before the filter was tightened (or that
    // slipped through prior, looser pattern matching) live forever unless we
    // re-scan. Run isJunkPerson() against every row and delete matches.
    // the operator 2026-04-28: targets test/dummy/fake +alias Gmail addresses,
    // junk names like "test test", placeholder domains, etc.
    const { isJunkPerson } = await import('@/lib/mappers/ghl');
    const { data: allLeadRows } = await sb
      .from('t01_leads')
      .select('id, name, email, phone');

    if (allLeadRows && allLeadRows.length > 0) {
      const junkIds = allLeadRows
        .filter((r: { id: string; name: string | null; email: string | null; phone: string | null }) =>
          isJunkPerson({ name: r.name, email: r.email, phone: r.phone }),
        )
        .map((r: { id: string }) => r.id);
      if (junkIds.length > 0) {
        // Delete in batches to stay under any per-statement size limits
        const BATCH_DEL = 100;
        let deleted = 0;
        for (let i = 0; i < junkIds.length; i += BATCH_DEL) {
          const slice = junkIds.slice(i, i + BATCH_DEL);
          const { error: delErr } = await sb
            .from('t01_leads')
            .delete()
            .in('id', slice);
          if (delErr) throw delErr;
          deleted += slice.length;
        }
        console.log(`[sync/ghl] Deleted ${deleted} junk leads from t01_leads`);
      }
    }

    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron calls GET — alias to the same handler
export { POST as GET };
