// Debug endpoint for Pillar 2 (GHL). Returns the mapped leads so we can
// spot-check against the GHL UI without navigating the dashboard.
//
// Usage: curl http://localhost:3000/api/ghl/leads | jq '.count, .sample'

import { NextResponse } from 'next/server';
import { fetchGHLLeads } from '@/lib/mappers/ghl';

export async function GET() {
  const token = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return NextResponse.json({ error: 'GHL_API_KEY or GHL_LOCATION_ID not set' }, { status: 500 });
  }

  const leads = await fetchGHLLeads(token, locationId);

  // Summarise so curl output is readable.
  const byProgram: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  for (const l of leads) {
    byProgram[l.program] = (byProgram[l.program] ?? 0) + 1;
    bySource[l.source]   = (bySource[l.source]   ?? 0) + 1;
    byStage[l.stage]     = (byStage[l.stage]     ?? 0) + 1;
  }

  return NextResponse.json({
    count: leads.length,
    byProgram,
    bySource,
    byStage,
    sample: leads.slice(0, 5),
  });
}
