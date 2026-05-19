import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

/**
 * GET /api/data/missing-billing-types
 *
 * Surfaces t07_income_processors rows that need human categorization:
 *   - payment_type IS NULL OR payment_type = 'other' (uncategorized)
 *
 * Constraints:
 *   - status = 'paid' (pending invoices excluded; surface once paid)
 *   - date >= 2026-04-01 (only backlog from April 2026 onward)
 *   - payment_type != 'excluded' (rows marked "Remove" are hidden)
 *   - amount > $1 (skip $0/$1 charges — not worth team's time per the spec)
 *   - offer IS NULL filter REMOVED — categorizing payment_type alone now
 *     drops the row from the queue, since offer often stays NULL (e.g.
 *     wires posted via Slack), and forcing that field to be set would
 *     make rows reappear after the team already categorized payment_type.
 *
 * Paginates server-side to return EVERY relevant row — no cap.
 */
const BACKLOG_FLOOR = '2026-04-01';
const MIN_AMOUNT = 1; // exclude charges <= $1 (test transactions, tiny refunds)

interface MissingBilling {
  id: string;
  date: string;
  amount: number;
  email: string | null;
  name: string | null;
  paymentType: string | null;
  offer: string | null;
  closer: string | null;
  source: 'whop' | 'fanbasis' | 'slack' | string;
}

export async function GET(_req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], configured: false });
  }

  // Surface rows that need a human decision:
  //   payment_type NULL or 'other' (explicit uncategorized state)
  //   OR offer NULL
  // Limit to paid rows so pending invoices don't pile up.
  // Paginate — PostgREST default cap is 1000 per page.
  type DbRow = {
    id: string;
    date: string;
    amount: number | string | null;
    final_amount: number | string | null;
    email: string | null;
    name: string | null;
    payment_type: string | null;
    offer: string | null;
    closer: string | null;
    processor: string | null;
    status: string | null;
  };
  const all: DbRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('t07_income_processors')
      .select('id, date, amount, final_amount, email, name, payment_type, offer, closer, processor, status')
      .eq('status', 'paid')
      .gte('date', BACKLOG_FLOOR)
      .or('payment_type.is.null,payment_type.eq.other')
      .order('date', { ascending: false })
      .range(from, from + 999);
    if (error) {
      return NextResponse.json({ rows: [], error: error.message ?? 'query_failed' }, { status: 502 });
    }
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < 1000) break;
  }

  // Drop excluded rows + charges ≤ $1 (per the spec: not worth categorizing
  // tiny test transactions / refunds-of-pennies).
  const rows: MissingBilling[] = all
    .filter((r: any) => {
      if (r.payment_type === 'excluded') return false;
      const amt = Number(r.final_amount ?? r.amount ?? 0);
      if (amt <= MIN_AMOUNT) return false;
      return true;
    })
    .map((r: any) => ({
    id: r.id,
    date: r.date,
    // final_amount is post-fee net; fall back to amount if missing
    amount: Number(r.final_amount ?? r.amount ?? 0),
    email: r.email ?? null,
    name: r.name ?? null,
    paymentType: r.payment_type ?? null,
    offer: r.offer ?? null,
    closer: r.closer ?? null,
    source: r.processor ?? 'unknown',
  }));

  return NextResponse.json({ rows, configured: true, count: rows.length });
}
