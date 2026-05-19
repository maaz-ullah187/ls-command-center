import { NextResponse } from 'next/server';
import { getDailyMetrics } from '@/lib/dataSources';

// Daily aggregated snapshots used by trend charts. Built up from leads + ads +
// payments by sync workers as each pillar lands.
export async function GET() {
  try {
    const dailyMetrics = await getDailyMetrics();
    return NextResponse.json(dailyMetrics);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Failed to load daily metrics' },
      { status: 500 }
    );
  }
}
