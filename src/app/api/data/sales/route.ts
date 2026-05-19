/**
 * GET /api/data/sales?start=2026-04-01&end=2026-04-30&limit=500
 *
 * Every row = one closed deal. Pulled DIRECTLY from t06_deals_closed
 * (no GHL API calls, no mock data). Enriched with lead-level source +
 * contact link via a t01_leads join.
 *
 * the operator rule (2026-04-23): this dashboard is a MIRROR of the Supabase
 * tables. If a row exists in t06, it must show here. If t06 is empty, this
 * endpoint returns empty — never mocks / never falls back.
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = sb
    .from('t06_deals_closed')
    .select(
      'id,date_closed,name,email,phone,offer,cash_collected,contracted_revenue,source,closer,' +
      'deal_type,close_path,payment_plan,sales_call_recording,why_they_bought,slack_ts,lead_id,' +
      'campaign_name,ad_set_name,ad_name,ghl_contact_id'
    )
    .order('date_closed', { ascending: false })
    .limit(limit);
  if (start) q = q.gte('date_closed', start);
  if (end) q = q.lte('date_closed', end);

  const { data: deals, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with lead_source + contact_link from t01_leads if lead_id set
  const leadIds = [...new Set((deals ?? []).map((d: { lead_id: string | null }) => d.lead_id).filter(Boolean))] as string[];
  const leadById = new Map<string, { source: string | null; contact_link: string | null }>();
  if (leadIds.length > 0) {
    for (let i = 0; i < leadIds.length; i += 200) {
      const chunk = leadIds.slice(i, i + 200);
      const { data: leads } = await sb
        .from('t01_leads')
        .select('id, source, contact_link')
        .in('id', chunk);
      for (const l of leads ?? []) {
        leadById.set(l.id, { source: l.source, contact_link: l.contact_link });
      }
    }
  }

  const enriched = (deals ?? []).map((d: Record<string, unknown>) => {
    const lead = d.lead_id ? leadById.get(d.lead_id as string) : null;
    return {
      ...d,
      // Number-coerce currency fields (Supabase returns numeric as strings)
      cash_collected: Number(d.cash_collected ?? 0),
      contracted_revenue: Number(d.contracted_revenue ?? 0),
      // Enrichment
      lead_source: lead?.source ?? null,
      contact_link: lead?.contact_link ?? null,
    };
  });

  // Summary stats (computed in SQL land rather than on the client for consistency)
  const summary = {
    deal_count: enriched.length,
    total_cash: enriched.reduce((s: number, d: { cash_collected: number }) => s + d.cash_collected, 0),
    total_contracted: enriched.reduce((s: number, d: { contracted_revenue: number }) => s + d.contracted_revenue, 0),
    new_count: enriched.filter((d: { deal_type: string | null }) => d.deal_type === 'new').length,
    upsell_count: enriched.filter((d: { deal_type: string | null }) => d.deal_type === 'upsell').length,
    renewal_count: enriched.filter((d: { deal_type: string | null }) => d.deal_type === 'renewal').length,
  };

  return NextResponse.json({ deals: enriched, summary });
}
