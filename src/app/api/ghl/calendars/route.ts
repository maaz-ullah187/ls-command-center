import { NextResponse } from 'next/server';

const GHL_BASE = 'https://rest.gohighlevel.com/v1';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  try {
    const apiKey = process.env.GHL_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GHL API key not configured' }, { status: 500 });
    }

    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const res = await fetch(`${GHL_BASE}/appointments/?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`GHL API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
