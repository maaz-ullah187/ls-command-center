// Google Sheets → Client Payment Log mapper
//
// Reads the "Client Payment Log" sheet tab via Google Sheets API v4 REST.
// Dynamically finds the current month's column block, parses per-client
// payment data, and returns aggregated revenue totals.
//
// Env vars: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID

import 'server-only';

import { createSign } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SheetClient {
  status: string;           // "Active" / "Paused" / "Cancelled" / etc — from column A
  datePaid: string;         // column B
  clientName: string;       // column C
  agencyName: string;       // column D
  clientEmail: string;      // column E
  clientPhone: string;      // column F
  paymentType: string;      // column G
  program: string;          // column H
  leadSource: string;       // column M — where the client came from
  monthStatus: string;      // "Y" / "Fully Paid" / etc for the month block
  dateCollected: string;    // date collected in the month block
  ar: number;
  renewals: number;
  upgrades: number;
  newCash: number;
  refunds: number;
  mastermind: number;
  totalRevenue: number;     // net for this month after refunds
}

export interface SheetSlice {
  key: string;
  amount: number;
  count: number;
}

export interface SheetTotals {
  clients: SheetClient[];
  newCash: number;
  refunds: number;
  ar: number;
  renewals: number;
  upgrades: number;
  mastermind: number;
  totalRevenue: number;     // sum of all per-client totalRevenue for the month (net)
  netRevenue: number;       // newCash + ar + renewals + upgrades + mastermind - |refunds|
  clientCount: number;      // every client row in the sheet for the month
  activeClientCount: number; // status IN ('Active', 'Upsold') — the operator's definition
  bySource: SheetSlice[];   // grouped by leadSource for the month, descending
  byOffer: SheetSlice[];    // grouped by canonical program for the month, descending
  month: string;            // e.g. "April 2026"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip $, commas, spaces and parse as number. Returns 0 for empty/invalid. */
export function parseCurrency(raw: string | undefined | null): number {
  if (!raw) return 0;
  const cleaned = String(raw).replace(/[$,\s]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return 0;
  // Handle parenthetical negatives like ($500)
  const isNeg = cleaned.startsWith('(') && cleaned.endsWith(')');
  const numStr = isNeg ? cleaned.slice(1, -1) : cleaned;
  const val = parseFloat(numStr);
  if (isNaN(val)) return 0;
  return isNeg ? -val : val;
}

/** Parse a date string like "April 5, 2026" or "2026-04-05" → ISO "2026-04-05". */
export function parseSheetDate(raw: string | undefined | null): string {
  if (!raw || !String(raw).trim()) return '';
  const s = String(raw).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try "Month D, YYYY" or "Month DD, YYYY"
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s; // fallback: return as-is
}

/** Format a Date as "Month YYYY" for header matching (e.g. "April 2026"). */
function formatMonthYear(d: Date): string {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cache: { data: SheetTotals; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Auth — lightweight JWT-based Google service account auth (no heavy deps)
// ---------------------------------------------------------------------------

function base64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) {
    return tokenCache.token;
  }

  // Try GOOGLE_SERVICE_ACCOUNT_JSON first (full JSON creds, most reliable on Vercel)
  // Then fall back to individual GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = '';

  const jsonCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (jsonCreds) {
    try {
      const creds = JSON.parse(jsonCreds);
      email = creds.client_email;
      privateKey = creds.private_key;
    } catch (_e) {
      console.error('[sheets] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON');
    }
  }

  if (!privateKey) {
    const key = process.env.GOOGLE_PRIVATE_KEY;
    if (!key) throw new Error('[sheets] Missing Google credentials');
    privateKey = key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
  }

  if (!email) throw new Error('[sheets] Missing Google service account email');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp,
  }));

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = base64url(sign.sign(privateKey));

  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[sheets] Token exchange failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  tokenCache = { token: data.access_token, exp: exp * 1000 };
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

/**
 * Fetch and parse the Client Payment Log sheet for a given month.
 * Defaults to the current month if none provided.
 */
export async function fetchSheetPaymentLog(
  month?: Date
): Promise<SheetTotals> {
  // Check cache
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    const targetMonth = formatMonthYear(month ?? new Date());
    if (cache.data.month === targetMonth) {
      return cache.data;
    }
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error('[sheets] Missing GOOGLE_SHEET_ID');
  }

  const token = await getAccessToken();
  const targetMonth = formatMonthYear(month ?? new Date());

  // Fetch enough columns to cover client info (A-H) + all month blocks.
  // Each month block is ~8 columns. April 2026 starts at col ~109.
  // Fetching A:GR covers ~200 columns = ~24 month blocks (2+ years).
  const range = encodeURIComponent("'Client Payment Log'!A1:GR500");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[sheets] HTTP ${res.status}: ${body}`);
    throw new Error(`[sheets] Google Sheets API returned ${res.status}`);
  }

  const json = await res.json();
  const rows: (string | number | null)[][] = json.values ?? [];

  if (rows.length < 3) {
    throw new Error('[sheets] Sheet has fewer than 3 rows — unexpected format');
  }

  // -------------------------------------------------------------------------
  // Step 1: Find the month block in row 1
  // -------------------------------------------------------------------------
  const headerRow = rows[0]; // Row 1 — month headers
  const subHeaderRow = rows[1]; // Row 2 — column sub-headers (AR, Renewals, etc.)

  let monthStartCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] ?? '').trim();
    if (cell.toLowerCase() === targetMonth.toLowerCase()) {
      monthStartCol = c;
      break;
    }
  }

  if (monthStartCol === -1) {
    console.warn(`[sheets] Month "${targetMonth}" not found in row 1 headers`);
    return {
      clients: [], newCash: 0, refunds: 0, ar: 0, renewals: 0, upgrades: 0,
      mastermind: 0, totalRevenue: 0, netRevenue: 0,
      clientCount: 0, activeClientCount: 0,
      bySource: [], byOffer: [],
      month: targetMonth,
    };
  }

  // -------------------------------------------------------------------------
  // Step 2: Dynamically find column offsets from row 2 sub-headers
  // -------------------------------------------------------------------------
  // The month block in row 2 has sub-headers like: Status, Date Collected, AR, Renewals, Upgrades, New Cash, Refunds, Total Revenue
  // Status is ~2 before AR, Date Collected is ~1 before AR
  // Scan a reasonable window around monthStartCol

  // Only scan columns AT or AFTER the month header — never before, to avoid
  // bleeding in values from the previous month's block.
  const scanStart = monthStartCol;
  const scanEnd = Math.min(subHeaderRow.length, monthStartCol + 10);

  const colMap: Record<string, number> = {};
  for (let c = scanStart; c < scanEnd; c++) {
    const label = String(subHeaderRow[c] ?? '').trim().toLowerCase();
    if (label.includes('mastermind') && !colMap['mastermind']) {
      colMap['mastermind'] = c;
    } else if (label.includes('ar') && !label.includes('star') && !colMap['ar']) {
      colMap['ar'] = c;
    } else if (label.includes('renewal') && !colMap['renewals']) {
      colMap['renewals'] = c;
    } else if (label.includes('upgrade') && !colMap['upgrades']) {
      colMap['upgrades'] = c;
    } else if ((label.includes('new cash') || label.includes('new_cash') || label === 'new') && !colMap['newCash']) {
      colMap['newCash'] = c;
    } else if (label.includes('refund') && !colMap['refunds']) {
      colMap['refunds'] = c;
    } else if (label.includes('total') && !colMap['totalRevenue']) {
      colMap['totalRevenue'] = c;
    }
  }

  // Status column ("Y"/blank) = monthStartCol (labeled "Title" in row 2)
  // Date Collected = monthStartCol + 1 (labeled "DATE COLLECTED" in row 2)
  const statusCol = monthStartCol;
  const dateCollectedCol = monthStartCol + 1;

  // -------------------------------------------------------------------------
  // Step 3: Parse data rows (starting at row 7, index 6)
  // -------------------------------------------------------------------------
  const DATA_START_ROW = 6; // 0-indexed = row 7

  const clients: SheetClient[] = [];
  let totNewCash = 0;
  let totRefunds = 0;
  let totAr = 0;
  let totRenewals = 0;
  let totUpgrades = 0;
  let totMastermind = 0;
  let totTotalRevenue = 0;

  for (let r = DATA_START_ROW; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    // Fixed columns A-H (0-7) + M (12) for lead source
    const clientName = String(row[2] ?? '').trim();
    if (!clientName) continue; // skip empty rows

    const globalStatus = String(row[0] ?? '').trim();
    const datePaid = parseSheetDate(String(row[1] ?? ''));
    const agencyName = String(row[3] ?? '').trim();
    const clientEmail = String(row[4] ?? '').trim();
    const clientPhone = String(row[5] ?? '').trim();
    const paymentType = String(row[6] ?? '').trim();
    const program = String(row[7] ?? '').trim();
    const leadSource = String(row[12] ?? '').trim();

    // Month-specific columns
    const monthStatus = statusCol >= 0 ? String(row[statusCol] ?? '').trim().toUpperCase() : '';
    const dateCollected = dateCollectedCol >= 0 ? parseSheetDate(String(row[dateCollectedCol] ?? '')) : '';
    const isPaid = monthStatus === 'Y';

    const rawAr = colMap['ar'] != null ? parseCurrency(String(row[colMap['ar']] ?? '')) : 0;
    const rawRenewals = colMap['renewals'] != null ? parseCurrency(String(row[colMap['renewals']] ?? '')) : 0;
    const rawUpgrades = colMap['upgrades'] != null ? parseCurrency(String(row[colMap['upgrades']] ?? '')) : 0;
    const rawNewCash = colMap['newCash'] != null ? parseCurrency(String(row[colMap['newCash']] ?? '')) : 0;
    const rawRefunds = colMap['refunds'] != null ? parseCurrency(String(row[colMap['refunds']] ?? '')) : 0;
    const rawMastermind = colMap['mastermind'] != null ? parseCurrency(String(row[colMap['mastermind']] ?? '')) : 0;
    const rawTotalRevenue = colMap['totalRevenue'] != null ? parseCurrency(String(row[colMap['totalRevenue']] ?? '')) : 0;

    // Rules: New Cash + Mastermind are real if value present (the operator
    // 2026-04-29 — "All amounts in the mastermind column have been paid
    // and confirmed", same convention as new cash). AR/Renewals/Upgrades
    // still require status = "Y" to count.
    const newCash = rawNewCash;
    const refunds = rawRefunds;
    const ar = isPaid ? rawAr : 0;
    const renewals = isPaid ? rawRenewals : 0;
    const upgrades = isPaid ? rawUpgrades : 0;
    const mastermind = rawMastermind;
    const totalRevenue = isPaid ? rawTotalRevenue : newCash - refunds + mastermind;

    const client: SheetClient = {
      status: globalStatus,
      datePaid,
      clientName,
      agencyName,
      clientEmail,
      clientPhone,
      paymentType,
      program,
      leadSource,
      monthStatus,
      dateCollected,
      ar,
      renewals,
      upgrades,
      newCash,
      refunds,
      mastermind,
      totalRevenue,
    };

    clients.push(client);

    totNewCash += newCash;
    totRefunds += refunds;
    totAr += ar;
    totRenewals += renewals;
    totUpgrades += upgrades;
    totMastermind += mastermind;
    totTotalRevenue += totalRevenue;
  }

  // ── Cohort: Active vs everything else ──
  // the operator's rule (2026-04-30): "the only statuses that count are Active
  // and Upsold". Everything else (Paused / Cancelled / Didn't renew /
  // Refunded / Churned) is no longer paying us.
  const activeClientCount = clients.filter((c) => {
    const s = (c.status || '').trim().toLowerCase();
    return s === 'active' || s === 'upsold';
  }).length;

  // ── bySource (donut: Cash by Source) ──
  // Group every client's per-month totalRevenue by their lead_source (col M).
  // Skip clients with empty source so the chart isn't dominated by "Unknown".
  function canonProgram(raw: string): string {
    const p = (raw || '').trim().toLowerCase();
    if (!p) return '';
    if (p.includes('program a')) return 'Program A';
    if (p.includes('program b')) return 'Program B';
    if (p.includes('program c') || /\bai\b/.test(p) || p.includes('agent build') || p === 'dfy' || p === 'dwy') return 'Program C';
    return raw.trim();
  }

  // Compute per-client revenue from component cells (newCash + ar + renewals
  // + upgrades + mastermind - |refunds|). Don't trust the sheet's totalRevenue
  // cell — for many clients that cell is blank/0 even though the components
  // have values. Computing from components matches the org-wide netRevenue
  // by construction.
  const clientRevenue = (c: SheetClient) =>
    c.newCash + c.ar + c.renewals + c.upgrades + c.mastermind - Math.abs(c.refunds);

  const bySourceMap = new Map<string, { amount: number; count: number }>();
  const byOfferMap = new Map<string, { amount: number; count: number }>();
  for (const c of clients) {
    const rev = clientRevenue(c);
    if (rev === 0) continue;
    const src = (c.leadSource || '').trim() || 'Unknown';
    const sCur = bySourceMap.get(src) ?? { amount: 0, count: 0 };
    sCur.amount += rev;
    sCur.count += 1;
    bySourceMap.set(src, sCur);

    const offer = canonProgram(c.program) || 'Unknown';
    const oCur = byOfferMap.get(offer) ?? { amount: 0, count: 0 };
    oCur.amount += rev;
    oCur.count += 1;
    byOfferMap.set(offer, oCur);
  }
  const bySource: SheetSlice[] = Array.from(bySourceMap.entries())
    .map(([key, v]) => ({ key, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);
  const byOffer: SheetSlice[] = Array.from(byOfferMap.entries())
    .map(([key, v]) => ({ key, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  // Net revenue: same formula HeadlineKPIs uses, computed once here so all
  // downstream cards (Composition / Cash by Source / Cash by Offer) can
  // verify they're aggregating to the same number.
  const netRevenue = totNewCash + totAr + totRenewals + totUpgrades + totMastermind - Math.abs(totRefunds);

  const result: SheetTotals = {
    clients,
    newCash: totNewCash,
    refunds: totRefunds,
    ar: totAr,
    renewals: totRenewals,
    upgrades: totUpgrades,
    mastermind: totMastermind,
    totalRevenue: totTotalRevenue,
    netRevenue,
    clientCount: clients.length,
    activeClientCount,
    bySource,
    byOffer,
    month: targetMonth,
  };

  // Update cache
  cache = { data: result, ts: Date.now() };

  return result;
}
