import { NextResponse } from 'next/server';

// Toggle a single Meta ad's status between ACTIVE and PAUSED.
// Requires the system user token to have `ads_management` scope.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ adId: string }> }
) {
  const { adId } = await params;
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 });
  }

  let body: { status?: 'ACTIVE' | 'PAUSED' };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = body.status;
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    return NextResponse.json({ error: 'status must be ACTIVE or PAUSED' }, { status: 400 });
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${adId}`;
    const metaRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, access_token: token }),
    });
    const metaJson = await metaRes.json();
    if (!metaRes.ok || metaJson.error) {
      return NextResponse.json(
        { error: metaJson.error?.message ?? `Meta HTTP ${metaRes.status}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, adId, status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
