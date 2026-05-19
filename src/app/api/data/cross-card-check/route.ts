import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/data/cross-card-check
 *
 * Detects revenue source-of-truth drift between three feeds for the active
 * month:
 *   1. Net Revenue MTD (headline KPI) — from the Google Sheet
 *   2. Revenue Composition — from t06+t07
 *   3. Cash by Source total — from t05/t06
 *
 * Returns an array of anomalies. Each anomaly is one specific mismatch:
 *   - net total disagreement (>$5k)
 *   - per-bucket disagreement: refunds / ar / renewals_upsells / new cash
 *     (each >$1k)
 *
 * Surfaces in the Daily Review Queue's Data Anomalies tab as system-level
 * rows so the team can chase the underlying gaps.
 */

const NET_THRESHOLD = 5000;
const BUCKET_THRESHOLD = 1000;

interface Anomaly {
  kind: string;
  issue: string;
  sources: Record<string, number>;
  delta: number;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function monthBounds(): { from: string; to: string } {
  const d = new Date();
  const year = d.getFullYear();
  const mo = d.getMonth();
  const last = new Date(year, mo + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${year}-${pad(mo + 1)}-01`,
    to: `${year}-${pad(mo + 1)}-${pad(last)}`,
  };
}

export async function GET(req: NextRequest) {
  const { from, to } = monthBounds();
  const origin = new URL(req.url).origin;

  const [sheetRes, compRes, cashRes] = await Promise.allSettled([
    fetch(`${origin}/api/data/sheet-revenue`).then((r) => (r.ok ? r.json() : null)),
    fetch(`${origin}/api/main/revenue-composition?from=${from}&to=${to}`).then((r) => (r.ok ? r.json() : null)),
    fetch(`${origin}/api/main/cash-breakdown?from=${from}&to=${to}`).then((r) => (r.ok ? r.json() : null)),
  ]);

  const sheet = sheetRes.status === 'fulfilled' ? sheetRes.value : null;
  const composition = compRes.status === 'fulfilled' ? compRes.value : null;
  const cash = cashRes.status === 'fulfilled' ? cashRes.value : null;

  // ── Sheet-side bucket extraction (per-month columns from Client Payment Log) ──
  const sheetNewCash = Number(sheet?.newCash ?? 0);
  const sheetAr = Number(sheet?.ar ?? 0);
  const sheetRenewals = Number(sheet?.renewals ?? 0);
  const sheetUpgrades = Number(sheet?.upgrades ?? 0);
  const sheetMastermind = Number(sheet?.mastermind ?? 0);
  const sheetRefunds = Math.abs(Number(sheet?.refunds ?? 0));
  const sheetRenewalsUpsells = sheetRenewals + sheetUpgrades;
  const sheetNet = sheetNewCash + sheetAr + sheetRenewals + sheetUpgrades + sheetMastermind - sheetRefunds;

  // ── Revenue Composition slices → per-bucket totals ──
  const compSlices = (composition?.slices ?? []) as Array<{ category: string; amount: number }>;
  const sliceMap = new Map<string, number>();
  for (const s of compSlices) {
    sliceMap.set(s.category, Number(s.amount ?? 0));
  }
  const compNew = sliceMap.get('new') ?? 0;
  const compAr = sliceMap.get('ar') ?? 0;
  const compRenewalsUpsells = sliceMap.get('renewals_upsells') ?? 0;
  const compMastermind = sliceMap.get('mastermind') ?? 0;
  const compRefunds = Math.abs(sliceMap.get('refund') ?? 0);
  const compNet = compNew + compAr + compRenewalsUpsells + compMastermind - compRefunds;

  // ── Cash by Source total ──
  const cashBySources = (cash?.bySource ?? []) as Array<{ amount: number }>;
  const cashTotal = cashBySources.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const anomalies: Anomaly[] = [];

  // 1. Net total disagreement (any pair > $5k apart)
  const nets = [sheetNet, compNet, cashTotal].filter((v) => v > 0);
  if (nets.length >= 2) {
    const max = Math.max(...nets);
    const min = Math.min(...nets);
    const delta = max - min;
    if (delta > NET_THRESHOLD) {
      anomalies.push({
        kind: 'cross_card_net_mismatch',
        issue: `Net revenue mismatch: ${fmt(delta)} delta — Net Revenue MTD ${fmt(sheetNet)} ≠ Revenue Composition ${fmt(compNet)} ≠ Cash by Source ${fmt(cashTotal)}`,
        sources: { sheetNet, compNet, cashTotal },
        delta,
      });
    }
  }

  // 2. Per-bucket disagreements (sheet vs composition only — cash-by-source
  // doesn't break down per bucket the same way)
  const bucketChecks: Array<{ kind: string; label: string; sheet: number; comp: number }> = [
    { kind: 'cross_card_refunds_mismatch',  label: 'Refunds',           sheet: sheetRefunds,         comp: compRefunds },
    { kind: 'cross_card_ar_mismatch',       label: 'AR',                sheet: sheetAr,              comp: compAr },
    { kind: 'cross_card_upsells_mismatch',  label: 'Renewals/Upsells',  sheet: sheetRenewalsUpsells, comp: compRenewalsUpsells },
    { kind: 'cross_card_newcash_mismatch',  label: 'New Cash',          sheet: sheetNewCash,         comp: compNew },
    { kind: 'cross_card_mastermind_mismatch', label: 'Mastermind',      sheet: sheetMastermind,      comp: compMastermind },
  ];

  for (const c of bucketChecks) {
    const delta = Math.abs(c.sheet - c.comp);
    if (delta > BUCKET_THRESHOLD) {
      anomalies.push({
        kind: c.kind,
        issue: `${c.label} mismatch: ${fmt(delta)} delta — Sheet ${fmt(c.sheet)} ≠ Revenue Composition ${fmt(c.comp)}`,
        sources: { sheet: c.sheet, composition: c.comp },
        delta,
      });
    }
  }

  if (anomalies.length === 0) {
    return NextResponse.json({ ok: true, sources: { sheetNet, compNet, cashTotal } });
  }

  return NextResponse.json({
    ok: false,
    anomalies,
    // Keep legacy single-anomaly key for backward compat (first anomaly only)
    anomaly: anomalies[0],
  });
}
