'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useTimeframe, PRESET_DEFS } from '@/lib/useTimeframe';
import { priorPeriodFor } from '@/lib/timeframe';
import TimeframeSelector, { type DateRange } from '@/components/TimeframeSelector';
import CardShell from './CardShell';
import type { CloserLeaderboardRow } from '@/lib/reports/main';

const fmtUSD = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(0)}%`;

type SortKey = keyof Pick<
  CloserLeaderboardRow,
  | 'closer'
  | 'booked'
  | 'showed'
  | 'noShows'
  | 'cancelled'
  | 'showPct'
  | 'cancelPct'
  | 'closed'
  | 'closePct'
  | 'newDeals'
  | 'upsells'
  | 'cash'
  | 'contracted'
  | 'cashPerCall'
>;
type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  px: 'px-3' | 'px-5';
  defaultDir: SortDir;
}

const CLOSER_COLUMNS: ColumnDef[] = [
  { key: 'closer',       label: 'Closer',     align: 'left',  px: 'px-5', defaultDir: 'asc'  },
  { key: 'booked',       label: 'Booked',     align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'showed',       label: 'Showed',     align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'noShows',      label: 'No Shows',   align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'cancelled',    label: 'Cancels',    align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'showPct',      label: 'Show%',      align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'closed',       label: 'Closed',     align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'closePct',     label: 'Close%',     align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'cashPerCall',  label: 'Cash/Call',  align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'cash',         label: 'Cash',       align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'contracted',   label: 'Contracted', align: 'right', px: 'px-5', defaultDir: 'desc' },
];

const SETTER_COLUMNS: ColumnDef[] = [
  { key: 'closer',       label: 'Setter',     align: 'left',  px: 'px-5', defaultDir: 'asc'  },
  { key: 'booked',       label: 'Booked',     align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'showed',       label: 'Showed',     align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'noShows',      label: 'No Shows',   align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'cancelled',    label: 'Cancels',    align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'showPct',      label: 'Show%',      align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'cash',         label: 'Cash',       align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'contracted',   label: 'Contracted', align: 'right', px: 'px-5', defaultDir: 'desc' },
];

const CSM_COLUMNS: ColumnDef[] = [
  { key: 'closer',       label: 'CSM',        align: 'left',  px: 'px-5', defaultDir: 'asc'  },
  { key: 'upsells',      label: 'Upsells',    align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'cash',         label: 'Cash',       align: 'right', px: 'px-3', defaultDir: 'desc' },
  { key: 'contracted',   label: 'Contracted', align: 'right', px: 'px-5', defaultDir: 'desc' },
];

function sortRows(rows: CloserLeaderboardRow[], key: SortKey, dir: SortDir): CloserLeaderboardRow[] {
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key] as number | string;
    const bv = b[key] as number | string;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  });
}

interface SortableHeaderProps {
  col: ColumnDef;
  activeKey: SortKey;
  activeDir: SortDir;
  onClick: (key: SortKey) => void;
}
function SortableHeader({ col, activeKey, activeDir, onClick }: SortableHeaderProps) {
  const active = activeKey === col.key;
  const Icon = !active ? ChevronsUpDown : activeDir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th
      onClick={() => onClick(col.key)}
      className={`${col.align === 'left' ? 'text-left' : 'text-right'} ${col.px} py-2 font-semibold cursor-pointer select-none hover:text-gray-300 transition-colors ${active ? 'text-blue-300' : ''}`}
    >
      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'justify-end w-full' : ''}`}>
        {col.label}
        <Icon size={11} className="opacity-60" />
      </span>
    </th>
  );
}

/**
 * Trend arrow + delta tooltip for a single metric. Compares current vs
 * prior period. Always renders a fixed-width slot (even when there's no
 * prior data) so column numbers stay vertically aligned across rows.
 * the operator 2026-04-30.
 */
function TrendArrow({ current, prior, inverse = false }: { current: number; prior: number | undefined; inverse?: boolean }) {
  // Fixed 14px slot reserved on every row so numbers right-align cleanly
  if (prior === undefined || prior === null) {
    return <span className="inline-block w-[14px]" />;
  }
  if (current === prior) {
    return (
      <span className="inline-flex items-center justify-center w-[14px] opacity-40">
        <Minus size={10} />
      </span>
    );
  }
  const up = current > prior;
  // For "inverse" metrics (no_shows, cancels) up = bad, down = good
  const good = inverse ? !up : up;
  const Icon = up ? ArrowUp : ArrowDown;
  const cls = good ? 'text-emerald-400' : 'text-rose-400';
  const delta = current - prior;
  const pct = prior > 0 ? ((delta / prior) * 100).toFixed(0) : '∞';
  return (
    <span
      title={`Prior: ${prior.toLocaleString()} (${delta > 0 ? '+' : ''}${pct}%)`}
      className={`inline-flex items-center justify-center w-[14px] ${cls}`}
    >
      <Icon size={10} />
    </span>
  );
}

/**
 * Renders a numeric cell with a right-aligned value + a fixed-width trend
 * arrow slot. Using tabular-nums + a wrapping flex container so digits and
 * arrows line up across rows regardless of value width or arrow presence.
 */
function MetricCell({
  display,
  current,
  prior,
  inverse = false,
  className = '',
  pad = 'px-3',
}: {
  display: string;
  current: number;
  prior: number | undefined;
  inverse?: boolean;
  className?: string;
  pad?: string;
}) {
  return (
    <td className={`${pad} py-2 text-right tabular-nums ${className}`}>
      <span className="inline-flex items-center justify-end gap-1">
        <span>{display}</span>
        <TrendArrow current={current} prior={prior} inverse={inverse} />
      </span>
    </td>
  );
}

/**
 * Combined Closers + Setters + CSMs leaderboard.
 *   - Closers: full pipeline — Booked / Showed / No Shows / Cancels /
 *     Show% / Closed / Close% / Cash/Call / Cash / Contracted
 *   - Setters: pipeline activity (Booked / Showed) — they generate
 *     appointments, occasionally close one, but don't drive headline cash
 *   - CSMs: cash + contracted + #upsells only
 *
 * the operator 2026-04-30:
 *   - Sortable columns (click any header)
 *   - Trend arrows vs prior period — see who's improving / declining
 *   - Cash Per Call as the headline closer metric
 *   - DM setters surface in their own setter section
 */
export default function CloserLeaderboardCard() {
  // the operator 2026-05-01: this card now SYNCS with the global timeframe by
  // default — picking "Last Month" updates everything in lockstep. The
  // user can still click the card-level picker to deviate; once they do,
  // the local override sticks until they switch the global filter again.
  const globalTf = useTimeframe();
  const [localRange, setLocalRange] = useState<DateRange>(() => ({
    start: globalTf.from,
    end: globalTf.to,
    label: globalTf.label,
  }));
  const [localPreset, setLocalPreset] = useState<string>(globalTf.preset || 'this-month');

  // Whenever the global timeframe changes, snap this card to it. Without
  // this, the card stayed pinned on whatever the user had previously set
  // (e.g. "Last Month") even after they switched the global to "This Month".
  useEffect(() => {
    setLocalRange({ start: globalTf.from, end: globalTf.to, label: globalTf.label });
    setLocalPreset(globalTf.preset || 'this-month');
  }, [globalTf.from, globalTf.to, globalTf.preset, globalTf.label]);

  const handleTfChange = (r: DateRange) => {
    setLocalRange(r);
    // Detect preset match for prior-period calculation
    const presetMatch = (Object.keys(PRESET_DEFS) as Array<keyof typeof PRESET_DEFS>).find((k) => {
      const p = PRESET_DEFS[k]();
      return p.from === r.start && p.to === r.end;
    });
    setLocalPreset(presetMatch || 'custom');
  };

  const from = localRange.start;
  const to = localRange.end;

  const [rows, setRows] = useState<CloserLeaderboardRow[]>([]);
  const [priorRows, setPriorRows] = useState<CloserLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [closerSort, setCloserSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'cashPerCall', dir: 'desc' });
  const [setterSort, setSetterSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'booked', dir: 'desc' });
  const [csmSort, setCsmSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'cash', dir: 'desc' });

  useEffect(() => {
    setLoading(true);
    const prior = priorPeriodFor({ from, to, preset: localPreset, label: localRange.label });
    Promise.all([
      fetch(`/api/main/closers?from=${from}&to=${to}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/main/closers?from=${prior.from}&to=${prior.to}`).then((r) => r.json()).catch(() => null),
    ])
      .then(([cur, prv]) => {
        setRows(Array.isArray(cur?.rows) ? cur.rows : []);
        setPriorRows(Array.isArray(prv?.rows) ? prv.rows : []);
      })
      .finally(() => setLoading(false));
  }, [from, to, localPreset, localRange.label]);

  const priorByName = useMemo(() => {
    const m = new Map<string, CloserLeaderboardRow>();
    for (const r of priorRows) m.set(r.closer.toLowerCase(), r);
    return m;
  }, [priorRows]);

  const getPrior = (name: string) => priorByName.get(name.toLowerCase());

  const closers = useMemo(
    () => sortRows(rows.filter((r) => r.role === 'closer'), closerSort.key, closerSort.dir),
    [rows, closerSort]
  );
  const setters = useMemo(
    () => sortRows(rows.filter((r) => r.role === 'setter'), setterSort.key, setterSort.dir),
    [rows, setterSort]
  );
  const csms = useMemo(
    () => sortRows(rows.filter((r) => r.role === 'csm'), csmSort.key, csmSort.dir),
    [rows, csmSort]
  );

  const sortHandler = (
    setter: typeof setCloserSort,
    columns: ColumnDef[]
  ) => (key: SortKey) => {
    setter((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      const def = columns.find((c) => c.key === key)?.defaultDir ?? 'desc';
      return { key, dir: def };
    });
  };

  return (
    <CardShell
      title="Closer · Setter · CSM Leaderboard"
      subtitle="Click any column to sort · arrows show trend vs prior period"
      cardId="main:closer-leaderboard"
      headerExtra={
        <div className="flex items-center">
          <TimeframeSelector value={localRange} onChange={handleTfChange} />
        </div>
      }
    >
      {loading ? (
        <div className="text-gray-500 text-xs py-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-xs py-8 text-center">No activity in this window.</div>
      ) : (
        <div className="space-y-5 -mx-5">
          {/* ─── Closers ─── */}
          <div>
            <div className="px-5 pb-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Closers
            </div>
            {closers.length === 0 ? (
              <div className="px-5 text-gray-500 text-xs py-2">No closer activity in this window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                      {CLOSER_COLUMNS.map((c) => (
                        <SortableHeader key={c.key} col={c} activeKey={closerSort.key} activeDir={closerSort.dir} onClick={sortHandler(setCloserSort, CLOSER_COLUMNS)} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {closers.map((r) => {
                      const p = getPrior(r.closer);
                      return (
                        <tr key={r.closer} className="border-b border-gray-800/50 hover:bg-black/20">
                          <td className="px-5 py-2 text-white font-medium whitespace-nowrap">{r.closer}</td>
                          <MetricCell display={String(r.booked)}        current={r.booked}      prior={p?.booked}      className="text-gray-300" />
                          <MetricCell display={String(r.showed)}        current={r.showed}      prior={p?.showed}      className="text-gray-300" />
                          <MetricCell display={String(r.noShows)}       current={r.noShows}     prior={p?.noShows}     inverse className="text-rose-300" />
                          <MetricCell display={String(r.cancelled)}     current={r.cancelled}   prior={p?.cancelled}   inverse className="text-amber-300" />
                          <MetricCell display={fmtPct(r.showPct)}       current={r.showPct}     prior={p?.showPct}     className="text-gray-400" />
                          <MetricCell display={String(r.closed)}        current={r.closed}      prior={p?.closed}      className="text-gray-300" />
                          <MetricCell display={fmtPct(r.closePct)}      current={r.closePct}    prior={p?.closePct}    className="text-gray-400" />
                          <MetricCell display={fmtUSD(r.cashPerCall)}   current={r.cashPerCall} prior={p?.cashPerCall} className="text-cyan-300 font-semibold" />
                          <MetricCell display={fmtUSD(r.cash)}          current={r.cash}        prior={p?.cash}        className="text-emerald-300" />
                          <MetricCell display={fmtUSD(r.contracted)}    current={r.contracted}  prior={p?.contracted}  className="text-blue-300" pad="px-5" />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ─── Setters ─── */}
          <div>
            <div className="px-5 pb-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Setters
            </div>
            {setters.length === 0 ? (
              <div className="px-5 text-gray-500 text-xs py-2">No setter activity in this window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                      {SETTER_COLUMNS.map((c) => (
                        <SortableHeader key={c.key} col={c} activeKey={setterSort.key} activeDir={setterSort.dir} onClick={sortHandler(setSetterSort, SETTER_COLUMNS)} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {setters.map((r) => {
                      const p = getPrior(r.closer);
                      return (
                        <tr key={r.closer} className="border-b border-gray-800/50 hover:bg-black/20">
                          <td className="px-5 py-2 text-white font-medium whitespace-nowrap">{r.closer}</td>
                          <MetricCell display={String(r.booked)}     current={r.booked}     prior={p?.booked}     className="text-gray-300" />
                          <MetricCell display={String(r.showed)}     current={r.showed}     prior={p?.showed}     className="text-gray-300" />
                          <MetricCell display={String(r.noShows)}    current={r.noShows}    prior={p?.noShows}    inverse className="text-rose-300" />
                          <MetricCell display={String(r.cancelled)}  current={r.cancelled}  prior={p?.cancelled}  inverse className="text-amber-300" />
                          <MetricCell display={fmtPct(r.showPct)}    current={r.showPct}    prior={p?.showPct}    className="text-gray-400" />
                          <MetricCell display={fmtUSD(r.cash)}       current={r.cash}       prior={p?.cash}       className="text-emerald-300" />
                          <MetricCell display={fmtUSD(r.contracted)} current={r.contracted} prior={p?.contracted} className="text-blue-300" pad="px-5" />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ─── CSMs ─── */}
          <div>
            <div className="px-5 pb-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              CSMs
            </div>
            {csms.length === 0 ? (
              <div className="px-5 text-gray-500 text-xs py-2">No CSM activity in this window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold border-b border-gray-800">
                      {CSM_COLUMNS.map((c) => (
                        <SortableHeader key={c.key} col={c} activeKey={csmSort.key} activeDir={csmSort.dir} onClick={sortHandler(setCsmSort, CSM_COLUMNS)} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csms.map((r) => {
                      const p = getPrior(r.closer);
                      return (
                        <tr key={r.closer} className="border-b border-gray-800/50 hover:bg-black/20">
                          <td className="px-5 py-2 text-white font-medium whitespace-nowrap">{r.closer}</td>
                          <MetricCell display={String(r.upsells)}    current={r.upsells}    prior={p?.upsells}    className="text-purple-300" />
                          <MetricCell display={fmtUSD(r.cash)}       current={r.cash}       prior={p?.cash}       className="text-emerald-300" />
                          <MetricCell display={fmtUSD(r.contracted)} current={r.contracted} prior={p?.contracted} className="text-blue-300" pad="px-5" />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </CardShell>
  );
}
