import { NextResponse } from 'next/server';
import { getExpenses } from '@/lib/dataSources';

export async function GET() {
  try {
    const expenses = await getExpenses();
    return NextResponse.json(expenses);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load expenses' }, { status: 500 });
  }
}
