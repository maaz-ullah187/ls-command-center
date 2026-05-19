import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

/**
 * GET /api/data/missing-expense-types
 *
 * Surfaces t08_expenses rows where expense_type IS NULL OR expense_type = 'unknown'.
 * Each row becomes a Daily Review Queue item under "Uncategorized Expense".
 *
 * Constraints:
 *   - date >= 2026-04-01 (per the spec: only backlog from April 2026 onward;
 *     historical rows aren't actionable for the team)
 *
 * Paginates server-side to return EVERY relevant row.
 */
const BACKLOG_FLOOR = '2026-04-01';

interface MissingExpense {
  id: string;
  date: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  expenseType: string | null;
  card: string | null;
}

export async function GET(_req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ rows: [], configured: false });
  }

  // Paginate — PostgREST default cap is 1000 per page.
  type DbRow = {
    id: string;
    date: string;
    amount: number | string | null;
    transaction_name: string | null;
    expense_type: string | null;
    card_name: string | null;
    card_last_four: string | null;
    notes: string | null;
  };
  const all: DbRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('t08_expenses')
      .select('id, date, amount, transaction_name, expense_type, card_name, card_last_four, notes')
      .gte('date', BACKLOG_FLOOR)
      .or('expense_type.is.null,expense_type.eq.unknown')
      .order('date', { ascending: false })
      .range(from, from + 999);
    if (error) {
      return NextResponse.json(
        { rows: [], error: error.message ?? 'query_failed' },
        { status: 502 }
      );
    }
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < 1000) break;
  }

  const rows: MissingExpense[] = all.map((r: any) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount ?? 0),
    vendor: r.transaction_name ?? null,
    description: r.notes ?? null,
    expenseType: r.expense_type ?? null,
    card: r.card_name
      ? r.card_last_four
        ? `${r.card_name} (•${r.card_last_four})`
        : r.card_name
      : null,
  }));

  return NextResponse.json({ rows, configured: true, count: rows.length });
}
