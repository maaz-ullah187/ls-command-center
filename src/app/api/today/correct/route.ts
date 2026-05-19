/**
 * POST /api/today/correct
 *
 * Inline correction endpoint for /today cards. Updates the source row AND
 * logs the correction to t16_overrides for audit + future re-aggregation.
 *
 * Body shape:
 *   {
 *     table: "t01_leads" | "t03_bookings" | "t08_expenses" | ...,
 *     row_id: string,
 *     field: string,        // e.g. "source", "status", "expense_type"
 *     new_value: string | number | null,
 *     reason?: string       // user-supplied rationale (optional)
 *   }
 *
 * Per dashboard spec acceptance criteria #5:
 *   "Corrections on /today cards write both to source table and t16_overrides"
 */

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { fireCallShowedWebhook } from '@/lib/webhooks/external-webhooks';

export const dynamic = 'force-dynamic';

const ALLOWED_TABLES = new Set([
  't01_leads',
  't03_bookings',
  't04_call_recordings',
  't06_deals_closed',
  't07_income_processors',
  't08_expenses',
  't_client_ledger',
]);

export async function POST(req: Request) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const body = await req.json();
  const { table, row_id, field, new_value, reason } = body as {
    table: string; row_id: string; field: string; new_value: unknown; reason?: string;
  };

  if (!table || !row_id || !field) {
    return NextResponse.json({ error: 'table, row_id, field are required' }, { status: 400 });
  }
  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: `table ${table} not allowed for inline correction` }, { status: 403 });
  }

  // Read original value first so we can store it in t16_overrides
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: readErr } = await (sb as any).from(table).select(field).eq('id', row_id).maybeSingle();
  if (readErr) return NextResponse.json({ error: `read failed: ${readErr.message}` }, { status: 500 });

  const original = existing?.[field] ?? null;

  // Update the source row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (sb as any).from(table).update({ [field]: new_value, updated_at: new Date().toISOString() }).eq('id', row_id);
  if (updateErr) return NextResponse.json({ error: `update failed: ${updateErr.message}` }, { status: 500 });

  // Log the override (upsert on (table_name, row_id, field) so re-corrections overwrite)
  const { error: overrideErr } = await sb.from('t16_overrides').upsert(
    {
      table_name: table,
      row_id,
      field,
      original: { value: original },
      corrected: { value: new_value },
      edited_by: process.env.OPERATOR_EMAIL ?? 'operator@example.com',
      reason: reason ?? '/today inline correction',
      edited_at: new Date().toISOString(),
    },
    { onConflict: 'table_name,row_id,field' },
  );

  if (overrideErr) {
    // Source row was updated but override log failed — return warning, not full fail
    return NextResponse.json({
      ok: true,
      warning: `source updated but override log failed: ${overrideErr.message}`,
    });
  }

  // Ad-attribution webhook: fire when a manual /today correction transitions
  // a booking's status to 'Showed' (and it wasn't already 'Showed').
  if (
    table === 't03_bookings' &&
    field === 'status' &&
    new_value === 'Showed' &&
    original !== 'Showed'
  ) {
    // Pull the rest of the booking row for the webhook payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: full } = await (sb as any)
      .from('t03_bookings')
      .select('id, email, name, phone, date_booked_for, lead_id, calendly_event_url, calendar, offer, closer_assigned')
      .eq('id', row_id)
      .maybeSingle();
    if (full) {
      fireCallShowedWebhook({
        booking_id: full.id,
        email: full.email ?? '',
        name: full.name ?? null,
        phone: full.phone ?? null,
        date_booked_for: full.date_booked_for ?? null,
        ghl_contact_id: full.lead_id ?? null,
        calendly_event_url: full.calendly_event_url ?? null,
        calendar: full.calendar ?? null,
        offer: full.offer ?? null,
        closer_assigned: full.closer_assigned ?? null,
        trigger: 'manual_correction',
      }).catch(() => { /* logged inside helper */ });
    }
  }

  return NextResponse.json({ ok: true, table, row_id, field, original, corrected: new_value });
}
