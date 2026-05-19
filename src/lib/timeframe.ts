// src/lib/timeframe.ts
// Pure server-safe timeframe helpers. NO 'use client' here — imported by
// /api/* routes. The client-side hook lives in useTimeframe.ts and re-exports.

export type TimeframePreset =
  | 'today'
  | 'this-week'
  | 'this-month'
  | 'last-month'
  | 'last-7'
  | 'last-30'
  | 'last-90'
  | 'ytd'
  | 'all-time'
  | 'custom';

export interface TimeframeValue {
  from: string; // ISO YYYY-MM-DD
  to: string;   // ISO YYYY-MM-DD
  preset: TimeframePreset;
  label: string;
}

const pad = (n: number) => n.toString().padStart(2, '0');
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ── Eastern Time helpers ────────────────────────────────────────────
// the operator 2026-04-30: Vercel runs functions in UTC. When it's evening ET
// the server's `new Date()` already says tomorrow, so MTD windows + "today"
// were rolling into May while the user was still on April 30 ET.
// All "what day is it" computations for dashboard windows go through
// these helpers — they always reflect the operator's wall clock (America/
// New_York), regardless of where the function is running.
const TZ = 'America/New_York';
const ET_PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
});
function nowETParts(): { year: number; month: number; day: number } {
  const parts = ET_PARTS_FMT.formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}
/** Today's date in ET as YYYY-MM-DD. */
export function todayET(): string {
  const { year, month, day } = nowETParts();
  return `${year}-${pad(month)}-${pad(day)}`;
}
/** N days before today in ET as YYYY-MM-DD. */
export function daysAgoET(n: number): string {
  const { year, month, day } = nowETParts();
  // Anchor at noon UTC on the ET date so DST shifts don't bump us a day.
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** Yesterday in ET. Sugar for daysAgoET(1). */
export function yesterdayET(): string { return daysAgoET(1); }
/** Week-start (Sunday) in ET as YYYY-MM-DD. */
export function weekStartET(): string {
  const { year, month, day } = nowETParts();
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** First-of-month in ET as YYYY-MM-DD. */
export function monthStartET(): string {
  const { year, month } = nowETParts();
  return `${year}-${pad(month)}-01`;
}
/** Year in ET as 4-digit number. */
export function yearET(): number {
  return nowETParts().year;
}
/** Current month in ET as YYYY-MM. */
export function monthYM_ET(): string {
  const { year, month } = nowETParts();
  return `${year}-${pad(month)}`;
}
/** Prior month in ET as YYYY-MM. Handles January → previous-year December. */
export function priorMonthYM_ET(): string {
  const { year, month } = nowETParts();
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${pad(prevMonth)}`;
}
/**
 * Last full calendar month in ET as { from, to } ISO date strings.
 * e.g. on May 5, 2026 returns { from: '2026-04-01', to: '2026-04-30' }.
 * the operator 2026-05-01: one-click "show me all of last month" preset.
 */
export function lastMonthRange_ET(): { from: string; to: string } {
  const { year, month } = nowETParts();
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  // Last day of `prevMonth` = day 0 of the *next* month after it.
  const lastDay = new Date(prevYear, prevMonth, 0).getDate();
  return {
    from: `${prevYear}-${pad(prevMonth)}-01`,
    to: `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`,
  };
}

// Internal aliases — kept short for the PRESET_DEFS map below.
const today = todayET;
const daysAgo = daysAgoET;
const weekStart = weekStartET;
const monthStart = monthStartET;

export const PRESET_DEFS: Record<Exclude<TimeframePreset, 'custom'>, () => { from: string; to: string; label: string }> = {
  'today': () => ({ from: today(), to: today(), label: 'Today' }),
  'this-week': () => ({ from: weekStart(), to: today(), label: 'This Week' }),
  'this-month': () => ({ from: monthStart(), to: today(), label: 'This Month' }),
  'last-month': () => {
    const { from, to } = lastMonthRange_ET();
    // Build a friendly label like "April 2026"
    const [yStr, mStr] = from.split('-');
    const labelDate = new Date(Number(yStr), Number(mStr) - 1, 1);
    return { from, to, label: `Last Month (${labelDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })})` };
  },
  'last-7': () => ({ from: daysAgo(6), to: today(), label: 'Last 7 Days' }),
  'last-30': () => ({ from: daysAgo(29), to: today(), label: 'Last 30 Days' }),
  'last-90': () => ({ from: daysAgo(89), to: today(), label: 'Last 90 Days' }),
  'ytd': () => ({ from: `${yearET()}-01-01`, to: today(), label: 'Year to Date' }),
  'all-time': () => ({ from: '2020-01-01', to: today(), label: 'All Time' }),
};

export const DEFAULT_PRESET: TimeframePreset = 'this-month';

export function resolveFromParams(preset: string | null, from: string | null, to: string | null): TimeframeValue {
  if (preset && preset in PRESET_DEFS) {
    const p = preset as Exclude<TimeframePreset, 'custom'>;
    const r = PRESET_DEFS[p]();
    return { ...r, preset: p };
  }
  if (from && to) {
    return { from, to, preset: 'custom', label: `${from} → ${to}` };
  }
  const def = PRESET_DEFS[DEFAULT_PRESET as Exclude<TimeframePreset, 'custom'>]();
  return { ...def, preset: DEFAULT_PRESET };
}

/**
 * Compute the comparable prior-period window for a given current window.
 * For monthly windows it goes to the previous-calendar-month, equivalent
 * day count. For other ranges it walks back the same span.
 */
export function priorPeriodFor(window: TimeframeValue): { from: string; to: string; label: string } {
  if (window.preset === 'this-month') {
    const today = new Date(window.to + 'T00:00:00Z');
    const startCur = new Date(window.from + 'T00:00:00Z');
    // First day of previous month
    const prevStart = new Date(Date.UTC(startCur.getUTCFullYear(), startCur.getUTCMonth() - 1, 1));
    // Same day-of-month as `today` (capped to end of prev month)
    const dayOfMonth = today.getUTCDate();
    const lastDayOfPrev = new Date(Date.UTC(startCur.getUTCFullYear(), startCur.getUTCMonth(), 0)).getUTCDate();
    const prevEnd = new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), Math.min(dayOfMonth, lastDayOfPrev)));
    return { from: toISO(prevStart), to: toISO(prevEnd), label: 'Prior month' };
  }
  // Generic: shift back by the span length
  const a = new Date(window.from + 'T00:00:00Z').getTime();
  const b = new Date(window.to + 'T00:00:00Z').getTime();
  const span = b - a;
  const prevEnd = new Date(a - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - span);
  return { from: toISO(prevStart), to: toISO(prevEnd), label: 'Prior period' };
}

/**
 * Server-side helper: parse a request's URLSearchParams into a TimeframeValue.
 */
export function timeframeFromSearchParams(searchParams: URLSearchParams): TimeframeValue {
  return resolveFromParams(
    searchParams.get('preset'),
    searchParams.get('from'),
    searchParams.get('to')
  );
}
