/**
 * GET /api/sync/client-ledger
 *
 * Pulls the operator's published Google-Sheet client payment log and upserts one
 * row per client into `t_client_ledger`. This table is the CANONICAL source
 * of truth for:
 *   • Active client count (WHERE status = 'Active')
 *   • LTV per client + per program (total_paid_lifetime)
 *   • Client status rulings (the operator edits these manually in the sheet)
 *
 * Published CSV URL lives in `CLIENT_LEDGER_CSV_URL` env var (fallback hardcoded
 * to the known URL). Runs daily at 6:15am PT via Vercel cron.
 *
 * Flow:
 *   1. Fetch CSV from the published sheet
 *   2. Parse rows starting at index 7 (header = row 5)
 *   3. Extract 18 columns per client (status, email, program, LTV, etc.)
 *   4. Upsert into t_client_ledger on client_email conflict
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQzlxwMCBEo-dp5g6_bvG5j1GdlyjS5_5a_v_ySxopL4HP348RkgExNdarZKF-4SzQ6PE9xE2rxppIC/pub?output=csv';

// Column indices match row 5 of the published CSV (the main header row):
//   0=Status, 1=Date Paid, 2=Client Name, 3=Agency Name, 4=Client Email,
//   5=Client Phone, 6=Payment Type, 7=Program, 8=Onboarding Doc, 9=OB Call?,
//   10=Sales Call, 11=Key Points, 12=Lead Source, 13=Offboarding Date,
//   14=Date Status Changed, 15=Duration, 16=Lifetime Value,
//   17=Testimonial, 18=TP Review, 19=Upgraded, 20=Share Sauce.
//
// Previously this map had cols 14/15 mapped to duration/lifetime — that was
// off by one (col 14 is actually "Date Status Changed", col 15 is Duration,
// col 16 is Lifetime Value). Fixed 2026-04-29 after the operator added Apps
// Script LTV() + DURATION() formulas in cols P/Q.
const COL_MAP: Record<number, string> = {
  0: 'status',
  1: 'date_paid',
  2: 'client_name',
  3: 'agency_name',
  4: 'client_email',
  5: 'client_phone',
  6: 'payment_type',
  7: 'program',
  10: 'sales_call_url',
  11: 'key_points',
  12: 'lead_source',
  13: 'offboarding_date',
  15: 'duration_months',
  16: 'total_paid_lifetime',
  17: 'testimonial',
  18: 'tp_review',
  19: 'upgraded',
  20: 'share_sauce',
};

// Minimal RFC-4180-ish CSV parser that handles quoted cells + embedded newlines.
// Avoids a dependency; good enough for Google-Sheets CSV output.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') { /* skip, \n handles */ }
      else { cell += ch; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function parseMoney(s: string | null | undefined): number | null {
  if (!s) return null;
  const neg = s.includes('(') && s.includes(')');
  const cleaned = s.replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const v = parseFloat(cleaned);
  return Number.isNaN(v) ? null : neg ? -v : v;
}

function parseNumeric(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const v = parseFloat(cleaned);
  return Number.isNaN(v) ? null : v;
}

export async function GET() {
  const baseUrl = process.env.CLIENT_LEDGER_CSV_URL || DEFAULT_CSV_URL;
  const sb = await getServerSupabaseAsync();
  if (!sb) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  // 1. Fetch CSV — append cache-bust param so Google's edge cache doesn't
  // serve a mid-computation snapshot (Apps Script cells can be "Loading..."
  // for a few minutes after a recompute, and the published-CSV edge cache
  // sometimes serves that intermediate state).
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}_t=${Date.now()}`;
  const started = Date.now();
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) {
    return NextResponse.json(
      { error: `CSV fetch failed: HTTP ${resp.status}` },
      { status: 500 },
    );
  }
  const csvText = await resp.text();
  const rows = parseCsv(csvText);

  // 2. Extract client rows (skip first 7 rows: summary + header + padding)
  const clients: Record<string, unknown>[] = [];
  rows.forEach((row, idx) => {
    if (idx < 7 || row.length < 20) return;
    const name = (row[2] || '').trim();
    const email = (row[4] || '').trim().toLowerCase();
    if (!name || !email || !email.includes('@')) return;

    const rec: Record<string, unknown> = {};
    for (const [ki, field] of Object.entries(COL_MAP)) {
      const k = Number(ki);
      if (k >= row.length) continue;
      rec[field] = (row[k] || '').trim();
    }
    rec.client_email = email;
    rec.duration_months = parseNumeric(rec.duration_months as string);
    rec.total_paid_lifetime = parseMoney(rec.total_paid_lifetime as string);
    rec.source_row_num = idx + 1;
    clients.push(rec);
  });

  // 3. Upsert in batches of 100
  const batchSize = 100;
  let inserted = 0;
  for (let i = 0; i < clients.length; i += batchSize) {
    const batch = clients.slice(i, i + batchSize);
    const { error } = await sb
      .from('t_client_ledger')
      .upsert(batch, { onConflict: 'client_email' });
    if (error) {
      return NextResponse.json(
        { error: `upsert failed: ${error.message}`, batch_index: i },
        { status: 500 },
      );
    }
    inserted += batch.length;
  }

  return NextResponse.json({
    ok: true,
    clients_synced: inserted,
    csv_rows_total: rows.length,
    duration_ms: Date.now() - started,
    source_url: url.replace(/pub\?.*$/, 'pub?…'),
  });
}
