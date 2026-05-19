// Sync worker: t07_income_processors table
// Sources: Whop API + Fanbasis API → t07_income_processors
// Schedule: every 6 hours via Vercel Cron

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 120;

/**
 * Map a Whop billing_reason + status → canonical payment_type bucket.
 *
 * the operator's bucket vocabulary (2026-04-28):
 *   new_client | account_receivable | upsell_renewal | mastermind | refund | other
 *
 * Whop billing_reason vocabulary:
 *   - 'initial'    = first payment of a new subscription → new_client
 *   - 'one_time'   = one-off product purchase            → new_client (most common case)
 *   - 'recurring'  = ongoing subscription installment    → account_receivable
 *   - 'renewal'    = renewing existing subscription      → upsell_renewal
 *   - 'upgrade'    = upgrading existing subscription     → upsell_renewal
 *
 * the operator 2026-04-29: previously 'initial' and 'one_time' fell to 'other'
 * which dumped ~$170k of new-client cash in April into Uncategorized.
 * Default to 'new_client' instead — a few one_time upsells will get
 * mis-classified but the team can flip those via the queue dropdown
 * (categorize-preserve guard means manual edits stick).
 *
 * Mastermind has no upstream signal — set manually via the queue.
 */
function mapPaymentType(billingReason: string, status: string, productName: string = ''): string {
  if (status === 'refunded') return 'refund';
  const r = billingReason.toLowerCase();
  const p = productName.toLowerCase();
  // Product-name heuristics — Whop's billing_reason is unreliable for
  // distinguishing renewals (often shows 'recurring' even when the team
  // posts 'Renewal' as the product). the operator 2026-04-29: 13 April rows
  // with offer='Renewal' got mis-tagged as account_receivable / new_client
  // because billing_reason said 'recurring' / 'initial'. Product name
  // takes precedence.
  if (p.includes('renew') || p.includes('upsell') || p.includes('upgrade')) return 'upsell_renewal';
  if (p.includes('mastermind')) return 'mastermind';
  // Fallback to billing_reason
  if (r === 'recurring') return 'account_receivable';
  if (r === 'renewal' || r === 'upgrade') return 'upsell_renewal';
  if (r === 'initial' || r === 'one_time') return 'new_client';
  return 'other';
}

function mapStatus(status: string): string {
  if (status === 'paid') return 'paid';
  if (status === 'refunded') return 'refunded';
  if (status === 'chargedback') return 'chargedback';
  if (status === 'open') return 'pending';
  return 'failed';
}

export async function POST() {
  const result = await runSync('income-processors', async (sb) => {
    const whopToken = process.env.WHOP_API_KEY;
    const fanbasisKey = process.env.FANBASIS_API_KEY;

    if (!whopToken && !fanbasisKey) {
      throw new Error('WHOP_API_KEY or FANBASIS_API_KEY must be set');
    }

    const rows: any[] = [];

    // ── Whop payments ──────────────────────────────────────────────────────
    if (whopToken) {
      const { fetchWhopPayments } = await import('@/lib/mappers/whop');
      const payments = await fetchWhopPayments(whopToken, 200); // up to 10,000

      for (const p of payments) {
        const amount = p.gross;
        const finalAmount = p.net;
        const processingPct = amount > 0
          ? Math.round(((amount - finalAmount) / amount) * 100 * 100) / 100
          : 0;

        // ── Original payment row (always emitted, status from Whop) ──────
        rows.push({
          id: p.id,
          date: p.date || new Date().toISOString().slice(0, 10),
          name: p.customerName || null,
          email: p.customerEmail,
          status: mapStatus(p.status),
          payment_type: mapPaymentType(p.billingReason, p.status, p.productName || ''),
          payment_structure: p.billingReason === 'recurring' ? 'Payment Plan' : 'Full Pay',
          closer: null,
          offer: p.productName || null,
          financing_used: false,
          amount,
          processing_pct: processingPct,
          final_amount: finalAmount,
          processor: 'whop',
          // Direct URL to Whop dashboard transaction (the operator 2026-04-23 rule)
          payment_link: p.paymentLink,
          notes: null,
          deal_id: null,
          updated_at: new Date().toISOString(),
        });

        // ── Refund / chargeback row (the operator 2026-04-25) ──────────────────
        // Whop tracks refunds via the `refunded_amount` field on the payment
        // (NOT a separate transaction). When non-zero, we emit a SEPARATE
        // negative-amount row so:
        //   • Net Revenue queries auto-net out (sum across rows)
        //   • Refunds row in the Pace table picks them up via payment_type='refund'
        //   • Original payment record is preserved for audit
        // Idempotent on `${p.id}-refund` so repeated syncs don't double-emit.
        if (p.refundedAmount && p.refundedAmount > 0) {
          const isChargeback = p.status === 'chargedback';
          rows.push({
            id: `${p.id}-refund`,
            date: p.date || new Date().toISOString().slice(0, 10),
            name: p.customerName || null,
            email: p.customerEmail,
            status: isChargeback ? 'chargedback' : 'refunded',
            payment_type: 'refund',
            payment_structure: 'Full Pay',
            closer: null,
            offer: p.productName || null,
            financing_used: false,
            amount: -p.refundedAmount,
            processing_pct: 0,
            final_amount: -p.refundedAmount,
            processor: 'whop',
            payment_link: p.paymentLink,
            notes: isChargeback
              ? `Chargeback for payment ${p.id}`
              : `Refund of $${p.refundedAmount} for payment ${p.id}`,
            deal_id: null,
            updated_at: new Date().toISOString(),
          });
        }
      }

      const refundRows = rows.filter(r => r.payment_type === 'refund').length;
      console.log(`[sync/income] Fetched ${rows.length} Whop payments (${refundRows} refunds/chargebacks)`);
    }

    // ── Fanbasis subscribers ───────────────────────────────────────────────
    if (fanbasisKey) {
      const { fetchFanbasisSubscribers } = await import('@/lib/mappers/fanbasis');
      const subscribers = await fetchFanbasisSubscribers(fanbasisKey);
      const fanbasisCount = subscribers.length;

      for (const s of subscribers) {
        if (!s.customerEmail) continue;
        rows.push({
          id: `fanbasis-${s.id}`,
          date: s.createdAt || new Date().toISOString().slice(0, 10),
          name: s.customerName || null,
          email: s.customerEmail,
          status: 'paid',
          // Use the canonical vocabulary 'new_client' (not legacy 'new').
          // the operator 2026-04-29 — backfill cleaned up 290 legacy rows;
          // emitting 'new' here would re-introduce the gap.
          payment_type: 'new_client',
          payment_structure: 'Full Pay',
          closer: null,
          offer: s.productTitle || null,
          financing_used: false,
          amount: s.productPrice,
          processing_pct: 0,
          final_amount: s.productPrice,
          processor: 'fanbasis',
          // Fanbasis doesn't expose a public transaction URL — the operator confirmed
          // 2026-04-23. Leave NULL; processor='fanbasis' is the attribution signal.
          payment_link: null,
          notes: s.subscriptionStatus ? `Status: ${s.subscriptionStatus}` : null,
          deal_id: null,
          updated_at: new Date().toISOString(),
        });
      }

      console.log(`[sync/income] Fetched ${fanbasisCount} Fanbasis subscribers`);
    }

    if (rows.length === 0) return { rowsUpserted: 0, rowsSkipped: 0 };

    // Deduplicate by id — Whop API can return the same payment on multiple pages
    const seen = new Set<string>();
    const deduped: typeof rows = [];
    for (const row of rows) {
      if (!seen.has(row.id)) { seen.add(row.id); deduped.push(row); }
    }
    const dupeCount = rows.length - deduped.length;
    if (dupeCount > 0) console.log(`[sync/income] Deduplicated ${dupeCount} duplicate IDs`);
    const uniqueRows = deduped;

    // ── Preserve manual categorization (the operator 2026-04-28) ──────────────────
    // The Uncategorized Billing queue (POST /api/billing/categorize) lets the
    // team set payment_type and offer on each row. Without this guard, the
    // 6-hour Whop sync would overwrite their work back to 'other' / Whop's
    // raw product name. Mirrors the Mercury expense sync's preserve pattern.
    //
    // Preserve payment_type when existing value is anything OTHER than the
    // sync's default ('other' / 'new' / NULL) — i.e. someone categorized it.
    // Preserve offer when existing value is one of the operator's canonical
    // buckets (Program A / Program B / Program C) — those
    // never come from Whop's raw productName, so their presence proves it
    // was manually set.
    const SYNC_DEFAULT_PAYMENT_TYPES = new Set(['other', 'new', '', null as unknown as string]);
    const CANONICAL_OFFERS = new Set(['program a', 'program b', 'program c']);
    const ids = uniqueRows.map(r => r.id);
    const existingPaymentType = new Map<string, string>();
    const existingOffer = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: existing } = await sb
        .from('t07_income_processors')
        .select('id, payment_type, offer')
        .in('id', ids.slice(i, i + 200));
      for (const r of (existing ?? []) as Array<{ id: string; payment_type: string | null; offer: string | null }>) {
        const pt = (r.payment_type ?? '').trim();
        if (pt && !SYNC_DEFAULT_PAYMENT_TYPES.has(pt)) existingPaymentType.set(r.id, pt);
        const off = (r.offer ?? '').trim();
        if (off && CANONICAL_OFFERS.has(off.toLowerCase())) existingOffer.set(r.id, off);
      }
    }

    let preservedPaymentType = 0;
    let preservedOffer = 0;
    for (const row of uniqueRows) {
      const keepPt = existingPaymentType.get(row.id);
      if (keepPt) {
        row.payment_type = keepPt;
        preservedPaymentType += 1;
      }
      const keepOff = existingOffer.get(row.id);
      if (keepOff) {
        row.offer = keepOff;
        preservedOffer += 1;
      }
    }
    console.log(`[sync/income] Preserved manual categorization — payment_type: ${preservedPaymentType}, offer: ${preservedOffer}`);

    // ── 14-day new-client window rule (the operator 2026-04-30) ─────────────
    // "If they pay an amount in the first two weeks of working with us,
    //  it's all new cash. Anything after that is account receivable."
    // Catches the typical "deposit now + first installment 1-2 weeks later"
    // pattern as new client cash, while ongoing recurring stays AR.
    //
    // Applied AFTER the preserve guard so manual mastermind/upsell tags
    // never get touched. Only re-classifies rows whose current
    // payment_type is new_client OR account_receivable.
    const NEW_CLIENT_WINDOW_DAYS = 14;
    const earliestPaidByEmail = new Map<string, string>();

    // Pre-fetch every paid date in t07 for the customers we're syncing.
    // We need their earliest-ever payment date to anchor the window.
    const allEmails = Array.from(new Set(
      uniqueRows.map(r => (r.email || '').toLowerCase().trim()).filter(Boolean)
    ));
    for (let i = 0; i < allEmails.length; i += 200) {
      const batch = allEmails.slice(i, i + 200);
      const { data } = await sb
        .from('t07_income_processors')
        .select('email, date')
        .in('email', batch)
        .eq('status', 'paid');
      for (const r of (data ?? []) as Array<{ email: string | null; date: string }>) {
        if (!r.email) continue;
        const em = r.email.toLowerCase().trim();
        const cur = earliestPaidByEmail.get(em);
        if (!cur || r.date < cur) earliestPaidByEmail.set(em, r.date);
      }
    }
    // Fold incoming batch into the lookup — a customer whose first-ever
    // payment is in this very sync needs to anchor their own window.
    for (const row of uniqueRows) {
      if (row.status !== 'paid') continue;
      const em = (row.email || '').toLowerCase().trim();
      if (!em) continue;
      const cur = earliestPaidByEmail.get(em);
      if (!cur || row.date < cur) earliestPaidByEmail.set(em, row.date);
    }

    let windowReclassified = 0;
    for (const row of uniqueRows) {
      // Skip rows whose payment_type was preserved (manual queue tag)
      if (existingPaymentType.has(row.id)) continue;
      if (row.status !== 'paid') continue;
      if (row.payment_type !== 'new_client' && row.payment_type !== 'account_receivable') continue;
      const em = (row.email || '').toLowerCase().trim();
      const earliest = earliestPaidByEmail.get(em);
      if (!earliest) continue;
      const earliestMs = new Date(earliest + 'T00:00:00Z').getTime();
      const cutoffMs = earliestMs + NEW_CLIENT_WINDOW_DAYS * 86_400_000;
      const rowMs = new Date(row.date + 'T00:00:00Z').getTime();
      const target = rowMs <= cutoffMs ? 'new_client' : 'account_receivable';
      if (row.payment_type !== target) {
        row.payment_type = target;
        windowReclassified += 1;
      }
    }
    console.log(`[sync/income] 14-day new-client window rule reclassified ${windowReclassified} rows`);

    // Link to t06_deals_closed by email for deal_id + closer enrichment
    const { data: deals } = await sb
      .from('t06_deals_closed')
      .select('id, email, closer');
    const dealByEmail = new Map<string, { id: string; closer: string | null }>();
    if (deals) {
      for (const d of deals) {
        if (d.email) dealByEmail.set(d.email.toLowerCase(), { id: d.id, closer: d.closer });
      }
    }

    for (const row of uniqueRows) {
      const deal = dealByEmail.get(row.email.toLowerCase());
      if (deal) {
        row.deal_id = deal.id;
        if (!row.closer && deal.closer) row.closer = deal.closer;
      }
    }

    let upserted = 0;
    for (let i = 0; i < uniqueRows.length; i += 100) {
      const batch = uniqueRows.slice(i, i + 100);
      const { error } = await sb
        .from('t07_income_processors')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(`[sync/income] Upserted ${upserted} payments to t07_income_processors`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
