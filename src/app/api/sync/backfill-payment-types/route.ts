import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/**
 * POST /api/sync/backfill-payment-types
 *
 * One-shot backfill: recategorizes every t07_income_processors row to the
 * canonical bucket vocabulary by cross-referencing against t06_deals_closed.
 *
 * Match rule (any of):
 *   email match (case-insensitive)
 *   phone match (digits-only equality)
 *   name match (case-insensitive trim)
 *
 * Bucket assignment:
 *   t06.deal_type='new'                  → 'new_client'
 *   t06.deal_type IN ('renewal','upsell')→ 'upsell_renewal'
 *   t07 already 'refund' / negative      → 'refund'
 *   t07 already canonical bucket         → unchanged
 *   anything else                        → 'other' (surfaces in Uncategorized
 *                                          Billing queue for manual review)
 *
 * Mastermind + Account Receivable are intentionally manual — there's no
 * upstream signal to auto-detect them, so they live in the queue until your
 * team categorizes via the BillingTracker dropdown.
 *
 * Idempotent — safe to re-run. Only writes rows whose bucket actually changes.
 *
 * REQUIRES migration 0024 to be applied first (expands the check constraint).
 */
export async function POST() {
  return run();
}
export async function GET() {
  return run();
}

const CANONICAL = new Set([
  'new_client',
  'account_receivable',
  'upsell_renewal',
  'mastermind',
  'refund',
  'other',
]);

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '');

async function run() {
  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });

  // 1. Pull all t06 deals — small table (~138 rows), one fetch is fine.
  const { data: deals, error: dErr } = await supa
    .from('t06_deals_closed')
    .select('email, phone, name, deal_type, offer')
    .limit(50000);
  if (dErr) {
    return NextResponse.json({ ok: false, error: `t06 read: ${dErr.message}` }, { status: 500 });
  }

  // Build lookup maps for fast match
  const byEmail = new Map<string, { deal_type: string | null; offer: string | null }>();
  const byPhone = new Map<string, { deal_type: string | null; offer: string | null }>();
  const byName  = new Map<string, { deal_type: string | null; offer: string | null }>();
  for (const d of (deals ?? []) as Array<{
    email: string | null; phone: string | null; name: string | null;
    deal_type: string | null; offer: string | null;
  }>) {
    const v = { deal_type: d.deal_type, offer: d.offer };
    if (d.email) byEmail.set(d.email.toLowerCase().trim(), v);
    const p = digits(d.phone);
    if (p.length >= 7) byPhone.set(p, v);
    if (d.name) byName.set(d.name.toLowerCase().trim(), v);
  }

  // 2. Pull every t07 row (paginate — PostgREST default cap = 1000).
  // t07_income_processors does NOT have a phone column — match on email + name.
  type Row = {
    id: string;
    email: string | null;
    name: string | null;
    payment_type: string | null;
    offer: string | null;
    final_amount: number | string | null;
    amount: number | string | null;
    status: string | null;
  };
  const t07: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('t07_income_processors')
      .select('id, email, name, payment_type, offer, final_amount, amount, status')
      .range(from, from + 999);
    if (error) return NextResponse.json({ ok: false, error: `t07 read: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    t07.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // 3. Decide new bucket for each row
  type Update = { id: string; payment_type: string; offer?: string | null };
  const updates: Update[] = [];
  let unchanged = 0;
  let alreadyCanonical = 0;

  function dealTypeToBucket(dt: string | null | undefined): string | null {
    const d = (dt ?? '').toLowerCase();
    if (d === 'new') return 'new_client';
    if (d === 'renewal' || d === 'upsell' || d === 'upgrade') return 'upsell_renewal';
    return null;
  }

  for (const r of t07) {
    // Already canonical? skip.
    if (r.payment_type && CANONICAL.has(r.payment_type)) {
      alreadyCanonical += 1;
      continue;
    }

    let newBucket: string | null = null;
    let newOffer: string | null = null;

    // Refund detection: explicit type or negative amount or status='refunded'
    const amt = Number(r.final_amount ?? r.amount ?? 0);
    if (
      (r.payment_type ?? '').toLowerCase() === 'refund' ||
      r.status === 'refunded' ||
      amt < 0
    ) {
      newBucket = 'refund';
    } else {
      // Try matching against t06_deals_closed (email + name only — t07 has no phone)
      const eKey = (r.email ?? '').toLowerCase().trim();
      const nKey = (r.name ?? '').toLowerCase().trim();
      const hit =
        (eKey && byEmail.get(eKey)) ||
        (nKey && byName.get(nKey)) ||
        null;
      if (hit) {
        newBucket = dealTypeToBucket(hit.deal_type) ?? 'other';
        if (!r.offer && hit.offer) newOffer = hit.offer;
      } else {
        // Fallback: if t07 had legacy 'renewal'/'upgrade' from earlier sync,
        // collapse to upsell_renewal even without a t06 match.
        const cur = (r.payment_type ?? '').toLowerCase();
        if (cur === 'renewal' || cur === 'upgrade') newBucket = 'upsell_renewal';
        else newBucket = 'other';
      }
    }

    if (newBucket === r.payment_type && newOffer === null) {
      unchanged += 1;
      continue;
    }

    const u: Update = { id: r.id, payment_type: newBucket! };
    if (newOffer !== null) u.offer = newOffer;
    updates.push(u);
  }

  // 4. Apply updates in chunks of 500 (one UPDATE per row — could batch
  // smarter via UPSERT but row count is bounded ~3k).
  let applied = 0;
  for (const u of updates) {
    const { error } = await supa
      .from('t07_income_processors')
      .update({
        payment_type: u.payment_type,
        ...(u.offer !== undefined ? { offer: u.offer } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', u.id);
    if (error) {
      return NextResponse.json(
        { ok: false, applied, error: `update id=${u.id}: ${error.message}` },
        { status: 500 }
      );
    }
    applied += 1;
  }

  // 5. Bucket distribution after backfill
  const { data: after } = await supa
    .from('t07_income_processors')
    .select('payment_type')
    .limit(50000);
  const dist = new Map<string, number>();
  for (const r of (after ?? []) as Array<{ payment_type: string | null }>) {
    const k = r.payment_type ?? '∅NULL';
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }

  return NextResponse.json({
    ok: true,
    scanned: t07.length,
    alreadyCanonical,
    unchanged,
    proposedUpdates: updates.length,
    applied,
    distributionAfter: Array.from(dist.entries()).sort((a, b) => b[1] - a[1]),
  });
}
