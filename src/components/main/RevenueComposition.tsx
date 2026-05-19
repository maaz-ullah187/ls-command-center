'use client';

import { useEffect, useState } from 'react';
import CardShell from './CardShell';
import Donut, { type DonutSlice } from './Donut';
import { useTimeframe } from '@/lib/useTimeframe';
import { monthYM_ET } from '@/lib/timeframe';

/**
 * Revenue Composition donut. Reads from `/api/main/revenue-buckets`, which
 * uses t06_deals_closed (segmented by deal_type) + t07_income_processors
 * (AR installments + refunds). Same source-of-truth as the Pace vs Projection
 * card so both numbers always agree.
 *
 * Architecture B: t07_income_processors is the single source of truth.
 * Buckets: New Cash · Upsells/Renewals · Mastermind · AR · Uncategorized
 * (the Uncategorized slice = team's pending queue work — shrinks as they
 * categorize). Refunds subtracted in the footer. Net = sum - refunds.
 */
interface RevenueBuckets {
  monthYear: string;
  configured: boolean;
  source?: string;
  newCash: number;
  ar: number;
  upsellRenewal: number;
  mastermind: number;
  uncategorized: number;
  refunds: number;
  grossInflow: number;
  netRevenue: number;
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function RevenueComposition() {
  const [data, setData] = useState<RevenueBuckets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // the operator 2026-05-01: respect the global timeframe filter so picking
  // "Last Month (April 2026)" updates the donut to April's composition.
  const tf = useTimeframe();

  useEffect(() => {
    let alive = true;
    const monthYM = (tf.from && /^\d{4}-\d{2}/.test(tf.from)) ? tf.from.slice(0, 7) : monthYM_ET();
    const load = () => {
      setLoading(true);
      setError(null);
      fetch(`/api/main/revenue-buckets?month=${monthYM}&_t=${Date.now()}`)
        .then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j.error ?? `http_${r.status}`);
          }
          return r.json();
        })
        .then((d) => { if (alive) setData(d); })
        .catch((e) => { if (alive) setError(e?.message ?? 'fetch_failed'); })
        .finally(() => { if (alive) setLoading(false); });
    };
    load();
    const onCategorized = () => load();
    window.addEventListener('billing:categorized', onCategorized);
    return () => {
      alive = false;
      window.removeEventListener('billing:categorized', onCategorized);
    };
  }, [tf.from, tf.to, tf.preset]);

  const slices: DonutSlice[] = data
    ? [
        { label: 'New Cash', value: data.newCash },
        { label: 'Upsells / Renewals', value: data.upsellRenewal },
        { label: 'Mastermind', value: data.mastermind },
        { label: 'AR (Receivables)', value: data.ar },
        { label: 'Uncategorized', value: data.uncategorized },
      ].filter((s) => s.value > 0)
    : [];

  const refunds = Math.abs(data?.refunds ?? 0);

  return (
    <CardShell
      title="Revenue Composition"
      subtitle="New · Renewals · Upsells · Mastermind · AR · Refunds"
      cardId="main:revenue-composition"
    >
      {loading ? (
        <div className="text-gray-500 text-xs py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-red-400 text-xs py-8 text-center">
          {error === 'supabase_not_configured' ? 'Supabase not configured.' : error}
        </div>
      ) : !data || slices.length === 0 ? (
        <div className="text-gray-500 text-xs py-8 text-center">
          No closed deals or paid payments this month yet.
        </div>
      ) : (
        <div>
          <Donut data={slices} totalLabel="Gross Inflow" />
          <div className="mt-3 px-2 space-y-1.5">
            {refunds > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Refunds (subtracted)</span>
                <span className="text-red-400 font-semibold tabular-nums">-{fmtUSD(refunds)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-base pt-2 border-t border-gray-800">
              <span className="text-gray-200 font-semibold">Net Revenue</span>
              <span className="text-emerald-400 font-bold tabular-nums">{fmtUSD(data.netRevenue)}</span>
            </div>
          </div>
        </div>
      )}
    </CardShell>
  );
}
