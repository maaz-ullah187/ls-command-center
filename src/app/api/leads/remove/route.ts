import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/leads/remove
 * Body: { id: string, reason?: string }
 *
 * Soft-removes a lead by writing an override row to t16_overrides:
 *   table_name = 't01_leads'
 *   row_id     = <lead_id>
 *   field      = 'removed_at'
 *   corrected  = <ISO timestamp>
 *
 * dataSources.getLeads() filters out any lead with this override set, so the
 * lead disappears from CRM, leaderboards, anomaly detection — everywhere.
 *
 * Reversible: deleting the t16_overrides row brings the lead back.
 */
export async function POST(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });
  }

  let body: { id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

  const now = new Date().toISOString();
  const reason = body.reason?.trim() || 'Marked as fake/junk lead via Daily Review Queue';

  const { error } = await supa
    .from('t16_overrides')
    .upsert(
      {
        table_name: 't01_leads',
        row_id: id,
        field: 'removed_at',
        corrected: now,
        reason,
        edited_by: 'dashboard',
        edited_at: now,
      },
      { onConflict: 'table_name,row_id,field' }
    );

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, removed_at: now });
}
