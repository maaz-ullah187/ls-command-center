// Default monthly projection targets for the operator's 3 programs.
// These serve as sensible defaults when no custom targets are set.
// Users can override via the "Set Targets" modal which persists to localStorage.

export interface ProgramTarget {
  name: string;
  program: 'Program A' | 'Program B' | 'Program C';
  /** Display label for the offer */
  label: string;
  /** Price per unit (approximate, for target calculation) */
  pricePerUnit: number;
  /** Monthly unit target */
  unitsTarget: number;
  /** Expected % of contracted revenue collected upfront */
  pctUpfront: number;
}

export interface MonthlyTargets {
  month: string; // 'YYYY-MM'
  programs: ProgramTarget[];
  /** Total new cash target for the month */
  totalCashTarget: number;
  /** Total AR expected to collect */
  arTarget: number;
  /** Total expense budget */
  expenseTarget: number;
  /** Target margin % */
  marginTarget: number;
}

export const DEFAULT_PROGRAM_TARGETS: ProgramTarget[] = [
  {
    name: 'Program A FE ($3.5k)',
    program: 'Program A',
    label: 'Program A FE',
    pricePerUnit: 3500,
    unitsTarget: 15,
    pctUpfront: 0.6,
  },
  {
    name: 'Program B BE ($10k)',
    program: 'Program B',
    label: 'Program B BE',
    pricePerUnit: 10000,
    unitsTarget: 10,
    pctUpfront: 0.5,
  },
  {
    name: 'Program C ($10k)',
    program: 'Program C',
    label: 'Program C',
    pricePerUnit: 10000,
    unitsTarget: 20,
    pctUpfront: 0.6,
  },
];

export function getDefaultTargets(month?: string): MonthlyTargets {
  const now = new Date();
  const m = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const programs = DEFAULT_PROGRAM_TARGETS;
  const totalProjectedRev = programs.reduce((s, p) => s + p.pricePerUnit * p.unitsTarget, 0);
  const totalCashTarget = programs.reduce(
    (s, p) => s + p.pricePerUnit * p.unitsTarget * p.pctUpfront,
    0,
  );

  return {
    month: m,
    programs,
    totalCashTarget,
    arTarget: 100000, // default AR collection target
    expenseTarget: 50000, // default monthly expense budget
    marginTarget: 40, // default 40% target margin
  };
}

// localStorage key for persisted targets
export const TARGETS_STORAGE_KEY = 'ls-projections-targets';

export interface SavedTargets {
  programs: ProgramTarget[];
  totalCashTarget: number;
  arTarget: number;
  expenseTarget: number;
  marginTarget: number;
}
