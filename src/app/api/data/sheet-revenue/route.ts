import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { fetchSheetPaymentLog } = await import('@/lib/mappers/sheets-payment-log');

    // Optional ?month=YYYY-MM lets the Main Dashboard fetch prior periods
    // for the headline-KPI comparison line.
    const monthParam = req.nextUrl.searchParams.get('month');
    let monthArg: Date | undefined;
    if (monthParam) {
      const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
      if (m) {
        monthArg = new Date(Number(m[1]), Number(m[2]) - 1, 1);
      }
    }

    const data = await fetchSheetPaymentLog(monthArg);

    return NextResponse.json({
      month: data.month,
      newCash: data.newCash,
      refunds: data.refunds,
      ar: data.ar,
      renewals: data.renewals,
      upgrades: data.upgrades,
      mastermind: data.mastermind,
      totalRevenue: data.totalRevenue,
      netRevenue: data.netRevenue,
      clientCount: data.clientCount,
      activeClientCount: data.activeClientCount,
      bySource: data.bySource,
      byOffer: data.byOffer,
      clients: data.clients.map(c => ({
        clientName: c.clientName,
        clientEmail: c.clientEmail,
        program: c.program,
        leadSource: c.leadSource,
        status: c.status,
        newCash: c.newCash,
        refunds: c.refunds,
        ar: c.ar,
        renewals: c.renewals,
        upgrades: c.upgrades,
        mastermind: c.mastermind,
        totalRevenue: c.totalRevenue,
        dateCollected: c.dateCollected,
        monthlyStatus: c.monthStatus,
      })),
    });
  } catch (err: any) {
    console.error('[sheet-revenue] Error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Failed to fetch sheet revenue' },
      { status: 500 }
    );
  }
}
