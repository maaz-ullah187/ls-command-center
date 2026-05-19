'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import { Lead, Ad, Expense } from '@/lib/types';
import type { BackendRevenueData } from '@/lib/dataSources';
import type { SheetRevenueSummary } from '@/hooks/useDashboardData';
import { X } from 'lucide-react';

interface KPITargets {
  newCash?: number;      // monthly target
  expenses?: number;     // monthly target
  margin?: number;       // target percentage (e.g. 40)
}

interface CEOKPIBarProps {
  leads: Lead[];
  ads: Ad[];
  expenses: Expense[];
  backendRevenue?: BackendRevenueData;
  sheetRevenue?: SheetRevenueSummary;
  targets?: KPITargets;
  onNavigate?: (tab: string, filter?: string) => void;
}

const DEFAULT_TARGETS: Required<KPITargets> = {
  newCash: 300000,
  expenses: 60000,
  margin: 40,
};

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
  }
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatFullCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Pacing indicator: compares current value against where it should be
 * for this day of the month. Returns a colored dot.
 */
function PacingDot({ current, monthlyTarget, isExpense }: { current: number; monthlyTarget: number; isExpense?: boolean }) {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const paceTarget = (monthlyTarget / daysInMonth) * dayOfMonth;

  let color: string;
  if (isExpense) {
    // For expenses, UNDER target is good
    const ratio = current / paceTarget;
    if (ratio <= 1) color = 'bg-emerald-400';
    else if (ratio <= 1.1) color = 'bg-yellow-400';
    else color = 'bg-red-400';
  } else {
    // For revenue/cash, OVER target is good
    const ratio = paceTarget > 0 ? current / paceTarget : 0;
    if (ratio >= 1) color = 'bg-emerald-400';
    else if (ratio >= 0.9) color = 'bg-yellow-400';
    else color = 'bg-red-400';
  }

  const paceLabel = isExpense
    ? `Pace target: ${formatFullCurrency(paceTarget)} (day ${dayOfMonth}/${daysInMonth})`
    : `Pace target: ${formatFullCurrency(paceTarget)} (day ${dayOfMonth}/${daysInMonth})`;

  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} ml-1.5`} title={paceLabel} />
  );
}

type KPICardId = 'newCash' | 'backendRev' | 'totalRevenue' | 'totalExpenses' | 'totalProfit' | 'margin';

/** Popover that explains where a KPI card's data comes from */
function KPISourcePopover({ cardId, onClose, children }: { cardId: KPICardId; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div ref={ref} className="absolute z-50 top-full left-0 mt-2 w-80 bg-[#22252b] rounded-xl border border-gray-600 shadow-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-semibold uppercase">Data Source</p>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={14} /></button>
      </div>
      <div className="text-xs text-gray-300 space-y-1.5">{children}</div>
    </div>
  );
}

export default function CEOKPIBar({ leads, ads, expenses, backendRevenue, sheetRevenue, targets, onNavigate }: CEOKPIBarProps) {
  const t = { ...DEFAULT_TARGETS, ...targets };
  const [openCard, setOpenCard] = useState<KPICardId | null>(null);

  const toggleCard = (id: KPICardId) => setOpenCard(prev => prev === id ? null : id);

  const closedDeals = useMemo(
    () => leads.filter(l => l.stage === 'Closed Won' || l.cashCollected > 1),
    [leads]
  );

  const kpis = useMemo(() => {
    // NEW CASH = gross (what they paid). Sheet is source of truth.
    const newCash = sheetRevenue && sheetRevenue.newCash > 0
      ? sheetRevenue.newCash
      : closedDeals.reduce((sum, l) => sum + l.cashCollected, 0);

    // REFUNDS shown separately (always negative in sheet, display as positive)
    const totalRefunds = sheetRevenue ? Math.abs(sheetRevenue.refunds) : 0;

    // BACKEND REVENUE = AR + Renewals + Upgrades (paid only)
    const backendRev = sheetRevenue && sheetRevenue.ar > 0
      ? sheetRevenue.ar + sheetRevenue.renewals + sheetRevenue.upgrades
      : 0;

    // NET REVENUE = cash + backend - refunds
    const totalRevenue = newCash + backendRev - totalRefunds;

    // Expenses from Mercury ProgB account only
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const adSpend = ads.reduce((sum, a) => sum + a.spend, 0);

    const totalProfit = totalRevenue - totalExpenses;
    const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    const otherExpenses = totalExpenses;
    return { newCash, totalRefunds, backendRev, totalRevenue, adSpend, otherExpenses, totalExpenses, totalProfit, marginPct };
  }, [closedDeals, ads, expenses, backendRevenue, sheetRevenue]);

  const closedCount = closedDeals.length;

  const cardBase = "bg-[#1a1d23] rounded-xl border border-gray-700 p-4 text-left hover:border-gray-500 transition-colors cursor-pointer relative";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
      {/* 1. Total New Cash */}
      <div className={cardBase} onClick={() => { onNavigate?.('crm', 'sales'); toggleCard('newCash'); }}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total New Cash</p>
          <PacingDot current={kpis.newCash} monthlyTarget={t.newCash} />
        </div>
        <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(kpis.newCash)}</p>
        <p className="text-xs text-gray-500 mt-0.5">{closedCount} deals closed</p>
        {openCard === 'newCash' && (
          <KPISourcePopover cardId="newCash" onClose={() => setOpenCard(null)}>
            <p className="font-semibold text-white mb-1">Sum of cashCollected from {closedCount} closed deals</p>
            <div className="max-h-40 overflow-y-auto space-y-1 border-t border-gray-700 pt-1.5">
              {closedDeals.sort((a, b) => b.cashCollected - a.cashCollected).slice(0, 20).map(l => (
                <div key={l.id} className="flex justify-between">
                  <span className="text-gray-400 truncate mr-2">{l.name}</span>
                  <span className="text-emerald-400 font-medium whitespace-nowrap">{formatFullCurrency(l.cashCollected)}</span>
                </div>
              ))}
              {closedCount > 20 && <p className="text-gray-500 text-[10px]">...and {closedCount - 20} more</p>}
            </div>
          </KPISourcePopover>
        )}
      </div>

      {/* 2. Backend Revenue */}
      <div className={cardBase} onClick={() => { onNavigate?.('backend'); toggleCard('backendRev'); }}>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Backend Revenue</p>
        <p className={`text-xl font-bold mt-1 ${kpis.backendRev > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>{formatCurrency(kpis.backendRev)}</p>
        <p className="text-xs text-gray-500 mt-0.5">{kpis.backendRev > 0 ? 'AR + Renewals + Upgrades' : 'Not connected yet'}</p>
        {openCard === 'backendRev' && (
          <KPISourcePopover cardId="backendRev" onClose={() => setOpenCard(null)}>
            {kpis.backendRev > 0 ? (
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-gray-400">AR</span><span className="text-emerald-400">{formatFullCurrency(sheetRevenue?.ar ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Renewals</span><span className="text-emerald-400">{formatFullCurrency(sheetRevenue?.renewals ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Upgrades</span><span className="text-emerald-400">{formatFullCurrency(sheetRevenue?.upgrades ?? 0)}</span></div>
                <div className="flex justify-between border-t border-gray-700 pt-1 font-semibold"><span className="text-white">Total</span><span className="text-emerald-400">{formatFullCurrency(kpis.backendRev)}</span></div>
              </div>
            ) : (
              <p className="text-gray-400">Not connected yet. Backend revenue (renewals, upsells, AR) will appear here once the data source is wired.</p>
            )}
          </KPISourcePopover>
        )}
      </div>

      {/* 3. Total Refunds */}
      <div className={cardBase} onClick={() => { onNavigate?.('crm', 'refunds'); toggleCard('totalRevenue'); }}>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total Refunds</p>
        <p className={`text-xl font-bold mt-1 ${kpis.totalRefunds > 0 ? 'text-red-400' : 'text-gray-500'}`}>
          {kpis.totalRefunds > 0 ? `-${formatCurrency(kpis.totalRefunds)}` : '$0'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{kpis.totalRefunds > 0 ? 'Deducted from revenue' : 'No refunds'}</p>
      </div>

      {/* 4. Net Revenue */}
      <div className={cardBase} onClick={() => toggleCard('totalRevenue')}>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Net Revenue</p>
        <p className="text-xl font-bold text-white mt-1">{formatCurrency(kpis.totalRevenue)}</p>
        <p className="text-xs text-gray-500 mt-0.5">Cash + Backend - Refunds</p>
        {openCard === 'totalRevenue' && (
          <KPISourcePopover cardId="totalRevenue" onClose={() => setOpenCard(null)}>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-gray-400">New Cash</span><span className="text-emerald-400">{formatFullCurrency(kpis.newCash)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Backend Revenue</span><span className="text-gray-500">$0 (not connected)</span></div>
              <div className="flex justify-between border-t border-gray-700 pt-1 font-semibold"><span className="text-white">Total</span><span className="text-white">{formatFullCurrency(kpis.totalRevenue)}</span></div>
            </div>
          </KPISourcePopover>
        )}
      </div>

      {/* 4. Total Expenses */}
      <div className={cardBase} onClick={() => toggleCard('totalExpenses')}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total Expenses</p>
          <PacingDot current={kpis.totalExpenses} monthlyTarget={t.expenses} isExpense />
        </div>
        <p className="text-xl font-bold text-red-400 mt-1">{formatCurrency(kpis.totalExpenses)}</p>
        <p className="text-xs text-gray-500 mt-0.5">Ad spend + costs</p>
        {openCard === 'totalExpenses' && (
          <KPISourcePopover cardId="totalExpenses" onClose={() => setOpenCard(null)}>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-gray-400">Ad Spend (Meta)</span><span className="text-red-400">{formatFullCurrency(kpis.adSpend)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Other Expenses</span><span className="text-red-400">{formatFullCurrency(kpis.otherExpenses)}</span></div>
              <div className="flex justify-between border-t border-gray-700 pt-1 font-semibold"><span className="text-white">Total</span><span className="text-red-400">{formatFullCurrency(kpis.totalExpenses)}</span></div>
            </div>
          </KPISourcePopover>
        )}
      </div>

      {/* 5. Total Profit */}
      <div className={cardBase} onClick={() => toggleCard('totalProfit')}>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Total Profit</p>
        <p className={`text-xl font-bold mt-1 ${kpis.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {kpis.totalProfit < 0 ? '-' : ''}{formatCurrency(Math.abs(kpis.totalProfit))}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Revenue - Expenses</p>
        {openCard === 'totalProfit' && (
          <KPISourcePopover cardId="totalProfit" onClose={() => setOpenCard(null)}>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-gray-400">Total Revenue</span><span className="text-white">{formatFullCurrency(kpis.totalRevenue)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">- Total Expenses</span><span className="text-red-400">{formatFullCurrency(kpis.totalExpenses)}</span></div>
              <div className="flex justify-between border-t border-gray-700 pt-1 font-semibold">
                <span className="text-white">Profit</span>
                <span className={kpis.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {kpis.totalProfit < 0 ? '-' : ''}{formatFullCurrency(Math.abs(kpis.totalProfit))}
                </span>
              </div>
            </div>
          </KPISourcePopover>
        )}
      </div>

      {/* 6. Margin % */}
      <div className={cardBase} onClick={() => toggleCard('margin')}>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Margin %</p>
          {kpis.totalRevenue > 0 && (
            <span
              className={`inline-block w-2 h-2 rounded-full ml-1.5 ${
                kpis.marginPct >= t.margin ? 'bg-emerald-400' : kpis.marginPct >= 15 ? 'bg-yellow-400' : 'bg-red-400'
              }`}
              title={`Target: ${t.margin}%`}
            />
          )}
        </div>
        <p className={`text-xl font-bold mt-1 ${
          kpis.marginPct >= 30 ? 'text-emerald-400' : kpis.marginPct >= 15 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          {kpis.totalRevenue > 0 ? `${kpis.marginPct.toFixed(1)}%` : '--'}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">Target: {t.margin}%</p>
        {openCard === 'margin' && (
          <KPISourcePopover cardId="margin" onClose={() => setOpenCard(null)}>
            <div className="space-y-1">
              <p className="text-gray-400">Margin = Profit / Revenue</p>
              <div className="flex justify-between"><span className="text-gray-400">Profit</span><span className={kpis.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>{kpis.totalProfit < 0 ? '-' : ''}{formatFullCurrency(Math.abs(kpis.totalProfit))}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">/ Revenue</span><span className="text-white">{formatFullCurrency(kpis.totalRevenue)}</span></div>
              <div className="flex justify-between border-t border-gray-700 pt-1 font-semibold"><span className="text-white">Margin</span><span className={kpis.marginPct >= 30 ? 'text-emerald-400' : kpis.marginPct >= 15 ? 'text-yellow-400' : 'text-red-400'}>{kpis.totalRevenue > 0 ? `${kpis.marginPct.toFixed(1)}%` : '--'}</span></div>
              <p className="text-gray-500 text-[10px] mt-1">Target: {t.margin}%</p>
            </div>
          </KPISourcePopover>
        )}
      </div>
    </div>
  );
}
