'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface DateRange {
  start: string;
  end: string;
  label: string;
}

interface TimeframeSelectorProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

// ---------- date helpers ----------
const pad = (n: number) => n.toString().padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISO(d);
};
const weekStart = () => {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return toISO(d);
};
const monthStart = () => {
  const d = new Date();
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
};
const monthName = (d: Date) => d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
const addMonths = (d: Date, n: number) => {
  const nd = new Date(d);
  nd.setMonth(nd.getMonth() + n);
  return nd;
};
const formatLabel = (range: { start: string; end: string }) => {
  const s = fromISO(range.start);
  const e = fromISO(range.end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (range.start === range.end) return s.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  if (s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
  }
  return `${s.toLocaleDateString('en-US', { ...opts, year: 'numeric' })} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
};

// the operator 2026-05-01: "Last Month" preset added so he can one-click
// pull all of last calendar month's data instead of dragging across
// the dual-month grid every time.
function lastMonthRangeLocal(): { start: string; end: string } {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return {
    start: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`,
    end: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(lastDay)}`,
  };
}

const PRESETS: { label: string; range: () => { start: string; end: string; label: string } }[] = [
  { label: 'Today', range: () => ({ start: toISO(new Date()), end: toISO(new Date()), label: 'Today' }) },
  { label: 'This Week', range: () => ({ start: weekStart(), end: toISO(new Date()), label: 'This Week' }) },
  { label: 'This Month', range: () => ({ start: monthStart(), end: toISO(new Date()), label: 'This Month' }) },
  { label: 'Last Month', range: () => {
      const { start, end } = lastMonthRangeLocal();
      return { start, end, label: 'Last Month' };
    },
  },
  { label: 'Last 7 Days', range: () => ({ start: daysAgo(6), end: toISO(new Date()), label: 'Last 7 Days' }) },
  { label: 'Last 30 Days', range: () => ({ start: daysAgo(29), end: toISO(new Date()), label: 'Last 30 Days' }) },
  { label: 'Last 90 Days', range: () => ({ start: daysAgo(89), end: toISO(new Date()), label: 'Last 90 Days' }) },
  { label: 'Year to Date', range: () => ({ start: `${new Date().getFullYear()}-01-01`, end: toISO(new Date()), label: 'Year to Date' }) },
  { label: 'All Time', range: () => ({ start: '2020-01-01', end: toISO(new Date()), label: 'All Time' }) },
];

export default function TimeframeSelector({ value, onChange }: TimeframeSelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 bg-[#1a1d23] border border-gray-700 hover:border-gray-500 rounded-lg px-3 py-1.5 text-xs text-gray-300 transition-colors"
      >
        <Calendar size={13} className="text-blue-400" />
        <span className="font-medium">{value.label}</span>
      </button>

      {open && <DateRangeModal value={value} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ---------- Modal ---------- */

function DateRangeModal({
  value,
  onChange,
  onClose,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  onClose: () => void;
}) {
  // Working state inside the modal — only commit on Apply
  const [start, setStart] = useState<string>(value.start);
  const [end, setEnd] = useState<string>(value.end);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [selectingEnd, setSelectingEnd] = useState(false);

  // Left month anchor (left shows this month, right shows +1)
  const initialLeft = (() => {
    const d = fromISO(start);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  })();
  const [leftMonth, setLeftMonth] = useState<Date>(initialLeft);
  const rightMonth = addMonths(leftMonth, 1);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    const r = p.range();
    setStart(r.start);
    setEnd(r.end);
    setSelectingEnd(false);
    // Jump the left calendar to show the end month - 1 so both months are relevant
    const endDate = fromISO(r.end);
    setLeftMonth(new Date(endDate.getFullYear(), endDate.getMonth() - 1, 1));
  };

  const handleDayClick = (iso: string) => {
    if (!selectingEnd) {
      // First click sets start, clears end
      setStart(iso);
      setEnd(iso);
      setSelectingEnd(true);
    } else {
      // Second click sets end (if after start) or resets
      if (iso < start) {
        setStart(iso);
        setEnd(iso);
      } else {
        setEnd(iso);
        setSelectingEnd(false);
      }
    }
  };

  const handleApply = () => {
    const activePreset = PRESETS.find((p) => {
      const r = p.range();
      return r.start === start && r.end === end;
    });
    const label = activePreset ? activePreset.label : formatLabel({ start, end });
    onChange({ start, end, label });
    onClose();
  };

  // For hover range highlight while selecting end
  const effectiveEnd = selectingEnd && hoverDate && hoverDate >= start ? hoverDate : end;

  // the operator 2026-05-01: portal to document.body so the modal escapes
  // any ancestor with `transform`/`filter`/`perspective`/`will-change`
  // — those create a containing block that traps `position: fixed`
  // children, which is why the modal was rendering off-viewport with
  // the page content showing through. SSR-safe: only portal once
  // mounted on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const overlay = (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4"
      onClick={onClose}
    >
      {/*
        Conventional flex-column modal: header (fixed) + scrollable
        body (presets + calendars) + footer (fixed). Total height
        capped at 90vh so the panel always fits in the viewport.
      */}
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed at top */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <h3 className="text-white font-bold text-base">Select Date Range</h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body — presets + calendars together so user can
            still reach all presets even on a really short window. */}
        <div className="overflow-y-auto flex-1">
          {/* Presets */}
          <div className="flex items-center gap-1 px-4 pt-4 pb-3 border-b border-gray-700 flex-wrap">
            {PRESETS.map((p) => {
              const r = p.range();
              const isActive = r.start === start && r.end === end;
              return (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Dual Month Calendar */}
          <div className="p-5">
            {/* Nav */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex items-center gap-8 flex-1 justify-around">
                <h4 className="text-white font-semibold text-sm">{monthName(leftMonth)}</h4>
                <h4 className="text-white font-semibold text-sm">{monthName(rightMonth)}</h4>
              </div>
              <button
                onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Two calendars */}
            <div className="grid grid-cols-2 gap-6">
              <MonthCalendar
                month={leftMonth}
                start={start}
                end={effectiveEnd}
                onDayClick={handleDayClick}
                onDayHover={setHoverDate}
              />
              <MonthCalendar
                month={rightMonth}
                start={start}
                end={effectiveEnd}
                onDayClick={handleDayClick}
                onDayHover={setHoverDate}
              />
            </div>
          </div>
        </div>

        {/* Footer — fixed at bottom, Apply/Cancel always reachable */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-700 bg-black/20 flex-shrink-0">
          <div className="text-xs text-gray-400">
            <span className="text-gray-500">Selected:</span>{' '}
            <span className="text-white font-medium">{formatLabel({ start, end })}</span>
            {selectingEnd && (
              <span className="ml-2 text-amber-400">Pick end date...</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

/* ---------- Single month calendar grid ---------- */

function MonthCalendar({
  month,
  start,
  end,
  onDayClick,
  onDayHover,
}: {
  month: Date;
  start: string;
  end: string;
  onDayClick: (iso: string) => void;
  onDayHover: (iso: string | null) => void;
}) {
  const year = month.getFullYear();
  const mo = month.getMonth();
  const firstDay = new Date(year, mo, 1);
  const lastDay = new Date(year, mo + 1, 0);
  const startDayOfWeek = firstDay.getDay(); // 0 = Sun
  const daysInMonth = lastDay.getDate();

  // Build 6x7 grid (42 cells) with leading blanks
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDayOfWeek; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  const todayISO = toISO(new Date());
  const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <div>
      {/* Weekday row */}
      <div className="grid grid-cols-7 gap-0 mb-1">
        {weekdayLabels.map((w) => (
          <div
            key={w}
            className="text-center text-[10px] text-gray-600 font-semibold uppercase py-1"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="aspect-square" />;
          const iso = `${year}-${pad(mo + 1)}-${pad(d)}`;
          const isStart = iso === start;
          const isEnd = iso === end;
          const inRange = iso > start && iso < end;
          const isToday = iso === todayISO;
          const isSelected = isStart || isEnd;

          return (
            <button
              key={i}
              onClick={() => onDayClick(iso)}
              onMouseEnter={() => onDayHover(iso)}
              onMouseLeave={() => onDayHover(null)}
              className={`
                aspect-square flex items-center justify-center text-xs font-medium
                transition-all relative
                ${isSelected ? 'bg-blue-600 text-white z-10 rounded-md' : ''}
                ${inRange && !isSelected ? 'bg-blue-600/20 text-blue-200' : ''}
                ${!isSelected && !inRange ? 'text-gray-400 hover:bg-gray-800 hover:text-white rounded-md' : ''}
                ${isToday && !isSelected ? 'ring-1 ring-gray-600 rounded-md' : ''}
              `}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
