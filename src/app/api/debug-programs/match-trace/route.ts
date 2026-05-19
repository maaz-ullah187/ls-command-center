import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Debug-only: traces why a specific name/email failed to auto-categorize.
 * GET /api/debug-programs/match-trace?q=ignited
 *
 * Returns matching t07 rows + matching t06 rows so we can diagnose
 * email/name mismatches between the two tables.
 */
export async function GET(req: NextRequest) {
  const supa = await getServerSupabaseAsync();
  if (!supa) return NextResponse.json({ configured: false });
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return NextResponse.json({ error: 'q param required' }, { status: 400 });

  const like = `%${q}%`;

  const [t07, t06] = await Promise.all([
    supa
      .from('t07_income_processors')
      .select('id, date, name, email, status, payment_type, offer, final_amount, amount, processor')
      .or(`name.ilike.${like},email.ilike.${like}`)
      .order('date', { ascending: false })
      .limit(20),
    supa
      .from('t06_deals_closed')
      .select('id, date_closed, name, email, deal_type, offer, cash_collected, contracted_revenue, closer')
      .or(`name.ilike.${like},email.ilike.${like}`)
      .order('date_closed', { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({
    query: q,
    t07: { rows: t07.data ?? [], error: t07.error?.message },
    t06: { rows: t06.data ?? [], error: t06.error?.message },
  });
}
