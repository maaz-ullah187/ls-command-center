import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/main/ltv-cac
 *
 * Returns ltvByProgram[] — average lifetime value per program, sourced from
 * t_client_ledger (the canonical client table populated daily from the operator's
 * published Google Sheet payment log via /api/sync/client-ledger).
 *
 * Three canonical buckets only: Program A, Program B, Program C.
 * Variants ("Agent Build (DFY)", "Program C Coaching (DWY)", "AI Consultation")
 * all collapse to Program C.
 *
 * Mature-cohort filter: clients whose date_paid was ≥ 90 days ago. New
 * clients haven't had time for follow-up payments yet so including them
 * drags the average down.
 */

interface LTVRow {
  program: string;
  clientCount: number;
  newCount: number;
  totalLtv: number;
  avgLtv: number;
}

const MATURITY_DAYS = 90;

/** Map raw program name → one of three canonical offers. */
function canonicalProgram(raw: string | null | undefined): string | null {
  const p = (raw ?? '').trim().toLowerCase();
  if (!p) return null;
  if (p.includes('program a')) return 'Program A';
  if (p.includes('program b')) return 'Program B';
  if (p.includes('program c') || /\bai\b/.test(p) || p.includes('agent build') || p === 'dfy' || p === 'dwy') {
    return 'Program C';
  }
  return null;
}

/**
 * Parse a date string from the ledger sheet which can be in any of:
 *   "10/7/2025" (M/D/YYYY)  ← Google Sheets default
 *   "10-30-2025" (MM-DD-YYYY)
 *   "2025-10-07" (ISO)
 * Returns ISO YYYY-MM-DD or null.
 */
function parseLedgerDate(raw: string | null | undefined): string | null {
  if (!raw || !String(raw).trim()) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // M/D/YYYY or MM/DD/YYYY (Google Sheets US default)
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  // MM-DD-YYYY
  m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export async function GET(_req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ ltvByProgram: [], configured: false });
  }

  type Row = {
    client_email: string | null;
    program: string | null;
    status: string | null;
    total_paid_lifetime: number | string | null;
    date_paid: string | null;
  };
  const clients: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa
      .from('t_client_ledger')
      .select('client_email, program, status, total_paid_lifetime, date_paid')
      .range(from, from + 999);
    if (error) {
      return NextResponse.json({ error: error.message ?? 'query_failed' }, { status: 502 });
    }
    if (!data || data.length === 0) break;
    clients.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MATURITY_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const byProgram = new Map<string, { clientCount: number; totalLtv: number; newCount: number }>();
  // Pre-seed canonical programs so Program C shows up even with 0 mature.
  for (const p of ['Program A', 'Program B', 'Program C']) {
    byProgram.set(p, { clientCount: 0, totalLtv: 0, newCount: 0 });
  }
  // Cohort rule per the spec 2026-04-29:
  //   Include if status indicates client is no longer actively paying
  //   (Cancelled / Paused / Didn't renew / Refunded / Churned) — their LTV
  //   is final, regardless of tenure. Even 1-month churners count.
  //   Otherwise (Active / Upsold / etc.) only include if tenure >= 90 days.
  const ENDED_STATUSES = new Set(['cancelled', "didn't renew", 'paused', 'churned', 'refunded']);

  let excludedNew = 0;
  let excludedZero = 0;
  for (const c of clients) {
    const program = canonicalProgram(c.program);
    if (!program) continue;
    const cur = byProgram.get(program)!;
    const ltv = Number(c.total_paid_lifetime ?? 0);
    if (ltv <= 0) {
      excludedZero += 1;
      continue;
    }
    const status = (c.status ?? '').trim().toLowerCase();
    const isEnded = ENDED_STATUSES.has(status);
    if (!isEnded) {
      // Active client — must be ≥ 90 days since first paid date
      const firstPaidIso = parseLedgerDate(c.date_paid);
      if (!firstPaidIso || firstPaidIso > cutoffIso) {
        excludedNew += 1;
        cur.newCount += 1;
        continue;
      }
    }
    cur.clientCount += 1;
    cur.totalLtv += ltv;
  }

  const ltvByProgram: LTVRow[] = Array.from(byProgram.entries())
    .map(([program, v]) => ({
      program,
      clientCount: v.clientCount,
      newCount: v.newCount,
      totalLtv: v.totalLtv,
      avgLtv: v.clientCount > 0 ? v.totalLtv / v.clientCount : 0,
    }))
    .sort((a, b) => b.avgLtv - a.avgLtv);

  return NextResponse.json({
    ltvByProgram,
    cohort: { maturityDays: MATURITY_DAYS, cutoffDate: cutoffIso, excludedNew, excludedZero },
    configured: true,
  });
}
