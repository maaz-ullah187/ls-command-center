import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export interface CloserEodAggregate {
  closer_name: string;
  calls_shown: number;
  calls_closed: number;
  cash_collected: number;
  revenue_generated: number;
  calls_booked: number;
  no_shows: number;
  calls_cancelled: number;
  offers_given: number;
  deposits: number;
  report_dates: string[];  // dates (YYYY-MM-DD) that have an EOD report
}

/** Individual EOD row shape returned when detail=true */
export interface CloserEodRow {
  id: string;
  date: string;
  closer_name: string;
  calls_shown: number;
  calls_closed: number;
  cash_collected: number;
  revenue_generated: number;
  calls_booked: number;
  no_shows: number;
  calls_cancelled: number;
  offers_given: number;
  deposits: number;
  feedback: string | null;
  raw_message: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const sb = await getServerSupabaseAsync();
    if (!sb) {
      return NextResponse.json([] as CloserEodAggregate[]);
    }

    const { searchParams } = request.nextUrl;
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const detail = searchParams.get('detail'); // if "true", return individual rows
    const closer = searchParams.get('closer'); // optional filter by closer name

    // --- Detail mode: return individual rows (for edit/delete UI) ---
    if (detail === 'true') {
      let q = sb
        .from('t05_eod_reports')
        .select('id, date, closer_name, calls_shown, calls_closed, cash_collected, revenue_generated, calls_booked, no_shows, calls_cancelled, offers_given, deposits, feedback, raw_message')
        .order('date', { ascending: false });

      if (start) q = q.gte('date', start);
      if (end) q = q.lte('date', end);
      if (closer) q = q.eq('closer_name', closer);

      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(data ?? []);
    }

    // --- Aggregate mode (default) ---
    let query = sb
      .from('t05_eod_reports')
      .select('closer_name, calls_shown, calls_closed, cash_collected, revenue_generated, calls_booked, no_shows, calls_cancelled, offers_given, deposits, date');

    if (start) query = query.gte('date', start);
    if (end) query = query.lte('date', end);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json([] as CloserEodAggregate[]);
    }

    // Aggregate per closer
    const map = new Map<string, CloserEodAggregate>();
    for (const row of data) {
      const name: string = row.closer_name;
      let agg = map.get(name);
      if (!agg) {
        agg = {
          closer_name: name,
          calls_shown: 0,
          calls_closed: 0,
          cash_collected: 0,
          revenue_generated: 0,
          calls_booked: 0,
          no_shows: 0,
          calls_cancelled: 0,
          offers_given: 0,
          deposits: 0,
          report_dates: [],
        };
        map.set(name, agg);
      }
      agg.calls_shown += Number(row.calls_shown) || 0;
      agg.calls_closed += Number(row.calls_closed) || 0;
      agg.cash_collected += Number(row.cash_collected) || 0;
      agg.revenue_generated += Number(row.revenue_generated) || 0;
      agg.calls_booked += Number(row.calls_booked) || 0;
      agg.no_shows += Number(row.no_shows) || 0;
      agg.calls_cancelled += Number(row.calls_cancelled) || 0;
      agg.offers_given += Number(row.offers_given) || 0;
      agg.deposits += Number(row.deposits) || 0;
      if (row.date) agg.report_dates.push(String(row.date));
    }

    return NextResponse.json(Array.from(map.values()));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to load closer EODs' }, { status: 500 });
  }
}

/** PUT — update a single EOD report by id */
export async function PUT(request: NextRequest) {
  try {
    const sb = await getServerSupabaseAsync();
    if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Only allow updating known numeric/text fields
    const allowed = ['date', 'closer_name', 'calls_shown', 'calls_closed', 'cash_collected',
      'revenue_generated', 'calls_booked', 'no_shows', 'calls_cancelled', 'offers_given',
      'deposits', 'feedback'];
    const filtered: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const k of allowed) {
      if (updates[k] !== undefined) filtered[k] = updates[k];
    }

    const { data, error } = await sb
      .from('t05_eod_reports')
      .update(filtered)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Update failed' }, { status: 500 });
  }
}

/** POST — create a new EOD report (for backfilling) */
export async function POST(request: NextRequest) {
  try {
    const sb = await getServerSupabaseAsync();
    if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    const body = await request.json();
    const { date, closer_name, calls_shown, calls_closed, cash_collected, calls_booked,
      no_shows, calls_cancelled, offers_given, deposits, revenue_generated, feedback } = body;

    if (!date || !closer_name) {
      return NextResponse.json({ error: 'date and closer_name are required' }, { status: 400 });
    }

    const id = `manual_${closer_name.replace(/\s+/g, '_').toLowerCase()}_${date}`;

    const row = {
      id,
      date,
      closer_name,
      calls_shown: Number(calls_shown) || 0,
      calls_closed: Number(calls_closed) || 0,
      cash_collected: Number(cash_collected) || 0,
      revenue_generated: Number(revenue_generated) || 0,
      calls_booked: Number(calls_booked) || 0,
      no_shows: Number(no_shows) || 0,
      calls_cancelled: Number(calls_cancelled) || 0,
      offers_given: Number(offers_given) || 0,
      deposits: Number(deposits) || 0,
      feedback: feedback || null,
      raw_message: null,
      slack_ts: null,
    };

    const { data, error } = await sb
      .from('t05_eod_reports')
      .upsert(row, { onConflict: 'date,closer_name' })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Create failed' }, { status: 500 });
  }
}

/** DELETE — remove an EOD report by id */
export async function DELETE(request: NextRequest) {
  try {
    const sb = await getServerSupabaseAsync();
    if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 });

    const { error } = await sb
      .from('t05_eod_reports')
      .delete()
      .eq('id', id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Delete failed' }, { status: 500 });
  }
}
