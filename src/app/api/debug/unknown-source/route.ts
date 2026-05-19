import { NextResponse } from 'next/server';
import { getLeads } from '@/lib/dataSources';

export const dynamic = 'force-dynamic';

export async function GET() {
  const allLeads = await getLeads();

  const unknowns = allLeads
    .filter((l) => l.source === 'Unknown')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map((l) => ({
      name: l.name,
      email: l.email,
      date: l.date,
      ghlContactId: l.ghlContactId,
      program: l.program,
      stage: l.stage,
    }));

  return NextResponse.json({ count: unknowns.length, leads: unknowns });
}
