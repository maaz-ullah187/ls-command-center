'use client';

import { useEffect, useState } from 'react';
import { useTimeframe } from '@/lib/useTimeframe';
import CardShell from './CardShell';
import SourceBadge from './SourceBadge';
import type { FunnelBySourceRow } from '@/lib/reports/main';

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(0)}%`;

export default function SalesFunnelBySource() {
  const { from, to } = useTimeframe();
  const [rows, setRows] = useState<FunnelBySourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/main/funnel-by-source?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <CardShell
      title="Sales Funnel by Source"
      subtitle="Source · Leads · Bookings · Showed · Closed · L→B% · Close% · Cash"
      cardId="main:sales-funnel-by-source"
    >
      {loading ? (
        <div className="text-gray-500 text-xs py-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-xs py-8 text-center">No leads in this window.</div>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                <th className="text-left px-5 py-2 font-semibold">Source</th>
                <th className="text-right px-3 py-2 font-semibold">Leads</th>
                <th className="text-right px-3 py-2 font-semibold">Bookings</th>
                <th className="text-right px-3 py-2 font-semibold">Showed</th>
                <th className="text-right px-3 py-2 font-semibold">Closed</th>
                <th className="text-right px-3 py-2 font-semibold">L→B%</th>
                <th className="text-right px-3 py-2 font-semibold">Close%</th>
                <th className="text-right px-5 py-2 font-semibold">Cash</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source} className="border-b border-gray-800/50 hover:bg-black/20">
                  <td className="px-5 py-2 whitespace-nowrap">
                    <SourceBadge source={r.source} />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{r.leads}</td>
                  <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{r.bookings}</td>
                  <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{r.showed}</td>
                  <td className="px-3 py-2 text-right text-gray-300 tabular-nums">{r.closed}</td>
                  <td className="px-3 py-2 text-right text-gray-400 tabular-nums">{fmtPct(r.leadToBookPct)}</td>
                  <td className="px-3 py-2 text-right text-gray-400 tabular-nums">{fmtPct(r.closePct)}</td>
                  <td className="px-5 py-2 text-right text-emerald-400 font-semibold tabular-nums">{fmtUSD(r.cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}
