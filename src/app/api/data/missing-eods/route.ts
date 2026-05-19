import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// New-hire grace period: ignore closers whose start_date is within N days of
// today so we don't spam alerts for team members who just joined.
const NEW_HIRE_GRACE_DAYS = 3;

// Anomaly detection thresholds
const ANOMALY_MULTIPLIER = 3; // flag if value > 3× the closer's median
const MIN_REPORTS_FOR_ANOMALY = 5; // need at least 5 data points
const CASH_FLOOR = 5000; // don't flag small amounts even if 3× median

/** Check if EOD is expected on this date. Weekends (Sat + Sun) are exempt. */
function isExpectedEodDay(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return day !== 0 && day !== 6;
}

/** Get today's date in Eastern Time */
function getTodayET(): string {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.toISOString().split('T')[0];
}

/** Compute median of a number array */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Compute mean of a number array */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export interface MissingEod {
  closer: string;
  date: string;
  dayLabel: string;
}

export interface EodAnomaly {
  id: string;         // EOD report ID
  closer: string;
  date: string;
  dayLabel: string;
  field: string;       // 'cash_collected' | 'revenue_generated' | 'calls_closed' etc
  fieldLabel: string;  // human-readable
  value: number;
  median: number;
  average: number;
  multiplier: number;  // how many × above median
  severity: 'warning' | 'critical'; // warning = 3-5×, critical = 5×+
}

export async function GET() {
  try {
    const supabase = await getServerSupabaseAsync();
    if (!supabase) {
      return NextResponse.json({ missing: [], anomalies: [], total: 0 });
    }

    const today = getTodayET();

    // Expected closers come from t90_team_roster (active closers whose
    // start_date is at least NEW_HIRE_GRACE_DAYS old). Avoids hardcoding.
    const graceCutoff = new Date(today + 'T12:00:00');
    graceCutoff.setDate(graceCutoff.getDate() - NEW_HIRE_GRACE_DAYS);
    const graceCutoffStr = graceCutoff.toISOString().split('T')[0];

    const { data: roster } = await supabase
      .from('t90_team_roster')
      .select('name, role, active, start_date')
      .eq('role', 'closer')
      .eq('active', true)
      .lte('start_date', graceCutoffStr);
    const EXPECTED_CLOSERS: string[] = (roster ?? []).map((r: { name: string }) => r.name);

    // Pull ALL EOD reports (need full history for anomaly baseline)
    const { data: allEods } = await supabase
      .from('t05_eod_reports')
      .select('id, date, closer_name, calls_shown, calls_closed, cash_collected, revenue_generated, calls_booked, no_shows, offers_given, deposits')
      .order('date', { ascending: true });

    const eods = allEods ?? [];

    // ── Missing EOD detection ────────────────────────────────────────────
    const lookbackDate = new Date(today + 'T12:00:00');
    lookbackDate.setDate(lookbackDate.getDate() - 14);
    const startDate = lookbackDate.toISOString().split('T')[0];

    // Build TWO sets for matching: full name AND first-name-only.
    // Roster often has "Closer Three" while Slack EOD posts as just "Closer Three"
    // — same person, names don't match exactly. We accept either match.
    const reportedFull = new Set<string>();   // `${date}|${full lowercase}`
    const reportedFirst = new Set<string>();  // `${date}|${first-word lowercase}`
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const firstName = (s: string) => norm(s).split(/\s+/)[0] || '';
    for (const eod of eods) {
      const full = norm(eod.closer_name);
      const fn = firstName(eod.closer_name);
      reportedFull.add(`${eod.date}|${full}`);
      if (fn) reportedFirst.add(`${eod.date}|${fn}`);
    }

    // Excused (closer, date) pairs — added to reportedSet so the detector
    // skips them. Table created in migration 0027. We swallow read errors
    // (e.g. table not yet migrated) so this stays backward-compatible.
    const excusedSet = new Set<string>();
    try {
      const { data: excused } = await supabase
        .from('t05a_eod_excused')
        .select('closer, date');
      for (const row of (excused ?? []) as Array<{ closer: string; date: string }>) {
        excusedSet.add(`${row.date}|${row.closer}`);
      }
    } catch {
      /* table not migrated yet — fine */
    }

    const missing: MissingEod[] = [];
    const d = new Date(startDate + 'T12:00:00');
    const yesterdayDate = new Date(today + 'T12:00:00');
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);

    while (d <= yesterdayDate) {
      const ds = d.toISOString().split('T')[0];
      if (isExpectedEodDay(ds)) {
        for (const closer of EXPECTED_CLOSERS) {
          const fullKey = `${ds}|${norm(closer)}`;
          const firstKey = `${ds}|${firstName(closer)}`;
          const excuseKey = `${ds}|${closer}`;
          const submitted =
            reportedFull.has(fullKey) ||
            reportedFirst.has(firstKey) ||
            reportedFull.has(firstKey);  // covers case where roster has "Closer Three" too
          if (!submitted && !excusedSet.has(excuseKey)) {
            missing.push({
              closer,
              date: ds,
              dayLabel: d.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              }),
            });
          }
        }
      }
      d.setDate(d.getDate() + 1);
    }

    missing.sort((a, b) => b.date.localeCompare(a.date));

    // ── Anomaly detection ────────────────────────────────────────────────
    // Group EODs by closer
    const byCloser = new Map<string, typeof eods>();
    for (const eod of eods) {
      const name = eod.closer_name;
      if (!byCloser.has(name)) byCloser.set(name, []);
      byCloser.get(name)!.push(eod);
    }

    const anomalies: EodAnomaly[] = [];

    // Fields to check for anomalies
    const fieldsToCheck: { key: string; label: string; floor: number }[] = [
      { key: 'cash_collected', label: 'Cash Collected', floor: CASH_FLOOR },
      { key: 'revenue_generated', label: 'Revenue Generated', floor: CASH_FLOOR },
      { key: 'calls_closed', label: 'Deals Closed', floor: 3 },
      { key: 'calls_shown', label: 'Calls Shown', floor: 8 },
    ];

    for (const [closerName, reports] of byCloser) {
      if (reports.length < MIN_REPORTS_FOR_ANOMALY) continue;

      for (const field of fieldsToCheck) {
        // Get all non-zero values for this field to build baseline
        const allValues = reports.map((r: any) => Number(r[field.key]) || 0);
        const nonZeroValues = allValues.filter((v: number) => v > 0);

        if (nonZeroValues.length < 3) continue; // need at least 3 non-zero data points

        const med = median(nonZeroValues);
        const avg = mean(nonZeroValues);

        if (med === 0) continue;

        // Check each report against the baseline
        for (const report of reports) {
          const value = Number((report as any)[field.key]) || 0;

          // Skip zero values and values below the floor
          if (value <= 0 || value < field.floor) continue;

          const mult = value / med;

          if (mult >= ANOMALY_MULTIPLIER) {
            const reportDate = new Date(report.date + 'T12:00:00');
            anomalies.push({
              id: report.id,
              closer: closerName,
              date: report.date,
              dayLabel: reportDate.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              }),
              field: field.key,
              fieldLabel: field.label,
              value,
              median: Math.round(med),
              average: Math.round(avg),
              multiplier: Math.round(mult * 10) / 10,
              severity: mult >= 5 ? 'critical' : 'warning',
            });
          }
        }
      }
    }

    // Excused (eod_id, field) pairs — filter out anomalies the team has
    // already reviewed and marked as legitimate. Table created in migration
    // 0030. Swallow read errors so missing-table doesn't break the route.
    const excusedAnomalySet = new Set<string>();
    try {
      const { data: excusedAnomalies } = await supabase
        .from('t05b_eod_anomaly_excused')
        .select('eod_id, field');
      for (const row of (excusedAnomalies ?? []) as Array<{ eod_id: string; field: string }>) {
        excusedAnomalySet.add(`${row.eod_id}|${row.field}`);
      }
    } catch {
      /* table not migrated yet — fine */
    }

    const filteredAnomalies = anomalies.filter(
      (a) => !excusedAnomalySet.has(`${a.id}|${a.field}`)
    );

    // Sort anomalies: critical first, then by date descending
    filteredAnomalies.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return b.date.localeCompare(a.date);
    });

    return NextResponse.json({
      missing,
      anomalies: filteredAnomalies,
      total: missing.length + filteredAnomalies.length,
      expectedClosers: EXPECTED_CLOSERS,
      lookbackStart: startDate,
      today,
    });
  } catch (err: any) {
    console.error('[missing-eods]', err);
    return NextResponse.json({ missing: [], anomalies: [], total: 0, error: err?.message });
  }
}
