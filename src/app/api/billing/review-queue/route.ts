// API: Payment Review Queue
//   GET   → list every pending_review payment from Whop/Fanbasis.
//   POST  → approve one payment + set its payment_type from the operator's choice.
//
// All paths gate on review_status='pending_review' so the queue shrinks as
// items are authorized. Once approved, the row's payment_type is locked in
// and the main dashboard's revenue cards start counting it.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

interface QueueRow {
  id: string;
  date: string;
  name: string | null;
  email: string | null;
  amount: number | null;
  final_amount: number | null;
  processor: string;
  payment_type: string | null;
  status: string;
  offer: string | null;
}

// Map the operator's two UI choices to canonical t07 payment_type values.
// "Backend Revenue" on the dashboard = AR + upsell/renewal + mastermind +
// uncategorized — the most common single source is account_receivable
// (recurring installments), so that's the canonical landing bucket.
const CHOICE_TO_PAYMENT_TYPE: Record<string, string> = {
  new_cash: 'new_client',
  backend_revenue: 'account_receivable',
};

export async function GET() {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ rows: [], count: 0, configured: false });

  const { data, error } = await sb
    .from('t07_income_processors')
    .select('id, date, name, email, amount, final_amount, processor, payment_type, status, offer')
    .eq('review_status', 'pending_review')
    .in('processor', ['whop', 'fanbasis'])
    .order('date', { ascending: false })
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const rows = (data ?? []) as QueueRow[];
  return NextResponse.json({ rows, count: rows.length, configured: true });
}

export async function POST(req: NextRequest) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });

  let body: { id?: string; choice?: string; payment_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { id, choice, payment_type } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  // Resolve the target payment_type. Operator can pass either a UI choice
  // (`new_cash` / `backend_revenue`) or a raw payment_type string for
  // power-user / scripting flows.
  let targetPaymentType: string | null = null;
  if (choice && CHOICE_TO_PAYMENT_TYPE[choice]) {
    targetPaymentType = CHOICE_TO_PAYMENT_TYPE[choice];
  } else if (payment_type && typeof payment_type === 'string') {
    targetPaymentType = payment_type;
  } else {
    return NextResponse.json({ error: 'missing_choice_or_payment_type' }, { status: 400 });
  }

  const { error } = await sb
    .from('t07_income_processors')
    .update({
      review_status: 'approved',
      payment_type: targetPaymentType,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id, review_status: 'approved', payment_type: targetPaymentType });
}

/**
 * DELETE /api/billing/review-queue
 *   body: { id: string }
 *
 * Hard-deletes a row from t07_income_processors. Used by the Payment Review
 * page when an operator wants to remove a payment entirely (e.g. duplicate,
 * test charge, wrong account) rather than authorize it.
 *
 * Unlike "mark excluded" via POST + payment_type='excluded' (which keeps the
 * audit trail), DELETE is permanent. The operator confirms in the UI before
 * this fires.
 */
export async function DELETE(req: NextRequest) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { id } = body;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }

  const { error } = await sb
    .from('t07_income_processors')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, id });
}
