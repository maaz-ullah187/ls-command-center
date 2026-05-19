import { NextResponse } from 'next/server';

const STRIPE_BASE = 'https://api.stripe.com/v1';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = searchParams.get('limit') || '100';

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ error: 'Stripe API not configured' }, { status: 500 });
    }

    const params = new URLSearchParams({ limit });
    if (startDate) params.set('created[gte]', String(Math.floor(new Date(startDate).getTime() / 1000)));
    if (endDate) params.set('created[lte]', String(Math.floor(new Date(endDate).getTime() / 1000)));

    const res = await fetch(`${STRIPE_BASE}/payment_intents?${params}`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`Stripe API error: ${res.status}`);
    const data = await res.json();

    // Also fetch balance for summary
    const balanceRes = await fetch(`${STRIPE_BASE}/balance`, {
      headers: { 'Authorization': `Bearer ${secretKey}` },
      next: { revalidate: 300 },
    });

    let balance = null;
    if (balanceRes.ok) {
      balance = await balanceRes.json();
    }

    return NextResponse.json({
      payments: data.data,
      hasMore: data.has_more,
      balance,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
