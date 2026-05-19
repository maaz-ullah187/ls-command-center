import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/data/t06-anomalies?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Per-deal anomaly detector for t06_deals_closed (the Slack #new-clients
 * source-of-truth table). Flags rows that look like a closer typed
 * something wrong when posting the deal:
 *
 *   1. cash_collected > contracted_revenue  → almost certainly a swap or
 *      an extra zero (e.g. Sample Lead 4 04-01: $50k cash on a $5k
 *      Program A Lower-Ticket — should be $5k cash).
 *   2. cash_collected > 0 but contracted_revenue = 0  → contract amount
 *      was forgotten on the post.
 *   3. Both cash_collected and contracted_revenue = 0  → empty deal row.
 *   4. Source is null/blank  → closer skipped the source field.
 *
 * Surfaces in the Daily Review Queue's Data Anomalies tab via
 * ReviewQueueBanner so the operator can spot them and either fix the row
 * directly in Supabase / re-post in #new-clients, or excuse the
 * anomaly if the data is genuinely correct.
 *
 * the operator 2026-04-29: "if you ever see anything like this in the
 * future, that's a prime example of something that would go under the
 * data anomalies section."
 */

interface T06Anomaly {
  dealId: string;
  date: string;
  customerName: string;
  customerEmail: string | null;
  closer: string | null;
  cash: number;
  contracted: number;
  source: string | null;
  offer: string | null;
  kind:
    | 'cash_exceeds_contracted'
    | 'missing_contracted'
    | 'empty_amounts'
    | 'missing_source';
  issue: string;
  /** Suggested fix where one is obvious. */
  suggestedFix: string | null;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function thisMonthBounds(): { from: string; to: string } {
  const d = new Date();
  const year = d.getFullYear();
  const mo = d.getMonth();
  const last = new Date(year, mo + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${year}-${pad(mo + 1)}-01`,
    to: `${year}-${pad(mo + 1)}-${pad(last)}`,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const def = thisMonthBounds();
  const from = url.searchParams.get('from') || def.from;
  const to = url.searchParams.get('to') || def.to;

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], configured: false });
  }

  const { data: deals, error } = await supa
    .from('t06_deals_closed')
    .select('id, date_closed, name, email, closer, cash_collected, contracted_revenue, source, offer')
    .gte('date_closed', from)
    .lte('date_closed', to)
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message ?? 'query_failed', rows: [] }, { status: 502 });
  }

  const rows: T06Anomaly[] = [];

  for (const d of (deals ?? []) as Array<{
    id: string;
    date_closed: string;
    name: string | null;
    email: string | null;
    closer: string | null;
    cash_collected: number | string | null;
    contracted_revenue: number | string | null;
    source: string | null;
    offer: string | null;
  }>) {
    const cash = Number(d.cash_collected ?? 0);
    const contracted = Number(d.contracted_revenue ?? 0);
    const source = (d.source || '').trim();

    const base = {
      dealId: d.id,
      date: d.date_closed,
      customerName: d.name ?? '(no name)',
      customerEmail: d.email,
      closer: d.closer,
      cash,
      contracted,
      source: d.source,
      offer: d.offer,
    };

    // 1. cash > contracted — almost always a typo (extra zero or swap).
    //    Threshold: ratio > 1.5 catches the obvious cases without false-
    //    flagging legitimate "paid more than agreed" upsell scenarios
    //    which we expect to be near-equal.
    if (cash > 0 && contracted > 0 && cash > contracted * 1.5) {
      const suggestedFix =
        cash >= contracted * 9 && cash <= contracted * 11
          ? `Cash collected (${fmt(cash)}) is ~10× contracted (${fmt(contracted)}) — extra zero typo? Probable correct cash: ${fmt(cash / 10)}`
          : `Cash collected (${fmt(cash)}) > contracted revenue (${fmt(contracted)}) — values likely swapped at entry. Probable correct cash: ${fmt(contracted)}`;
      rows.push({
        ...base,
        kind: 'cash_exceeds_contracted',
        issue: `Cash > contracted: ${fmt(cash)} cash on a ${fmt(contracted)} contract`,
        suggestedFix,
      });
      continue;
    }

    // 2. Cash collected but contract is zero — closer forgot total
    if (cash > 0 && contracted === 0) {
      rows.push({
        ...base,
        kind: 'missing_contracted',
        issue: `Cash collected (${fmt(cash)}) but contracted revenue is $0 — total deal value missing`,
        suggestedFix: 'Have the closer re-post in #new-clients with the contracted amount.',
      });
      continue;
    }

    // 3. Both zero — empty deal row
    if (cash === 0 && contracted === 0) {
      rows.push({
        ...base,
        kind: 'empty_amounts',
        issue: 'Both cash and contracted revenue are $0 — empty deal row',
        suggestedFix: 'Verify with the closer or remove the row.',
      });
      continue;
    }

    // 4. Source missing
    if (!source) {
      rows.push({
        ...base,
        kind: 'missing_source',
        issue: 'Source field is blank — closer skipped lead-source attribution',
        suggestedFix: 'Have the closer add a source to this deal.',
      });
      continue;
    }
  }

  // Also scan t07 for payment_type / offer mismatches: if the offer name
  // mentions 'renewal'/'upsell'/'mastermind' but payment_type doesn't
  // match, flag it. This catches the case the operator 2026-04-29 hit where
  // 13 'Renewal' offers were tagged new_client/AR by the auto-classify
  // backfill and silently under-counted upsell_renewal by ~$3.6k.
  const { data: t07Rows } = await supa
    .from('t07_income_processors')
    .select('id, name, email, date, final_amount, amount, payment_type, offer, status')
    .gte('date', from)
    .lte('date', to)
    .eq('status', 'paid')
    .limit(5000);

  for (const r of (t07Rows ?? []) as Array<{
    id: string; name: string | null; email: string | null; date: string;
    final_amount: number | string | null; amount: number | string | null;
    payment_type: string | null; offer: string | null;
  }>) {
    const offer = (r.offer || '').toLowerCase();
    const pt = (r.payment_type || '').toLowerCase();
    if (!offer) continue;
    const expectedFromOffer =
      offer.includes('renew') || offer.includes('upsell') || offer.includes('upgrade')
        ? 'upsell_renewal'
        : offer.includes('mastermind')
        ? 'mastermind'
        : null;
    if (expectedFromOffer && pt !== expectedFromOffer && pt !== 'refund' && pt !== 'excluded') {
      const amt = Number(r.final_amount ?? r.amount ?? 0);
      rows.push({
        dealId: `t07-${r.id}`,
        date: r.date,
        customerName: r.name ?? '(no name)',
        customerEmail: r.email,
        closer: null,
        cash: amt,
        contracted: 0,
        source: null,
        offer: r.offer,
        kind: 'cash_exceeds_contracted', // re-use existing kind for UI consistency
        issue: `Payment-type mismatch: offer says "${r.offer}" but tagged as "${r.payment_type ?? 'NULL'}"`,
        suggestedFix: `Re-categorize this row as ${expectedFromOffer === 'upsell_renewal' ? 'Upsell/Renewal' : 'Mastermind'} via the Uncategorized Billing queue.`,
      });
    }
  }

  return NextResponse.json({
    rows,
    window: { from, to },
    configured: true,
    debug: { dealsScanned: deals?.length ?? 0, anomalies: rows.length },
  });
}
