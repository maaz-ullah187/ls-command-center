'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { Lead } from '@/lib/types';
import {
  DEFAULT_PROGRAM_TARGETS,
  TARGETS_STORAGE_KEY,
  getDefaultTargets,
  type ProgramTarget,
  type SavedTargets,
} from '@/lib/projections-defaults';

// ── Formatters ──────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── Types ───────────────────────────────────────────────────────────────────
interface OfferProjection {
  name: string;
  pricePerUnit: number;
  unitsTarget: number;
  projectedRev: number;
  actualUnits: number;
  actualRev: number;
}

interface CashCollection {
  name: string;
  pctUpfront: number;
  projectedCC: number;
  actualCC: number;
}

interface AREntry {
  source: string;
  arBalance: number | null;
  pctExpected: number | null;
  dollarExpected: number;
  arCollected: number;
  pctCollected: number;
}

interface RefundEntry {
  program: string;
  refundRate: string;
  projectedRefunds: number;
  actualRefunds: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadSavedTargets(): SavedTargets | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedTargets;
  } catch {
    return null;
  }
}

function savePersistentTargets(targets: SavedTargets) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(targets));
}

function getCurrentMonthLeads(leads: Lead[]): Lead[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  return leads.filter((l) => {
    const d = new Date(l.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

function isClosedWon(lead: Lead): boolean {
  return lead.stage === 'Closed Won' || lead.cashCollected > 1;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ProgressBar({ pct, color = 'emerald' }: { pct: number; color?: 'emerald' | 'amber' | 'red' | 'blue' }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const fills: Record<string, string> = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    blue: 'bg-blue-500',
  };
  return (
    <div className="w-full bg-gray-700/50 rounded-full h-2.5 overflow-hidden">
      <div className={`${fills[color]} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function StatusBadge({ status }: { status: 'on-track' | 'at-risk' | 'behind' }) {
  const cfg = {
    'on-track': { label: 'On Track', bg: 'bg-emerald-500/15', text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
    'at-risk': { label: 'At Risk', bg: 'bg-amber-500/15', text: 'text-amber-400', ring: 'ring-amber-500/30' },
    behind: { label: 'Behind', bg: 'bg-red-500/15', text: 'text-red-400', ring: 'ring-red-500/30' },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ring-1 ${cfg.bg} ${cfg.text} ${cfg.ring}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'on-track' ? 'bg-emerald-400' : status === 'at-risk' ? 'bg-amber-400' : 'bg-red-400'} animate-pulse`} />
      {cfg.label}
    </span>
  );
}

function SummaryRow({
  label,
  value,
  highlight = false,
  negative = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1.5">
      <span className="text-gray-400">{label}</span>
      <span
        className={`tabular-nums ${
          negative ? 'text-red-400 font-semibold' : highlight ? 'text-emerald-400 font-semibold' : 'text-white'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Set Targets Modal ───────────────────────────────────────────────────────

function SetTargetsModal({
  targets,
  onSave,
  onClose,
}: {
  targets: SavedTargets;
  onSave: (t: SavedTargets) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SavedTargets>(() => JSON.parse(JSON.stringify(targets)));

  const updateProgram = (idx: number, field: keyof ProgramTarget, value: string | number) => {
    setDraft((prev) => {
      const next = { ...prev, programs: prev.programs.map((p, i) => (i === idx ? { ...p, [field]: value } : p)) };
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Set Monthly Targets</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Per-program targets */}
        <div className="space-y-4 mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Per-Program Targets</p>
          {draft.programs.map((p, idx) => (
            <div key={p.program} className="bg-[#0f1117] rounded-lg border border-gray-800 p-4">
              <p className="text-white text-sm font-medium mb-3">{p.label || p.name}</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Price / Unit</label>
                  <input
                    type="number"
                    value={p.pricePerUnit}
                    onChange={(e) => updateProgram(idx, 'pricePerUnit', Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Unit Target</label>
                  <input
                    type="number"
                    value={p.unitsTarget}
                    onChange={(e) => updateProgram(idx, 'unitsTarget', Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">% Upfront</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(p.pctUpfront * 100)}
                    onChange={(e) => updateProgram(idx, 'pctUpfront', Number(e.target.value) / 100)}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Projected: {fmt(p.pricePerUnit * p.unitsTarget)} contracted / {fmt(p.pricePerUnit * p.unitsTarget * p.pctUpfront)} cash
              </p>
            </div>
          ))}
        </div>

        {/* Global targets */}
        <div className="space-y-3 mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Global Targets</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Total Cash Target</label>
              <input
                type="number"
                value={draft.totalCashTarget}
                onChange={(e) => setDraft((prev) => ({ ...prev, totalCashTarget: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">AR Collection Target</label>
              <input
                type="number"
                value={draft.arTarget}
                onChange={(e) => setDraft((prev) => ({ ...prev, arTarget: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Expense Budget</label>
              <input
                type="number"
                value={draft.expenseTarget}
                onChange={(e) => setDraft((prev) => ({ ...prev, expenseTarget: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Margin Target (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.marginTarget}
                onChange={(e) => setDraft((prev) => ({ ...prev, marginTarget: Number(e.target.value) }))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg border border-gray-700 hover:border-gray-600 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition font-medium"
          >
            Save Targets
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

interface ProjectionsTabProps {
  leads: Lead[];
}

export default function ProjectionsTab({ leads }: ProjectionsTabProps) {
  const [showTargetsModal, setShowTargetsModal] = useState(false);
  const [savedTargets, setSavedTargets] = useState<SavedTargets | null>(null);

  // Load persisted targets from localStorage on mount
  useEffect(() => {
    setSavedTargets(loadSavedTargets());
  }, []);

  const handleSaveTargets = useCallback((t: SavedTargets) => {
    savePersistentTargets(t);
    setSavedTargets(t);
    setShowTargetsModal(false);
  }, []);

  // Resolve targets: saved overrides > defaults
  const defaults = getDefaultTargets();
  const programTargets: ProgramTarget[] = savedTargets?.programs ?? defaults.programs;
  const totalCashTarget = savedTargets?.totalCashTarget ?? defaults.totalCashTarget;
  const arTarget = savedTargets?.arTarget ?? defaults.arTarget;
  const expenseTarget = savedTargets?.expenseTarget ?? defaults.expenseTarget;
  const marginTarget = savedTargets?.marginTarget ?? defaults.marginTarget;

  // ── Dynamic date values ────────────────────────────────────────────────
  const now = new Date();
  const CURRENT_DAY = now.getDate();
  const DAYS_IN_MONTH = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const MONTH = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // ── Compute actuals from leads ─────────────────────────────────────────
  const monthLeads = useMemo(() => getCurrentMonthLeads(leads), [leads]);
  const closedWonLeads = useMemo(() => monthLeads.filter(isClosedWon), [monthLeads]);

  // Build OFFERS from real leads + targets
  const OFFERS: OfferProjection[] = useMemo(() => {
    return programTargets.map((pt) => {
      const programLeads = closedWonLeads.filter((l) => l.program === pt.program);
      const actualUnits = programLeads.length;
      const actualRev = programLeads.reduce((s, l) => s + l.contractedRevenue, 0);
      return {
        name: pt.name,
        pricePerUnit: pt.pricePerUnit,
        unitsTarget: pt.unitsTarget,
        projectedRev: pt.pricePerUnit * pt.unitsTarget,
        actualUnits,
        actualRev,
      };
    });
  }, [programTargets, closedWonLeads]);

  // Build CASH_COLLECTIONS from real leads + targets
  const CASH_COLLECTIONS: CashCollection[] = useMemo(() => {
    return programTargets.map((pt) => {
      const programLeads = closedWonLeads.filter((l) => l.program === pt.program);
      const actualCC = programLeads.reduce((s, l) => s + l.cashCollected, 0);
      const projectedCC = pt.pricePerUnit * pt.unitsTarget * pt.pctUpfront;
      return {
        name: `${pt.label} - Upfront CC`,
        pctUpfront: pt.pctUpfront,
        projectedCC,
        actualCC,
      };
    });
  }, [programTargets, closedWonLeads]);

  // AR entries: placeholder — no direct AR data source yet.
  // Show target from settings, actual $0 until Supabase AR table lands.
  const AR_ENTRIES: AREntry[] = useMemo(() => {
    return [
      {
        source: 'Program B BE (AR)',
        arBalance: null,
        pctExpected: null,
        dollarExpected: arTarget,
        arCollected: 0,
        pctCollected: 0,
      },
    ];
  }, [arTarget]);

  // Refunds: placeholder — no refund data source yet
  const REFUNDS: RefundEntry[] = useMemo(() => {
    return programTargets.map((pt) => ({
      program: pt.label,
      refundRate: '-',
      projectedRefunds: 0,
      actualRefunds: 0,
    }));
  }, [programTargets]);

  // ── Derived calculations ────────────────────────────────────────────────
  const offerTotals = useMemo(() => {
    const totalUnitsTarget = OFFERS.reduce((s, o) => s + o.unitsTarget, 0);
    const totalProjectedRev = OFFERS.reduce((s, o) => s + o.projectedRev, 0);
    const totalActualUnits = OFFERS.reduce((s, o) => s + o.actualUnits, 0);
    const totalActualRev = OFFERS.reduce((s, o) => s + o.actualRev, 0);
    return { totalUnitsTarget, totalProjectedRev, totalActualUnits, totalActualRev };
  }, [OFFERS]);

  const totalUpfrontCC = useMemo(() => CASH_COLLECTIONS.reduce((s, c) => s + c.actualCC, 0), [CASH_COLLECTIONS]);
  const totalARExpected = useMemo(() => AR_ENTRIES.reduce((s, a) => s + a.dollarExpected, 0), [AR_ENTRIES]);
  const totalARCollected = useMemo(() => AR_ENTRIES.reduce((s, a) => s + a.arCollected, 0), [AR_ENTRIES]);
  const totalRefunds = useMemo(() => REFUNDS.reduce((s, r) => s + r.actualRefunds, 0), [REFUNDS]);

  const projectedTotalRevenue = offerTotals.totalProjectedRev;
  const projectedNetRevenue = useMemo(() => {
    const projectedCC = CASH_COLLECTIONS.reduce((s, c) => s + c.projectedCC, 0);
    return projectedCC + totalARExpected + REFUNDS.reduce((s, r) => s + r.projectedRefunds, 0);
  }, [CASH_COLLECTIONS, totalARExpected, REFUNDS]);

  const actualTotalRevenue = totalUpfrontCC + totalARCollected + totalRefunds;

  // ── Pacing calculations ─────────────────────────────────────────────────
  const pctMonthElapsed = (CURRENT_DAY / DAYS_IN_MONTH) * 100;
  const pctTargetAchieved = offerTotals.totalProjectedRev > 0
    ? (offerTotals.totalActualRev / offerTotals.totalProjectedRev) * 100
    : 0;
  const pacingMultiplier = pctMonthElapsed > 0 ? pctTargetAchieved / pctMonthElapsed : 0;
  const projectedEndOfMonthRev = CURRENT_DAY > 0
    ? (offerTotals.totalActualRev / CURRENT_DAY) * DAYS_IN_MONTH
    : 0;
  const projectedEndOfMonthUnits = CURRENT_DAY > 0
    ? Math.round((offerTotals.totalActualUnits / CURRENT_DAY) * DAYS_IN_MONTH)
    : 0;

  const overallStatus: 'on-track' | 'at-risk' | 'behind' =
    pacingMultiplier >= 0.9 ? 'on-track' : pacingMultiplier >= 0.7 ? 'at-risk' : 'behind';

  const varianceColor = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');

  // Build the current targets object for the modal
  const currentTargetsForModal: SavedTargets = {
    programs: programTargets,
    totalCashTarget,
    arTarget,
    expenseTarget,
    marginTarget,
  };

  return (
    <div className="space-y-6">
      {/* ── Set Targets Modal ──────────────────────────────────────────────── */}
      {showTargetsModal && (
        <SetTargetsModal
          targets={currentTargetsForModal}
          onSave={handleSaveTargets}
          onClose={() => setShowTargetsModal(false)}
        />
      )}

      {/* ── SECTION 1: Monthly Targets Header ────────────────────────────── */}
      <div className="bg-gradient-to-br from-[#1a1d23] to-[#1e2330] rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-1">Financial Projections</p>
                <h1 className="text-2xl font-bold text-white">{MONTH}</h1>
              </div>
              <button
                onClick={() => setShowTargetsModal(true)}
                className="px-3 py-1.5 text-xs font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 rounded-lg transition"
              >
                Edit Targets
              </button>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Total Projected Revenue</p>
            <p className="text-3xl font-bold text-white tabular-nums">{fmt(projectedTotalRevenue)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Actual Revenue</p>
            <p className="text-3xl font-bold text-emerald-400 tabular-nums">{fmt(offerTotals.totalActualRev)}</p>
          </div>
          <div className="text-right">
            <StatusBadge status={overallStatus} />
            <p className="text-xs text-gray-500 mt-2">Day {CURRENT_DAY} of {DAYS_IN_MONTH}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Month Progress</span>
            <span>{fmtPct(pctMonthElapsed)} elapsed &middot; {fmtPct(pctTargetAchieved)} of target</span>
          </div>
          <div className="relative">
            <ProgressBar pct={pctTargetAchieved} color={overallStatus === 'on-track' ? 'emerald' : overallStatus === 'at-risk' ? 'amber' : 'red'} />
            {/* Month-elapsed marker */}
            <div
              className="absolute top-0 h-2.5 border-r-2 border-white/60"
              style={{ left: `${pctMonthElapsed}%` }}
              title={`Day ${CURRENT_DAY}`}
            />
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Unit Projections Table ────────────────────────────── */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Financial Projections</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-700">
                <th className="text-left py-3 pr-4">Offer</th>
                <th className="text-right py-3 px-3"># Units Target</th>
                <th className="text-right py-3 px-3">Projected Rev</th>
                <th className="text-right py-3 px-3">Actual Units</th>
                <th className="text-right py-3 px-3">Actual Rev</th>
                <th className="text-right py-3 px-3">Variance</th>
                <th className="text-right py-3 pl-3 w-40">% to Target</th>
              </tr>
            </thead>
            <tbody>
              {OFFERS.map((o, i) => {
                const variance = o.actualRev - o.projectedRev;
                const pctToTarget = o.projectedRev > 0 ? (o.actualRev / o.projectedRev) * 100 : 0;
                const barColor = pctToTarget >= 80 ? 'emerald' : pctToTarget >= 50 ? 'amber' : 'red';
                return (
                  <tr key={o.name} className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                    <td className="py-3 pr-4 text-white font-medium">{o.name}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{o.unitsTarget}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{fmt(o.projectedRev)}</td>
                    <td className="py-3 px-3 text-right text-white tabular-nums font-medium">{o.actualUnits}</td>
                    <td className="py-3 px-3 text-right text-white tabular-nums font-medium">{fmt(o.actualRev)}</td>
                    <td className={`py-3 px-3 text-right tabular-nums font-semibold ${varianceColor(variance)}`}>
                      {variance >= 0 ? '+' : ''}{fmt(variance)}
                    </td>
                    <td className="py-3 pl-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={pctToTarget} color={barColor} />
                        <span className={`text-xs tabular-nums font-medium min-w-[40px] text-right ${barColor === 'emerald' ? 'text-emerald-400' : barColor === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                          {fmtPct(pctToTarget)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr className="border-t-2 border-gray-600 bg-white/[0.04]">
                <td className="py-3 pr-4 text-white font-bold">TOTAL</td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">{offerTotals.totalUnitsTarget}</td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">{fmt(offerTotals.totalProjectedRev)}</td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">{offerTotals.totalActualUnits}</td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">{fmt(offerTotals.totalActualRev)}</td>
                <td className={`py-3 px-3 text-right tabular-nums font-bold ${varianceColor(offerTotals.totalActualRev - offerTotals.totalProjectedRev)}`}>
                  {offerTotals.totalActualRev - offerTotals.totalProjectedRev >= 0 ? '+' : ''}
                  {fmt(offerTotals.totalActualRev - offerTotals.totalProjectedRev)}
                </td>
                <td className="py-3 pl-3">
                  {(() => {
                    const pct = offerTotals.totalProjectedRev > 0 ? (offerTotals.totalActualRev / offerTotals.totalProjectedRev) * 100 : 0;
                    const c = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'red';
                    return (
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={pct} color={c} />
                        <span className={`text-xs tabular-nums font-bold min-w-[40px] text-right ${c === 'emerald' ? 'text-emerald-400' : c === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                          {fmtPct(pct)}
                        </span>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 3: Cash Collections ──────────────────────────────────── */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Cash Collections</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-700">
                <th className="text-left py-3 pr-4">Offer</th>
                <th className="text-right py-3 px-3">% Upfront CC</th>
                <th className="text-right py-3 px-3">Projected CC</th>
                <th className="text-right py-3 px-3">Actual CC</th>
                <th className="text-right py-3 pl-3 w-36">% Collected</th>
              </tr>
            </thead>
            <tbody>
              {CASH_COLLECTIONS.map((c, i) => {
                const pctCollected = c.projectedCC > 0 ? (c.actualCC / c.projectedCC) * 100 : 0;
                const color = pctCollected > 80 ? 'emerald' : pctCollected >= 50 ? 'amber' : 'red';
                return (
                  <tr key={c.name} className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                    <td className="py-3 pr-4 text-white font-medium">{c.name}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{fmtPct(c.pctUpfront * 100)}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{fmt(c.projectedCC)}</td>
                    <td className="py-3 px-3 text-right text-white tabular-nums font-medium">{fmt(c.actualCC)}</td>
                    <td className="py-3 pl-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={pctCollected} color={color} />
                        <span className={`text-xs tabular-nums font-medium min-w-[40px] text-right ${color === 'emerald' ? 'text-emerald-400' : color === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                          {fmtPct(pctCollected)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* CC Totals */}
              <tr className="border-t-2 border-gray-600 bg-white/[0.04]">
                <td className="py-3 pr-4 text-white font-bold">TOTAL</td>
                <td className="py-3 px-3 text-right text-gray-400">-</td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">
                  {fmt(CASH_COLLECTIONS.reduce((s, c) => s + c.projectedCC, 0))}
                </td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">{fmt(totalUpfrontCC)}</td>
                <td className="py-3 pl-3">
                  {(() => {
                    const projTotal = CASH_COLLECTIONS.reduce((s, c) => s + c.projectedCC, 0);
                    const pct = projTotal > 0 ? (totalUpfrontCC / projTotal) * 100 : 0;
                    const c = pct > 80 ? 'emerald' : pct >= 50 ? 'amber' : 'red';
                    return (
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={pct} color={c} />
                        <span className={`text-xs tabular-nums font-bold min-w-[40px] text-right ${c === 'emerald' ? 'text-emerald-400' : c === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                          {fmtPct(pct)}
                        </span>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 4: Account Receivables ────────────────────────────────── */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Account Receivables</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-700">
                <th className="text-left py-3 pr-4">Source</th>
                <th className="text-right py-3 px-3">A/R Balance</th>
                <th className="text-right py-3 px-3">% Expected</th>
                <th className="text-right py-3 px-3">$ Expected</th>
                <th className="text-right py-3 px-3">% Collected</th>
                <th className="text-right py-3 pl-3">AR Collected</th>
              </tr>
            </thead>
            <tbody>
              {AR_ENTRIES.map((a, i) => {
                const color = a.pctCollected >= 0.7 ? 'text-emerald-400' : a.pctCollected >= 0.4 ? 'text-amber-400' : 'text-red-400';
                return (
                  <tr key={a.source} className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                    <td className="py-3 pr-4 text-white font-medium">{a.source}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{a.arBalance != null ? fmt(a.arBalance) : '-'}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{a.pctExpected != null ? fmtPct(a.pctExpected * 100) : '-'}</td>
                    <td className="py-3 px-3 text-right text-gray-300 tabular-nums">{fmt(a.dollarExpected)}</td>
                    <td className={`py-3 px-3 text-right tabular-nums font-semibold ${color}`}>{fmtPct(a.pctCollected * 100)}</td>
                    <td className={`py-3 pl-3 text-right tabular-nums font-semibold ${color}`}>{fmt(a.arCollected)}</td>
                  </tr>
                );
              })}
              {/* AR Totals */}
              <tr className="border-t-2 border-gray-600 bg-white/[0.04]">
                <td className="py-3 pr-4 text-white font-bold">TOTAL</td>
                <td className="py-3 px-3 text-right text-gray-400">-</td>
                <td className="py-3 px-3 text-right text-gray-400">-</td>
                <td className="py-3 px-3 text-right text-white tabular-nums font-bold">{fmt(totalARExpected)}</td>
                <td className={`py-3 px-3 text-right tabular-nums font-bold ${totalARExpected > 0 && totalARCollected / totalARExpected >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
                  {fmtPct(totalARExpected > 0 ? (totalARCollected / totalARExpected) * 100 : 0)}
                </td>
                <td className={`py-3 pl-3 text-right tabular-nums font-bold ${totalARExpected > 0 && totalARCollected / totalARExpected >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
                  {fmt(totalARCollected)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 5: AR Refunds ────────────────────────────────────────── */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Refunds</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-700">
                <th className="text-left py-3 pr-4">Program</th>
                <th className="text-right py-3 px-3">Refund Rate</th>
                <th className="text-right py-3 px-3">Projected Refunds</th>
                <th className="text-right py-3 px-3">Actual Refunds</th>
                <th className="text-right py-3 pl-3">% of Cash Collected</th>
              </tr>
            </thead>
            <tbody>
              {REFUNDS.map((r, i) => {
                const pctOfCash = totalUpfrontCC > 0 ? (Math.abs(r.actualRefunds) / totalUpfrontCC) * 100 : 0;
                return (
                  <tr key={r.program} className={`border-b border-gray-800 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                    <td className="py-3 pr-4 text-white font-medium">{r.program}</td>
                    <td className="py-3 px-3 text-right text-gray-300">{r.refundRate}</td>
                    <td className="py-3 px-3 text-right text-red-400 tabular-nums">{r.projectedRefunds !== 0 ? fmt(r.projectedRefunds) : '$0'}</td>
                    <td className="py-3 px-3 text-right text-red-400 tabular-nums font-semibold">{r.actualRefunds !== 0 ? fmt(r.actualRefunds) : '$0'}</td>
                    <td className="py-3 pl-3 text-right text-gray-300 tabular-nums">{fmtPct(pctOfCash)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-gray-600 bg-white/[0.04]">
                <td className="py-3 pr-4 text-white font-bold">TOTAL REFUNDS</td>
                <td className="py-3 px-3" />
                <td className="py-3 px-3 text-right text-red-400 tabular-nums font-bold">{fmt(REFUNDS.reduce((s, r) => s + r.projectedRefunds, 0))}</td>
                <td className="py-3 px-3 text-right text-red-400 tabular-nums font-bold">{totalRefunds !== 0 ? fmt(totalRefunds) : '$0'}</td>
                <td className="py-3 pl-3 text-right text-gray-300 tabular-nums font-bold">
                  {fmtPct(totalUpfrontCC > 0 ? (Math.abs(totalRefunds) / totalUpfrontCC) * 100 : 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION 6: Weekly Pacing / Forecast ──────────────────────────── */}
      <div className="bg-gradient-to-br from-[#1a1d23] to-[#1c2029] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 tracking-wide">Weekly Pacing &amp; Forecast</h2>

        {/* Pacing headline */}
        <div className="flex items-start gap-4 mb-6 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <p className="text-gray-400 text-sm leading-relaxed">
              We are <span className="text-white font-semibold">{CURRENT_DAY} days</span> into {MONTH} ({fmtPct(pctMonthElapsed)} elapsed).
              At the current pace, we are projected to close{' '}
              <span className="text-white font-semibold">{projectedEndOfMonthUnits} units</span> and{' '}
              <span className="text-white font-semibold">{fmt(projectedEndOfMonthRev)}</span> in contracted revenue by month end.
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={overallStatus} />
            <p className="text-xs text-gray-500 mt-2">Pacing: {fmtPct(pacingMultiplier * 100)} of ideal</p>
          </div>
        </div>

        {/* Pacing comparison bars */}
        <div className="grid gap-3 mb-6">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Month Elapsed</span>
              <span>{fmtPct(pctMonthElapsed)}</span>
            </div>
            <ProgressBar pct={pctMonthElapsed} color="blue" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Revenue Target Achieved</span>
              <span>{fmtPct(pctTargetAchieved)}</span>
            </div>
            <ProgressBar pct={pctTargetAchieved} color={overallStatus === 'on-track' ? 'emerald' : overallStatus === 'at-risk' ? 'amber' : 'red'} />
          </div>
        </div>

        {/* Per-offer pacing */}
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Per-Offer Pacing Breakdown</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {OFFERS.map((o) => {
            const offerPctAchieved = o.projectedRev > 0 ? (o.actualRev / o.projectedRev) * 100 : 0;
            const offerPacing = pctMonthElapsed > 0 ? offerPctAchieved / pctMonthElapsed : 0;
            const projUnits = CURRENT_DAY > 0 ? Math.round((o.actualUnits / CURRENT_DAY) * DAYS_IN_MONTH) : 0;
            const projRev = CURRENT_DAY > 0 ? (o.actualRev / CURRENT_DAY) * DAYS_IN_MONTH : 0;
            const st: 'on-track' | 'at-risk' | 'behind' = offerPacing >= 0.9 ? 'on-track' : offerPacing >= 0.7 ? 'at-risk' : 'behind';
            const barColor = st === 'on-track' ? 'emerald' : st === 'at-risk' ? 'amber' : 'red';
            return (
              <div key={o.name} className="bg-[#0f1117] rounded-lg border border-gray-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white text-sm font-medium truncate pr-2">{o.name.split('(')[0].trim()}</p>
                  <StatusBadge status={st} />
                </div>
                <div className="space-y-1 text-xs text-gray-400 mb-3">
                  <div className="flex justify-between">
                    <span>Actual</span>
                    <span className="text-white font-medium tabular-nums">{o.actualUnits} units &middot; {fmt(o.actualRev)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Proj. EOM</span>
                    <span className="text-gray-300 tabular-nums">{projUnits} units &middot; {fmt(projRev)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Target</span>
                    <span className="text-gray-500 tabular-nums">{o.unitsTarget} units &middot; {fmt(o.projectedRev)}</span>
                  </div>
                </div>
                <ProgressBar pct={offerPctAchieved} color={barColor} />
                <p className={`text-xs mt-1 tabular-nums ${barColor === 'emerald' ? 'text-emerald-400' : barColor === 'amber' ? 'text-amber-400' : 'text-red-400'}`}>
                  {fmtPct(offerPctAchieved)} of target
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTION 7: Projected Revenue Summary ─────────────────────────── */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-6 tracking-wide">Revenue Summary</h2>
        <div className="font-mono text-sm space-y-1">
          {/* Projected block */}
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Projected</div>
          <SummaryRow label="Total Contracted Revenue (Projected)" value={fmt(projectedTotalRevenue)} />
          <SummaryRow label="Total Contracted Revenue (Actual)" value={fmt(offerTotals.totalActualRev)} highlight />
          <div className="border-b border-gray-800 my-3" />

          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Cash &amp; Collections</div>
          <SummaryRow label="Total Upfront Cash Collected" value={fmt(totalUpfrontCC)} />
          <SummaryRow label="Total AR Expected" value={fmt(totalARExpected)} />
          <SummaryRow label="Total AR Collected" value={fmt(totalARCollected)} />
          <SummaryRow label="Refunds" value={totalRefunds !== 0 ? fmt(totalRefunds) : '$0'} negative={totalRefunds < 0} />
          <div className="border-b border-gray-700 my-3" />

          {/* Bottom line */}
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Bottom Line</div>
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-400">Projected Total Revenue</span>
            <span className="text-white font-bold text-base tabular-nums">{fmt(projectedNetRevenue)}</span>
          </div>
          <div className="flex justify-between items-center py-2 bg-white/[0.03] rounded px-2 -mx-2">
            <span className="text-white font-bold">Actual Total Revenue</span>
            <span className="text-emerald-400 font-bold text-lg tabular-nums">{fmt(actualTotalRevenue)}</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-gray-400">Variance</span>
            <span className={`font-bold tabular-nums ${varianceColor(actualTotalRevenue - projectedNetRevenue)}`}>
              {actualTotalRevenue - projectedNetRevenue >= 0 ? '+' : ''}
              {fmt(actualTotalRevenue - projectedNetRevenue)}
            </span>
          </div>

          {/* Visual variance bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Actual vs Projected</span>
              <span>{fmtPct(projectedNetRevenue > 0 ? (actualTotalRevenue / projectedNetRevenue) * 100 : 0)}</span>
            </div>
            <ProgressBar
              pct={projectedNetRevenue > 0 ? (actualTotalRevenue / projectedNetRevenue) * 100 : 0}
              color={projectedNetRevenue > 0 && (actualTotalRevenue / projectedNetRevenue) >= 0.8 ? 'emerald' : projectedNetRevenue > 0 && (actualTotalRevenue / projectedNetRevenue) >= 0.5 ? 'amber' : 'red'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
