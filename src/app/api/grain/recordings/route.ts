import { NextResponse } from 'next/server';

export const revalidate = 300; // 5 min cache

export async function GET() {
  try {
    const token = process.env.GRAIN_API_KEY;
    if (!token) {
      return NextResponse.json({ error: 'GRAIN_API_KEY not configured' }, { status: 500 });
    }

    // Dynamic import to avoid build issues before install
    const { fetchGrainRecordings, buildGrainEnrichmentByTitle } = await import('@/lib/mappers/grain');
    const recordings = await fetchGrainRecordings(token);
    const { byProspectName, byOwner } = buildGrainEnrichmentByTitle(recordings);

    // Summary stats
    const ownerCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    for (const r of recordings) {
      for (const o of r.owners) {
        ownerCounts[o] = (ownerCounts[o] || 0) + 1;
      }
      typeCounts[r.callType] = (typeCounts[r.callType] || 0) + 1;
    }

    return NextResponse.json({
      totalRecordings: recordings.length,
      prospectMatchesAvailable: byProspectName.size,
      ownerCounts,
      typeCounts,
      sample: recordings.slice(0, 10).map(r => ({
        id: r.id,
        title: r.title,
        owners: r.owners,
        callType: r.callType,
        date: r.startDatetime,
        durationMin: Math.round(r.durationMs / 60000),
        hasTranscript: !!r.transcriptTxtUrl,
        hasSummary: !!r.summary,
      })),
      prospectNames: [...byProspectName.keys()].slice(0, 20),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
