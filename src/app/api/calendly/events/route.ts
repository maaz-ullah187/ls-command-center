import { NextResponse } from 'next/server';

const CALENDLY_BASE = 'https://api.calendly.com';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const count = searchParams.get('count') || '100';
  const status = searchParams.get('status') || 'active';

  try {
    const token = process.env.CALENDLY_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Calendly token not configured' }, { status: 500 });
    }

    // First get the current user to obtain the organization URI
    const userRes = await fetch(`${CALENDLY_BASE}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
      next: { revalidate: 3600 },
    });

    if (!userRes.ok) throw new Error(`Calendly user API error: ${userRes.status}`);
    const userData = await userRes.json();
    const organizationUri = userData.resource?.current_organization;

    if (!organizationUri) {
      return NextResponse.json({ error: 'Could not determine Calendly organization' }, { status: 500 });
    }

    const params = new URLSearchParams({
      organization: organizationUri,
      count,
      status,
    });
    if (startDate) params.set('min_start_time', startDate);
    if (endDate) params.set('max_start_time', endDate);

    const res = await fetch(`${CALENDLY_BASE}/scheduled_events?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`Calendly API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
