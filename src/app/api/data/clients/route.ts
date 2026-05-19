import { NextResponse } from 'next/server';
import { getClients } from '@/lib/dataSources';

export async function GET() {
  try {
    const clients = await getClients();
    return NextResponse.json(clients);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load clients' }, { status: 500 });
  }
}
