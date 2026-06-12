// Sync worker: t07_income_processors (Stripe source)
// Source: Stripe Charges API → t07_income_processors
// Schedule: daily via Vercel Cron
//
// Pulls every charge with status = 'succeeded' from Stripe (default: last
// 90 days, paginates via `starting_after`) and upserts them into t07
// keyed on `stripe-<charge_id>` so re-syncs are idempotent.
//
// All Stripe charges are categorized as `new_client` with offer
// 'Deposit Revenue' per the operator's spec — Stripe is currently only used
// for deposit collection. Amounts come from `amount_captured` (cents → USD).
//
// NOTE: the t07 `processor` column has a CHECK constraint that historically
// allowed only ('whop', 'fanbasis'). Adding 'stripe' requires a follow-up
// migration to extend that constraint, otherwise upserts will fail with
// `payment_processors_processor_check`. Flagged in the summary.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 120;

interface StripeCharge {
  id: string;
  amount_captured: number;
  status: string;
  created: number;
  description: string | null;
  receipt_email: string | null;
  billing_details: {
    name: string | null;
    email: string | null;
  } | null;
}

interface StripeChargeListResponse {
  object: 'list';
  data: StripeCharge[];
  has_more: boolean;
}

const STRIPE_API = 'https://api.stripe.com/v1';

/** Paginate /v1/charges, filtered to succeeded only. */
async function fetchAllSucceededCharges(
  apiKey: string,
  createdGte?: number,
): Promise<StripeCharge[]> {
  const all: StripeCharge[] = [];
  let startingAfter: string | undefined;
  // Hard cap so a runaway loop can't blow past Vercel's 120s budget.
  for (let page = 0; page < 200; page++) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (startingAfter) params.set('starting_after', startingAfter);
    if (createdGte !== undefined) params.set('created[gte]', String(createdGte));

    const res = await fetch(`${STRIPE_API}/charges?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Stripe /charges HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const body = (await res.json()) as StripeChargeListResponse;
    const items = body.data ?? [];

    for (const c of items) {
      if (c.status === 'succeeded') all.push(c);
    }

    if (!body.has_more || items.length === 0) break;
    startingAfter = items[items.length - 1].id;
  }
  return all;
}

/** Convert a Stripe epoch-seconds timestamp to YYYY-MM-DD (UTC). */
function epochToISODate(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
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

    const charges = await fetchAllSucceededCharges(stripeKey, createdGte);
    console.log(`[sync/stripe] Fetched ${charges.length} succeeded charges`);

    if (charges.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    const rows = charges.map((c) => {
      const usd = (c.amount_captured ?? 0) / 100;
      const billingName = c.billing_details?.name ?? null;
      const name = billingName || c.description || null;
      const email = c.billing_details?.email ?? c.receipt_email ?? '';
      return {
        id: `stripe-${c.id}`,
        date: epochToISODate(c.created),
        name,
        email,
        status: 'paid',
        payment_type: 'new_client',
        payment_structure: 'Full Pay',
        closer: null,
        offer: 'Deposit Revenue',
        financing_used: false,
        amount: usd,
        processing_pct: 0,
        final_amount: usd,
        processor: 'stripe',
        payment_link: null,
        notes: c.description ?? null,
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

    console.log(`[sync/stripe] Upserted ${upserted} Stripe charges to t07_income_processors`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
