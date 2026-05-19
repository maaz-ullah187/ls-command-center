'use client';

import { useState, useEffect, useMemo } from 'react';

interface CommissionLineItem {
  dealId: string | null;
  paymentId: string | null;
  date: string;
  prospect: string;
  offer: string | null;
  source: string | null;
  attribution: 'paid' | 'organic';
  grossAmount: number;
  afterSplitIt: number;
  rateApplied: number;
  commissionAmount: number;
  pifBonus: number;
  note?: string;
}

interface PersonCommission {
  name: string;
  role: string;
  roleLabel: string;
  eligibleDealCount: number;
  grossBase: number;
  splitItDeducted: number;
  commissionableBase: number;
  ratePaidDeals: number;
  ratePaidRate?: number;
  rateOrganicDeals: number;
  commission: number;
  pifBonusTotal: number;
  csmBonusTotal: number;
  floorAdjustment: number;
  totalOwed: number;
  lineItems: CommissionLineItem[];
  notes: string[];
}

interface OrphanedPayment {
  id: string;
  date: string;
  email: string;
  amount: number;
  final_amount: number;
  payment_type: string;
  payment_structure: string;
  offer: string | null;
  processor: string;
}

interface CommissionReport {
  periodStart: string;
  periodEnd: string;
  people: PersonCommission[];
  totals: {
    commissionPaidOut: number;
    pifBonusesPaidOut: number;
    csmBonusesPaidOut: number;
    grandTotal: number;
  };
  orphanedPayments: OrphanedPayment[];
  generatedAt: string;
}

const ROLE_COLORS: Record<string, string> = {
  closer: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  setter: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ig_dm_closer: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  sales_manager: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  marketing_manager: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  csm: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  content_manager: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
};

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function moneyPrecise(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

/** Load paid-status set from localStorage. Persists "mark as paid" across reloads. */
function loadPaidSet(periodKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(`commissions-paid-${periodKey}`);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}
function savePaidSet(periodKey: string, set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`commissions-paid-${periodKey}`, JSON.stringify([...set]));
  } catch { /* ignore */ }
}

export default function CommissionsTab() {
  // Period state — defaults to this month
  const [periodStart, setPeriodStart] = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [periodEnd, setPeriodEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [report, setReport] = useState<CommissionReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [paidSet, setPaidSet] = useState<Set<string>>(new Set());
  const [showOrphans, setShowOrphans] = useState(false);

  const periodKey = `${periodStart}_${periodEnd}`;

  useEffect(() => {
    setPaidSet(loadPaidSet(periodKey));
  }, [periodKey]);

  async function loadReport() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/commissions/report?start=${periodStart}&end=${periodEnd}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadReport(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function togglePaid(personName: string) {
    const next = new Set(paidSet);
    if (next.has(personName)) next.delete(personName);
    else next.add(personName);
    setPaidSet(next);
    savePaidSet(periodKey, next);
  }

  function exportCSV() {
    if (!report) return;
    const rows = [['Name', 'Role', 'Deals', 'Commissionable Base', 'Commission', 'PIF', 'CSM Bonus', 'Floor Adj', 'Total Owed', 'Paid?']];
    for (const p of report.people) {
      if (p.totalOwed === 0 && p.eligibleDealCount === 0) continue;
      rows.push([
        p.name,
        p.roleLabel,
        String(p.eligibleDealCount),
        p.commissionableBase.toFixed(2),
        p.commission.toFixed(2),
        p.pifBonusTotal.toFixed(2),
        p.csmBonusTotal.toFixed(2),
        p.floorAdjustment.toFixed(2),
        p.totalOwed.toFixed(2),
        paidSet.has(p.name) ? 'YES' : 'NO',
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commissions_${periodStart}_to_${periodEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visiblePeople = useMemo(
    () => (report?.people ?? []).filter(p => p.totalOwed > 0 || p.eligibleDealCount > 0),
    [report],
  );

  return (
    <div className="space-y-6">
      {/* Header + period controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Commissions</h2>
          <p className="text-sm text-neutral-400 mt-1">
            Live calc from t06_deals_closed + t07_income_processors + t20_slack_new_clients.
            Rules encoded from &ldquo;Addi&apos;s Revisions&rdquo;.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-400">From</label>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 text-sm"
          />
          <label className="text-xs text-neutral-400">To</label>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 text-sm"
          />
          <button
            onClick={loadReport}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded text-sm font-medium"
          >
            {loading ? 'Loading…' : 'Run'}
          </button>
          <button
            onClick={exportCSV}
            disabled={!report}
            className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 px-3 py-1 rounded text-sm font-medium border border-neutral-700"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-700 text-red-300 px-4 py-3 rounded">
          Error loading report: {error}
        </div>
      )}

      {/* Grand totals */}
      {report && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="text-xs text-neutral-400 uppercase tracking-wide">Grand Total</div>
            <div className="text-2xl font-bold text-white mt-1">{money(report.totals.grandTotal)}</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="text-xs text-neutral-400 uppercase tracking-wide">Commission</div>
            <div className="text-2xl font-bold text-blue-300 mt-1">{money(report.totals.commissionPaidOut)}</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="text-xs text-neutral-400 uppercase tracking-wide">PIF Bonuses</div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{money(report.totals.pifBonusesPaidOut)}</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="text-xs text-neutral-400 uppercase tracking-wide">CSM Bonuses</div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{money(report.totals.csmBonusesPaidOut)}</div>
          </div>
        </div>
      )}

      {/* People table */}
      {report && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 border-b border-neutral-800">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Deals / Pmts</th>
                <th className="px-4 py-3 text-right">Upfront Cash</th>
                <th className="px-4 py-3 text-right">Commission</th>
                <th className="px-4 py-3 text-right">PIF / Bonus</th>
                <th className="px-4 py-3 text-right">Total Owed</th>
                <th className="px-4 py-3 text-center">Paid?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {visiblePeople.map((p) => (
                <>
                  <tr
                    key={p.name}
                    onClick={() => setExpandedPerson(expandedPerson === p.name ? null : p.name)}
                    className={`cursor-pointer hover:bg-neutral-800/50 ${paidSet.has(p.name) ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-neutral-500">{expandedPerson === p.name ? '▾' : '▸'}</td>
                    <td className="px-4 py-3 text-white font-medium">{p.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs border ${ROLE_COLORS[p.role] ?? 'bg-neutral-800 text-neutral-400 border-neutral-700'}`}>
                        {p.roleLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-300">{p.eligibleDealCount}</td>
                    <td className="px-4 py-3 text-right text-neutral-400">{money(p.commissionableBase)}</td>
                    <td className="px-4 py-3 text-right text-neutral-200">{money(p.commission)}</td>
                    <td className="px-4 py-3 text-right text-emerald-300">
                      {p.pifBonusTotal > 0 && <div>PIF {money(p.pifBonusTotal)}</div>}
                      {p.csmBonusTotal > 0 && <div>CSM {money(p.csmBonusTotal)}</div>}
                      {p.floorAdjustment > 0 && <div className="text-amber-300">Floor +{money(p.floorAdjustment)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-white font-bold">{moneyPrecise(p.totalOwed)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePaid(p.name); }}
                        className={`text-xs px-2 py-1 rounded border ${
                          paidSet.has(p.name)
                            ? 'bg-emerald-900 border-emerald-700 text-emerald-200'
                            : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-white'
                        }`}
                      >
                        {paidSet.has(p.name) ? '✓ Paid' : 'Mark paid'}
                      </button>
                    </td>
                  </tr>
                  {expandedPerson === p.name && (
                    <tr>
                      <td colSpan={9} className="p-0 bg-neutral-950">
                        <div className="p-4 space-y-3">
                          {p.notes.length > 0 && (
                            <div className="text-xs text-neutral-400 space-y-0.5">
                              {p.notes.filter(Boolean).map((n, i) => <div key={i}>• {n}</div>)}
                            </div>
                          )}
                          {p.lineItems.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-neutral-500 border-b border-neutral-800">
                                    <th className="py-2 pr-3">Date</th>
                                    <th className="py-2 pr-3">Prospect</th>
                                    <th className="py-2 pr-3">Offer</th>
                                    <th className="py-2 pr-3">Source</th>
                                    <th className="py-2 pr-3 text-right">Gross</th>
                                    <th className="py-2 pr-3 text-right">After Split-It</th>
                                    <th className="py-2 pr-3 text-right">Rate</th>
                                    <th className="py-2 pr-3 text-right">Commission</th>
                                    <th className="py-2 pr-3 text-right">PIF</th>
                                  </tr>
                                </thead>
                                <tbody className="text-neutral-300">
                                  {p.lineItems.map((li, i) => (
                                    <tr key={i} className="border-b border-neutral-900">
                                      <td className="py-2 pr-3 text-neutral-400">{li.date}</td>
                                      <td className="py-2 pr-3">{li.prospect || '—'}</td>
                                      <td className="py-2 pr-3 text-neutral-400">{li.offer ?? '—'}</td>
                                      <td className="py-2 pr-3">
                                        <span className={`px-1.5 py-0.5 rounded text-xxs ${
                                          li.attribution === 'paid'
                                            ? 'bg-amber-900/40 text-amber-300'
                                            : 'bg-neutral-800 text-neutral-400'
                                        }`}>
                                          {li.source ?? 'Unknown'}
                                        </span>
                                      </td>
                                      <td className="py-2 pr-3 text-right text-neutral-400">{money(li.grossAmount)}</td>
                                      <td className="py-2 pr-3 text-right text-neutral-400">{money(li.afterSplitIt)}</td>
                                      <td className="py-2 pr-3 text-right">{pct(li.rateApplied)}</td>
                                      <td className="py-2 pr-3 text-right text-neutral-200">{money(li.commissionAmount)}</td>
                                      <td className="py-2 pr-3 text-right text-emerald-300">{li.pifBonus > 0 ? money(li.pifBonus) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-xs text-neutral-500 italic">No line items — this role is computed in aggregate (see notes above).</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {visiblePeople.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="text-center text-neutral-500 italic py-8">
                    No commissions for this period. Pick a different date range or confirm t06 deals landed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Orphaned payments */}
      {report && report.orphanedPayments.length > 0 && (
        <div className="bg-neutral-900 border border-amber-900 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowOrphans(!showOrphans)}
            className="w-full px-4 py-3 text-left hover:bg-neutral-800/50 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <span className="text-amber-400">⚠</span>
              <span className="text-white font-medium">Unattributed Payments</span>
              <span className="text-xs bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded">
                {report.orphanedPayments.length} in period
              </span>
            </div>
            <span className="text-neutral-500">{showOrphans ? '▾' : '▸'}</span>
          </button>
          {showOrphans && (
            <div className="overflow-x-auto border-t border-neutral-800">
              <table className="w-full text-xs">
                <thead className="bg-neutral-950 border-b border-neutral-800">
                  <tr className="text-left text-neutral-500">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Email</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Processor</th>
                    <th className="px-4 py-2">Offer</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900 text-neutral-300">
                  {report.orphanedPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-neutral-800/30">
                      <td className="px-4 py-2 text-neutral-400">{p.date}</td>
                      <td className="px-4 py-2 truncate max-w-[200px]">{p.email}</td>
                      <td className="px-4 py-2">{p.payment_type}</td>
                      <td className="px-4 py-2 text-neutral-400">{p.processor}</td>
                      <td className="px-4 py-2 truncate max-w-[180px] text-neutral-400">{p.offer ?? '—'}</td>
                      <td className="px-4 py-2 text-right">{money(p.amount)}</td>
                      <td className="px-4 py-2 text-right text-neutral-400">{money(p.final_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-3 text-xs text-neutral-500 border-t border-neutral-800">
                These are paid payments in the period with no matching t06 deal. Most are renewals or payment-plan installments for deals closed before dashboard sync began. Review manually, then map emails to deals if needed.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer note */}
      {report && (
        <div className="text-xs text-neutral-500 text-center pt-2 border-t border-neutral-900">
          Generated {new Date(report.generatedAt).toLocaleString()}.
          Rules: Addi&apos;s Revisions (for Review). Edit <code className="text-neutral-400">src/lib/commission-config.ts</code> to change rates.
        </div>
      )}
    </div>
  );
}
