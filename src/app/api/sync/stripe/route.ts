// Sync worker: t07_income_processors (Stripe source)
// Source: Stripe /v1/balance_transactions?type=charge → t07_income_processors
// Schedule: daily via Vercel Cron
//
// Why balance_transactions instead of /v1/charges:
//   • `net` field gives us the post-fee amount directly (no second call needed)
//   • `fee` field surfaces the Stripe processing fee per row
//   • One canonical record per money movement, including refunds (type='refund')
//
// We expand `source` so each row carries the full underlying Charge object —
// that's where billing_details (name / email) and description live.
//
// All Stripe charges are categorized as `new_client` with offer
// 'Deposit Revenue' per the operator's spec — Stripe is currently only used
// for deposit collection.
//
// NOTE: the t07 `processor` column has a CHECK constraint that historically
// allowed only ('whop', 'fanbasis'). Adding 'stripe' requires a follow-up
// migration to extend that constraint, otherwise upserts will fail with
// `payment_processors_processor_check`.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 120;

interface StripeBillingDetails {
  name: string | null;
  email: string | null;
}

interface StripeChargeExpanded {
  id: string;
  description: string | null;
  receipt_email: string | null;
  billing_details: StripeBillingDetails | null;
}

interface StripeBalanceTransaction {
  id: string;
  amount: number;          // gross, in cents
  net: number;             // post-fee, in cents
  fee: number;             // Stripe fee, in cents
  created: number;         // epoch seconds
  type: string;            // 'charge' (filtered server-side) | 'refund' | …
  // `source` is the related object id (string) by default. We request
  // expand[]=data.source so Stripe returns the full Charge object inline.
  source: string | StripeChargeExpanded | null;
}

interface StripeBalanceTransactionListResponse {
  object: 'list';
  data: StripeBalanceTransaction[];
  has_more: boolean;
}

const STRIPE_API = 'https://api.stripe.com/v1';

/** Paginate /v1/balance_transactions?type=charge with the underlying charge expanded. */
async function fetchAllChargeBalanceTransactions(
  apiKey: string,
  createdGte?: number,
): Promise<StripeBalanceTransaction[]> {
  const all: StripeBalanceTransaction[] = [];
  let startingAfter: string | undefined;
  // Hard cap so a runaway loop can't blow past Vercel's 120s budget.
  for (let page = 0; page < 200; page++) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    params.set('type', 'charge');
    // Inline the source Charge so billing_details / description come back
    // without a second request per row.
    params.append('expand[]', 'data.source');
    if (startingAfter) params.set('starting_after', startingAfter);
    if (createdGte !== undefined) params.set('created[gte]', String(createdGte));

    const res = await fetch(`${STRIPE_API}/balance_transactions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Stripe /balance_transactions HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = (await res.json()) as StripeBalanceTransactionListResponse;
    const items = body.data ?? [];
    all.push(...items);

    if (!body.has_more || items.length === 0) break;
    startingAfter = items[items.length - 1].id;
  }
  return all;
}

/** Convert a Stripe epoch-seconds timestamp to YYYY-MM-DD (UTC). */
function epochToISODate(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

/** Pull the charge id out of either an expanded source object or a string source. */
function chargeIdFromSource(source: StripeBalanceTransaction['source']): string | null {
  if (!source) return null;
  if (typeof source === 'string') return source;
  return source.id ?? null;
}

/** Pull the expanded Charge (or null if Stripe returned just the id string). */
function expandedCharge(source: StripeBalanceTransaction['source']): StripeChargeExpanded | null {
  if (!source || typeof source === 'string') return null;
  return source;
}

export async function POST(request: Request) {
  const result = await runSync('stripe-charges', async (sb) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY not set');

    // Query params:
    //   ?days=90           — lookback window in days (default 90)
    //   ?since=YYYY-MM-DD  — backfill from a specific date (overrides days)
    const { searchParams } = new URL(request.url);
    const sinceDate = searchParams.get('since');
    const days = Number(searchParams.get('days')) || 90;
    const createdGte = sinceDate
      ? Math.floor(new Date(`${sinceDate}T00:00:00Z`).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - days * 86400;

    const txns = await fetchAllChargeBalanceTransactions(stripeKey, createdGte);
    console.log(`[sync/stripe] Fetched ${txns.length} balance transactions (type=charge)`);

    if (txns.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    const rows = txns.map((t) => {
      const grossUsd = (t.amount ?? 0) / 100;
      const netUsd = (t.net ?? 0) / 100;
      const feeUsd = (t.fee ?? 0) / 100;
      // Fee as a % of gross — useful for reporting alongside the Whop rows
      // which carry processing_pct from `(amount - finalAmount) / amount`.
      const processingPct = grossUsd > 0
        ? Math.round((feeUsd / grossUsd) * 100 * 100) / 100
        : 0;

      const charge = expandedCharge(t.source);
      const chargeId = chargeIdFromSource(t.source);

      const billingName = charge?.billing_details?.name ?? null;
      const name = billingName || charge?.description || null;
      const email = charge?.billing_details?.email ?? charge?.receipt_email ?? '';

      return {
        id: `stripe-bt-${t.id}`,
        date: epochToISODate(t.created),
        name,
        email,
        status: 'paid',
        payment_type: 'new_client',
        payment_structure: 'Full Pay',
        closer: null,
        offer: 'Deposit Revenue',
        financing_used: false,
        amount: grossUsd,
        processing_pct: processingPct,
        final_amount: netUsd,
        processor: 'stripe',
        // Stripe receipt URL needs a separate API call; leave null and let the
        // dashboard's link column hold the charge id for cross-reference.
        payment_link: null,
        notes: charge?.description ?? (chargeId ? `charge ${chargeId}` : null),
        deal_id: null,
        updated_at: new Date().toISOString(),
      };
    });

    // Upsert in batches of 100, idempotent on `id`.
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await sb
        .from('t07_income_processors')
        .upsert(batch, { onConflict: 'id' });
      if (error) throw error;
      upserted += batch.length;
    }

    console.log(`[sync/stripe] Upserted ${upserted} Stripe balance transactions to t07_income_processors`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
