'use client';

import { useEffect, useState } from 'react';
import { useTimeframe } from '@/lib/useTimeframe';
import CardShell from './CardShell';
import Donut, { type DonutSlice } from './Donut';
import type { ExpenseBreakdownRow, VendorAggregateRow } from '@/lib/reports/main';

const formatLabel = (s: string) =>
  s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase());

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function ExpenseBreakdown() {
  const { from, to } = useTimeframe();
  const [data, setData] = useState<DonutSlice[]>([]);
  const [vendors, setVendors] = useState<VendorAggregateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/main/expense-breakdown?from=${from}&to=${to}&topVendors=10`)
      .then((r) => r.json())
      .then((d) => {
        const rows: ExpenseBreakdownRow[] = Array.isArray(d.rows) ? d.rows : [];
        setData(rows.map((r) => ({ label: formatLabel(r.expense_type), value: r.amount })));
        setVendors(Array.isArray(d.vendors) ? d.vendors : []);
      })
      .catch(() => {
        setData([]);
        setVendors([]);
      })
      .finally(() => setLoading(false));
  }, [from, to]);

  const vendorTotal = vendors.reduce((s, v) => s + v.amount, 0);

  return (
    <CardShell
      title="Expense Breakdown by Type"
      subtitle="Mercury banking · t08_expenses"
      cardId="main:expense-breakdown"
    >
      {loading ? (
        <div className="text-gray-500 text-xs py-8 text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
          {/* LEFT — donut + inline percentages */}
          <div>
            <Donut data={data} />
          </div>

          {/* RIGHT — Highest Cost Categories panel */}
          <div className="border-l border-gray-800/80 lg:pl-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-[11px] uppercase font-semibold text-gray-400 tracking-wider">
                  Highest Cost Categories
                </h4>
                <p className="text-[10px] text-gray-600 mt-0.5">
                  Aggregated across all transactions in this timeframe
                </p>
              </div>
              <span className="text-[10px] text-gray-600">{vendors.length} vendors</span>
            </div>

            {vendors.length === 0 ? (
              <div className="text-gray-600 text-xs py-6 text-center">No vendor data</div>
            ) : (
              <div className="space-y-1">
                {vendors.map((v, i) => {
                  const pct = vendorTotal > 0 ? (v.amount / vendorTotal) * 100 : 0;
                  return (
                    <div
                      key={v.vendor + i}
                      className="group/row relative flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-gray-800/40 transition-colors"
                    >
                      {/* Bar */}
                      <div className="absolute inset-y-0.5 left-2 right-2 rounded-md overflow-hidden pointer-events-none">
                        <div
                          className="h-full bg-blue-500/[0.07] group-hover/row:bg-blue-500/[0.12] transition-colors"
                          style={{ width: `${pct.toFixed(1)}%` }}
                        />
                      </div>
                      {/* Rank */}
                      <span className="relative z-10 w-5 text-[10px] text-gray-600 font-mono tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {/* Vendor */}
                      <div className="relative z-10 flex-1 min-w-0">
                        <div className="text-xs text-gray-100 truncate font-medium">
                          {titleCase(v.vendor)}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">
                          {v.count}× transaction{v.count === 1 ? '' : 's'}
                          {v.expense_type ? ` · ${formatLabel(v.expense_type)}` : ''}
                        </div>
                      </div>
                      {/* Amount */}
                      <div className="relative z-10 flex flex-col items-end">
                        <span className="text-xs text-emerald-400 font-semibold tabular-nums">
                          {fmtUSD(v.amount)}
                        </span>
                        <span className="text-[10px] text-gray-600 tabular-nums">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </CardShell>
  );
}
