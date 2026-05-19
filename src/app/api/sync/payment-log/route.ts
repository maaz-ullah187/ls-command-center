import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { fetchSheetPaymentLog } from '@/lib/mappers/sheets-payment-log';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sync/payment-log?month=YYYY-MM
 *
 * Pulls the Google Sheet "Client Payment Log" for the given month (defaults to
 * current) and upserts every row into Supabase `payment_log`. After this runs,
 * the dashboard reads ONLY from Supabase — never the sheet directly.
 *
 * Cron note: wire to vercel.json crons hourly so the table stays fresh.
 * Manual run: `curl -X POST https://…/api/sync/payment-log`
 */
export async function POST(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const monthParam = url.searchParams.get('month');
  let monthArg: Date | undefined;
  if (monthParam) {
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (m) monthArg = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  }

  let totals;
  try {
    totals = await fetchSheetPaymentLog(monthArg);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'sheet_fetch_failed' }, { status: 502 });
  }

  const monthYear = totals.month;

  const upsertRows = totals.clients.map((c) => ({
    status: c.status || null,
    date_paid: c.datePaid || null,
    client_name: c.clientName,
    agency_name: c.agencyName || null,
    client_email: c.clientEmail || null,
    client_phone: c.clientPhone || null,
    payment_type: c.paymentType || null,
    program: c.program || null,
    date_collected: c.dateCollected || null,
    new_cash: c.newCash,
    ar: c.ar,
    renewals: c.renewals,
    upgrades: c.upgrades,
    refunds: c.refunds,
    total_revenue: c.totalRevenue,
    month_status: c.monthStatus || null,
    month_year: monthYear,
    updated_at: new Date().toISOString(),
  }));

  // Upsert in chunks of 500
  let upserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < upsertRows.length; i += 500) {
    const chunk = upsertRows.slice(i, i + 500);
    const { error, count } = await supa
      .from('payment_log')
      .upsert(chunk, { onConflict: 'client_name,month_year,payment_type', count: 'exact' });
    if (error) {
      errors.push(error.message);
    } else {
      upserted += count ?? chunk.length;
    }
  }

  return NextResponse.json({
    month: monthYear,
    rowsFromSheet: totals.clients.length,
    upserted,
    errors,
    totals: {
      newCash: totals.newCash,
      ar: totals.ar,
      renewals: totals.renewals,
      upgrades: totals.upgrades,
      refunds: totals.refunds,
      totalRevenue: totals.totalRevenue,
      clientCount: totals.clientCount,
    },
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
