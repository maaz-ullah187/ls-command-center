/**
 * GET /api/commissions/report?start=2026-04-01&end=2026-04-30
 *
 * Returns a full CommissionReport for the given period. Pulls:
 *   - t06_deals_closed (deals closed in period)
 *   - t07_income_processors (payments in period, for CSM renewals + IG DM closer)
 *   - t02_ads (ad spend in period, for marketing manager's profit calc)
 *
 * Stateless — does not mark anything as paid. The UI layer posts to a separate
 * /api/commissions/mark-paid endpoint once the operator confirms payout.
 *
 * Defaults: current calendar month.
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { calculateCommissions, type DealRow, type PaymentRow, type AdSpendRow } from '@/lib/commissions/calculate';

export const maxDuration = 60;

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchAllPages<T>(
  sb: Awaited<ReturnType<typeof getServerSupabaseAsync>>,
  table: string,
  select: string,
  filters: (q: unknown) => unknown,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 20; page++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = sb!.from(table).select(select);
    q = filters(q);
    q = q.range(page * pageSize, (page + 1) * pageSize - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start') ?? firstOfMonth();
  const end = url.searchParams.get('end') ?? today();

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  // ─── Deals in period ──────────────────────────────────────────────────────
  const deals = await fetchAllPages<DealRow & { slack_ts: string | null; close_path: string | null; deal_type: string | null }>(
    sb,
    't06_deals_closed',
    'id,date_closed,name,email,offer,cash_collected,contracted_revenue,source,closer,slack_ts,close_path,deal_type',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q.gte('date_closed', start).lte('date_closed', end),
  );

  // ─── t20 payment_structure (authoritative — from Slack #new-clients) ──────
  // Needed for accurate Split-It + PIF detection. t07.payment_structure is
  // hard-coded to "Full Pay" by the Whop sync and can't distinguish structures.
  const newClientRows = await fetchAllPages<{ slack_ts: string; payment_structure: string | null }>(
    sb,
    't20_slack_new_clients',
    'slack_ts,payment_structure',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q,
  );
  const psByT20Ts = new Map<string, string>();
  for (const r of newClientRows) {
    if (r.slack_ts && r.payment_structure) psByT20Ts.set(r.slack_ts, r.payment_structure);
  }

  // ─── Payments in period (for CSM renewals + IG DM closer) ─────────────────
  // Pull a wider window — we still need to attribute recurring payments that
  // happen mid-period even if the original deal closed earlier.
  const rawPayments = await fetchAllPages<PaymentRow & { payment_structure: string }>(
    sb,
    't07_income_processors',
    'id,date,email,amount,final_amount,status,payment_type,payment_structure,offer,processor,deal_id',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q.gte('date', start).lte('date', end),
  );

  // Authoritative payment_structure source is t20 (Slack #new-clients parse).
  // Join via t06.slack_ts = t20.slack_ts.
  const dealsWithStructure = deals.map(d => ({
    ...d,
    payment_structure: (d.slack_ts && psByT20Ts.get(d.slack_ts)) ?? null,
  }));

  // ─── Ad spend in period (marketing manager) ──────────────────────────────────────────
  const adSpendRows = await fetchAllPages<{ date: string; spend: number | string }>(
    sb,
    't02_ads',
    'date,spend',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q: any) => q.gte('date', start).lte('date', end),
  );
  const adSpend: AdSpendRow[] = adSpendRows.map(r => ({
    date: r.date,
    spend: Number(r.spend ?? 0),
  }));

  // ─── Calculate ────────────────────────────────────────────────────────────
  const report = calculateCommissions({
    periodStart: start,
    periodEnd: end,
    deals: dealsWithStructure,
    payments: rawPayments,
    adSpend,
  });

  return NextResponse.json(report);
}

export const POST = GET;
