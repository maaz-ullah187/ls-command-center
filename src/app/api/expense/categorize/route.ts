import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { rememberVendor } from '@/lib/vendorMemory';

export const dynamic = 'force-dynamic';

/**
 * POST /api/expense/categorize
 * Body: { id: string, expense_type: 'labour'|'marketing'|'overhead'|'mastermind'|'other'|'unknown'|"personal (shouldn't be there)" }
 *
 * Updates t08_expenses.expense_type for a single row. Used by:
 *   - Uncategorized Expense queue (Daily Review Queue inline dropdown)
 *   - Future: Expenses tab dropdown UI
 *
 * Why direct UPDATE instead of t16_overrides:
 *   expense_type is itself a categorization field, not a source-of-truth
 *   value being corrected. The Mercury sync writes its best guess; humans
 *   correct it. The "corrected" value IS the value going forward, so
 *   storing it on t08_expenses directly is the right shape.
 */

const ALLOWED = new Set([
  'labour',          // displayed as "Labor" in UI; DB keeps original spelling
  'marketing',
  'overhead',
  'coaching',
  'mastermind',
  'other',
  'unknown',
  "personal (shouldn't be there)",
]);

export async function POST(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });
  }

  let body: { id?: string; expense_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const id = body.id?.trim();
  const expense_type = body.expense_type?.trim();
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  if (!expense_type || !ALLOWED.has(expense_type)) {
    return NextResponse.json(
      { ok: false, error: `expense_type must be one of: ${Array.from(ALLOWED).join(', ')}` },
      { status: 400 }
    );
  }

  const { data, error } = await supa
    .from('t08_expenses')
    .update({ expense_type, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, expense_type, transaction_name')
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Teach the vendor memory so future Mercury syncs auto-classify the same
  // vendor without surfacing a queue item. Skips 'unknown' / 'other' since
  // those don't represent a real categorization decision.
  if (
    expense_type !== 'unknown' &&
    expense_type !== 'other' &&
    data?.transaction_name
  ) {
    try {
      await rememberVendor(supa, data.transaction_name, expense_type);
    } catch {
      /* swallow — vendor memory is best-effort */
    }
  }

  return NextResponse.json({ ok: true, row: data });
}
