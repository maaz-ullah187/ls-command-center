import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

/**
 * POST /api/feedback — log a per-card feedback comment.
 * Body: { cardId: string, comment: string, pageUrl?: string }
 *
 * GET /api/feedback?status=open — list feedback for review (used by /feedback admin).
 *
 * Backed by `card_feedback` (migration 0021).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cardId = String(body.cardId ?? '').trim();
  const comment = String(body.comment ?? '').trim();
  const pageUrl = body.pageUrl ? String(body.pageUrl) : null;

  if (!cardId || !comment) {
    return NextResponse.json({ error: 'cardId and comment are required' }, { status: 400 });
  }
  if (comment.length > 4000) {
    return NextResponse.json({ error: 'comment too long (max 4000 chars)' }, { status: 400 });
  }

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ error: 'supabase not configured' }, { status: 503 });
  }

  const { data, error } = await supa
    .from('card_feedback')
    .insert({ card_id: cardId, comment, page_url: pageUrl })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message ?? 'insert_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, feedback: data });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'open';
  const cardId = url.searchParams.get('cardId');

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ items: [], configured: false });
  }

  let q = supa.from('card_feedback').select('*').order('created_at', { ascending: false }).limit(200);
  if (status && status !== 'all') q = q.eq('status', status);
  if (cardId) q = q.eq('card_id', cardId);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json({ items: data ?? [], configured: true });
}
