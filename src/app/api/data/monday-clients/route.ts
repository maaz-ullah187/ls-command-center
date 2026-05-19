import { NextResponse } from 'next/server';
import { fetchMondayClients } from '@/lib/mappers/monday';

export const revalidate = 600; // 10 min ISR cache

export async function GET() {
  const apiKey = process.env.MONDAY_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'MONDAY_API_KEY not configured' },
      { status: 503 }
    );
  }

  try {
    const clients = await fetchMondayClients(apiKey);
    return NextResponse.json(clients);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[monday-clients] fetch failed:', message);
    return NextResponse.json(
      { error: message },
      { status: 502 }
    );
  }
}
