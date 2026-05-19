import { NextResponse } from 'next/server';
import { getBackendRevenue } from '@/lib/dataSources';

export async function GET() {
  try {
    const data = await getBackendRevenue();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load backend revenue' }, { status: 500 });
  }
}
