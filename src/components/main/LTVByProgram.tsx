'use client';

import { useEffect, useState } from 'react';
import CardShell from './CardShell';

interface LTVRow {
  program: string;
  clientCount: number;
  /** clients with first_payment_date < 90 days ago — excluded from avg */
  newCount?: number;
  totalLtv: number;
  avgLtv: number;
}

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const PROGRAM_COLORS: Record<string, string> = {
  'Program A': 'bg-emerald-500',
  'Program B': 'bg-blue-500',
  'Program C': 'bg-purple-500',
};

/**
 * Average LTV by Program — horizontal bar chart. Reads /api/main/ltv-cac.
 */
interface Cohort {
  maturityDays: number;
  cutoffDate: string;
  excludedNew: number;
  excludedZero: number;
}

export default function LTVByProgram() {
  const [rows, setRows] = useState<LTVRow[]>([]);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/main/ltv-cac')
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? `http_${r.status}`);
        return j;
      })
      .then((d) => {
        if (cancelled) return;
        setRows(Array.isArray(d.ltvByProgram) ? d.ltvByProgram : []);
        setCohort(d.cohort ?? null);
      })
      .catch((e) => !cancelled && setError(e?.message ?? 'fetch_failed'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const max = rows.reduce((m, r) => Math.max(m, r.avgLtv), 0);

  const subtitle = cohort
    ? `Mature clients only (≥ ${cohort.maturityDays} days since first payment) — ${cohort.excludedNew} new clients excluded`
    : 'Lifetime cash collected per client, grouped by program';

  return (
    <CardShell
      title="Average LTV by Program"
      subtitle={subtitle}
      cardId="main:ltv-by-program"
    >
      {loading ? (
        <div className="text-gray-500 text-xs py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-red-400 text-xs py-8 text-center">{error}</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-xs py-8 text-center">No paid clients found yet.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const pct = max > 0 ? (r.avgLtv / max) * 100 : 0;
            const color = PROGRAM_COLORS[r.program] ?? 'bg-gray-500';
            const stillMaturing = r.clientCount === 0 && (r.newCount ?? 0) > 0;
            return (
              <div key={r.program}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <div className="text-gray-200 font-medium truncate pr-2">
                    {r.program}
                    {stillMaturing && (
                      <span className="ml-2 text-[10px] text-amber-300 font-normal">
                        still maturing — {r.newCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-gray-500">
                      {r.clientCount} mature{(r.newCount ?? 0) > 0 && r.clientCount > 0 ? ` · ${r.newCount} new` : ''}
                    </span>
                    <span className="text-emerald-400 font-bold tabular-nums">
                      {stillMaturing ? '—' : fmtUSD(r.avgLtv)}
                    </span>
                  </div>
                </div>
                <div className="h-2.5 bg-gray-900 rounded overflow-hidden">
                  <div
                    className={`h-full ${color} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}
