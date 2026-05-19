import { NextResponse } from 'next/server';

const GHL_BASE = 'https://rest.gohighlevel.com/v1';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pipelineId = searchParams.get('pipelineId');
  const stageId = searchParams.get('stageId');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = searchParams.get('limit') || '100';

  try {
    const apiKey = process.env.GHL_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GHL API key not configured' }, { status: 500 });
    }

    const params = new URLSearchParams({ limit });
    if (pipelineId) params.set('pipelineId', pipelineId);
    if (stageId) params.set('stageId', stageId);
    if (startDate) params.set('startAfter', startDate);
    if (endDate) params.set('startBefore', endDate);

    const res = await fetch(`${GHL_BASE}/pipelines/opportunities/?${params}`, {
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
