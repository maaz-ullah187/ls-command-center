// Shared types for the /today, /week, /month report routes.
//
// Each report function returns a `ReportCard<T>` — `fired` is the only
// field the page-level renderer reads to decide "show this card or not".
// `data` is whatever rows the drill-down wants to render.

export interface ReportCard<T = unknown> {
  /** Whether the card should render on /today (the trigger fired). */
  fired: boolean;
  /** Short human label for the alert count. */
  summary?: string;
  /** Rows the drill-down renders. */
  data: T[];
  /** Threshold metadata for yellow/red ramping when counts matter. */
  severity?: 'ok' | 'warning' | 'critical';
  /** Error string when the underlying query failed. Card renders grey. */
  error?: string;
}

/** Canonical list of /today card slugs, in render order (severity desc). */
export const TODAY_CARDS = [
  'dataSyncs',
  'unknownLeads',
  'staleNeedsReview',
  'unscoredRecordings',
  'largeExpense',
  'mislabeledExpense',
  'missedEod',
  'dealNotInSlack',
  'paymentNoDeal',
  'adBlowout',
  'zeroCallCampaign',
  'organicBelowTarget',
  'contentMissing',
] as const;

export type TodayCardSlug = (typeof TODAY_CARDS)[number];

export interface CashflowSummary {
  cashIn: number;
  payments: number;
  cashOut: number;
  net: number;
  date: string; // YYYY-MM-DD
}
