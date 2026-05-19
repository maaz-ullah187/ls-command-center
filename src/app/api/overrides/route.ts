// Overrides CRUD — Pillar 0.5
//
// Human corrections to sync'd data. The dataSources switching layer left-joins
// overrides on every read, so a corrected value wins over the raw source value
// without ever being clobbered by the next sync run.
//
// GET    /api/overrides?table=leads           → list all overrides for a table
// POST   /api/overrides                       → create / upsert an override
// DELETE /api/overrides?id=<uuid>             → revert (delete) an override

import { NextRequest, NextResponse } from 'next/server';

async function getSupabase() {
  const { getServerSupabaseAsync } = await import('@/lib/supabase/server');
  const sb = await getServerSupabaseAsync();
  if (!sb) throw new Error('Supabase not configured');
  return sb;
}

// ---------- GET ----------
export async function GET(req: NextRequest) {
  try {
    const table = req.nextUrl.searchParams.get('table');
    const rowId = req.nextUrl.searchParams.get('row_id');
    const sb = await getSupabase();

    let query = sb.from('t16_overrides').select('*').order('edited_at', { ascending: false });
    if (table) query = query.eq('table_name', table);
    if (rowId) query = query.eq('row_id', rowId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ overrides: data ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------- POST ----------
interface CreateBody {
  table_name: string;
  row_id: string;
  field: string;
  original?: unknown;
  corrected: unknown;
  edited_by?: string;
  reason?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;
    if (!body.table_name || !body.row_id || !body.field || body.corrected === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: table_name, row_id, field, corrected' },
        { status: 400 }
      );
    }

    const sb = await getSupabase();

    // Upsert on (table_name, row_id, field) so re-editing the same cell
    // updates rather than creating a duplicate.
    const { data, error } = await sb
      .from('t16_overrides')
      .upsert(
        {
          table_name: body.table_name,
          row_id: body.row_id,
          field: body.field,
          original: body.original ?? null,
          corrected: body.corrected,
          edited_by: body.edited_by ?? 'the operator',
          reason: body.reason ?? null,
          edited_at: new Date().toISOString(),
        },
        { onConflict: 'table_name,row_id,field' }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ override: data }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------- DELETE ----------
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    // Also support deleting by (table_name, row_id, field) triple
    const table = req.nextUrl.searchParams.get('table');
    const rowId = req.nextUrl.searchParams.get('row_id');
    const field = req.nextUrl.searchParams.get('field');

    const sb = await getSupabase();

    if (id) {
      const { error } = await sb.from('t16_overrides').delete().eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ deleted: true });
    }

    if (table && rowId && field) {
      const { error } = await sb
        .from('t16_overrides')
        .delete()
        .eq('table_name', table)
        .eq('row_id', rowId)
        .eq('field', field);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ deleted: true });
    }

    return NextResponse.json(
      { error: 'Provide id or (table, row_id, field) to delete' },
      { status: 400 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
