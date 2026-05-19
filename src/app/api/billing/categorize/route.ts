import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/categorize
 *
 * Body: { rowId: string, paymentType: string, offer?: string|null }
 *
 * Updates t07_income_processors directly. This is the manual-categorization
 * endpoint for the BillingTracker dropdown + the Daily Review Queue's
 * Uncategorized Billing tab.
 *
 * Why direct write (and not the t16_overrides pattern):
 *   payment_type isn't a source-data correction — there's no upstream "truth"
 *   from Whop/Fanbasis that tells us whether a payment is Mastermind vs AR vs
 *   Upsell. Categorization is an authored signal, like t21_monthly_projections.
 *   Per the operator: "we update it there it should immediately update it in
 *   superbase again it's like a mirroring section".
 *
 * Allowed canonical buckets:
 *   new_client | account_receivable | upsell_renewal | mastermind | refund | excluded | other
 *
 * 'excluded' = the operator's "Remove" button: payment landed in the processor but
 * shouldn't have (wrong business / mis-routed wire / test charge). Audit
 * trail stays in t07; revenue cards filter this bucket out.
 */
const ALLOWED = new Set([
  'new_client',
  'account_receivable',
  'upsell_renewal',
  'mastermind',
  'refund',
  'excluded',
  'other',
]);

export async function POST(req: NextRequest) {
  let body: { rowId?: string; paymentType?: string; offer?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const rowId = body.rowId?.trim();
  const paymentType = body.paymentType?.trim();
  if (!rowId) return NextResponse.json({ ok: false, error: 'rowId required' }, { status: 400 });
  if (!paymentType || !ALLOWED.has(paymentType)) {
    return NextResponse.json(
      { ok: false, error: `paymentType must be one of: ${Array.from(ALLOWED).join(', ')}` },
      { status: 400 }
    );
  }

  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });

  const update: Record<string, unknown> = {
    payment_type: paymentType,
    updated_at: new Date().toISOString(),
  };
  if (body.offer !== undefined) update.offer = body.offer;

  const { data, error } = await supa
    .from('t07_income_processors')
    .update(update)
    .eq('id', rowId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, row: data });
}
