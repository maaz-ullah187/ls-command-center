// Competitors CRUD API
//
// GET    /api/competitors             → list all competitors
// POST   /api/competitors             → create a new competitor
// PUT    /api/competitors             → update a competitor (body.id required)
// DELETE /api/competitors?id=<uuid>   → delete a competitor

import { NextRequest, NextResponse } from 'next/server';

async function getSupabase() {
  const { getServerSupabaseAsync } = await import('@/lib/supabase/server');
  const sb = await getServerSupabaseAsync();
  if (!sb) throw new Error('Supabase not configured');
  return sb;
}

// ---------- GET ----------
export async function GET() {
  try {
    const sb = await getSupabase();
    const { data, error } = await sb
      .from('competitors')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      // Table might not exist yet — return empty array
      console.warn('[competitors] GET error:', error.message);
      return NextResponse.json([]);
    }
    return NextResponse.json(data ?? []);
  } catch {
    // Supabase not configured — return empty so the client falls back to localStorage
    return NextResponse.json([]);
  }
}

// ---------- POST ----------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const sb = await getSupabase();
    const { data, error } = await sb
      .from('competitors')
      .insert({
        name: body.name,
        instagram: body.instagram ?? null,
        youtube: body.youtube ?? null,
        ads_library_url: body.ads_library_url ?? null,
        strengths: body.strengths ?? null,
        monthly_rev: body.monthly_rev ?? 0,
        niche: body.niche ?? [],
        competitor_type: body.competitor_type ?? 'Indirect',
        notes: body.notes ?? null,
        custom_fields: body.custom_fields ?? {},
        sort_order: body.sort_order ?? 0,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------- PUT ----------
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const sb = await getSupabase();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const fields = [
      'name', 'instagram', 'youtube', 'ads_library_url', 'strengths',
      'monthly_rev', 'niche', 'competitor_type', 'notes', 'custom_fields', 'sort_order',
    ];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    const { data, error } = await sb
      .from('competitors')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------- DELETE ----------
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }

    const sb = await getSupabase();
    const { error } = await sb.from('competitors').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
