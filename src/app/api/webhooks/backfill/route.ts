// Webhook backfill — replay historical events to your-attribution-domain.com.
//
// One-shot endpoint to send historical webhook fires for ad-attribution mapping.
// SAFE BY DEFAULT: dry_run=true unless explicitly disabled.
//
// Query params:
//   ?event=call_showed | qualified_call_showed | client_closed | all   (required)
//   ?dry_run=true|false       default true  → returns counts + sample payloads
//   ?since=YYYY-MM-DD         optional      → filter rows on/after this date
//   ?limit=N                  optional      → cap rows fired (default 5000)
//   ?delay_ms=N               optional      → delay between fires (default 100ms)
//
// Examples (dry-run first):
//   curl -X POST 'http://localhost:3000/api/webhooks/backfill?event=all'
//   curl -X POST 'http://localhost:3000/api/webhooks/backfill?event=call_showed&since=2026-01-01'
//   curl -X POST 'http://localhost:3000/api/webhooks/backfill?event=client_closed&dry_run=false'

import { NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import {
  fireCallShowedWebhook,
  fireQualifiedShowedWebhook,
  fireClientClosedWebhook,
} from '@/lib/webhooks/external-webhooks';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

type EventType = 'call_showed' | 'qualified_call_showed' | 'client_closed';

const ALL_EVENTS: EventType[] = ['call_showed', 'qualified_call_showed', 'client_closed'];

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const eventParam = url.searchParams.get('event') ?? '';
  const dryRun = url.searchParams.get('dry_run') !== 'false'; // default TRUE
  const since = url.searchParams.get('since'); // YYYY-MM-DD
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5000', 10) || 5000, 10000);
  const delayMs = parseInt(url.searchParams.get('delay_ms') ?? '100', 10) || 0;

  let events: EventType[];
  if (eventParam === 'all') events = ALL_EVENTS;
  else if (ALL_EVENTS.includes(eventParam as EventType)) events = [eventParam as EventType];
  else {
    return NextResponse.json(
      { error: `event must be one of: ${ALL_EVENTS.join(', ')}, all` },
      { status: 400 },
    );
  }

  const sb = await getServerSupabaseAsync();
  if (!sb) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const report: Record<string, unknown> = { dryRun, since, limit, delayMs, events: {} };

  for (const event of events) {
    if (event === 'call_showed') {
      let q = sb
        .from('t03_bookings')
        .select('id, email, name, phone, date_booked_for, lead_id, calendly_event_url, calendar, offer, closer_assigned')
        .eq('status', 'Showed')
        .order('date_booked_for', { ascending: true })
        .limit(limit);
      if (since) q = q.gte('date_booked_for', since);
      const { data, error } = await q;
      if (error) {
        (report.events as Record<string, unknown>)[event] = { error: error.message };
        continue;
      }
      const rows = (data ?? []) as Array<{
        id: string; email: string | null; name: string | null; phone: string | null;
        date_booked_for: string | null; lead_id: string | null;
        calendly_event_url: string | null; calendar: string | null;
        offer: string | null; closer_assigned: string | null;
      }>;

      // Enrich with lead source from t01_leads (same pattern as /api/data/bookings)
      const leadIds = [...new Set(rows.map(r => r.lead_id).filter(Boolean))] as string[];
      const sourceById = new Map<string, string | null>();
      if (leadIds.length > 0) {
        for (let i = 0; i < leadIds.length; i += 200) {
          const chunk = leadIds.slice(i, i + 200);
          const { data: leads } = await sb.from('t01_leads').select('id, source').in('id', chunk);
          for (const l of (leads ?? []) as Array<{ id: string; source: string | null }>) {
            sourceById.set(l.id, l.source);
          }
        }
      }

      if (dryRun) {
        (report.events as Record<string, unknown>)[event] = {
          count: rows.length,
          sample: rows.slice(0, 3).map(r => ({
            booking_id: r.id, email: r.email, name: r.name,
            date_booked_for: r.date_booked_for,
          })),
        };
        continue;
      }

      let fired = 0; let failed = 0;
      for (const r of rows) {
        const ok = await fireCallShowedWebhook({
          booking_id: r.id,
          email: r.email ?? '',
          name: r.name,
          phone: r.phone,
          date_booked_for: r.date_booked_for,
          ghl_contact_id: r.lead_id,
          calendly_event_url: r.calendly_event_url,
          calendar: r.calendar,
          offer: r.offer,
          source: r.lead_id ? sourceById.get(r.lead_id) ?? null : null,
          closer_assigned: r.closer_assigned,
          trigger: 'backfill',
        });
        if (ok) fired++; else failed++;
        if (delayMs) await sleep(delayMs);
      }
      (report.events as Record<string, unknown>)[event] = { count: rows.length, fired, failed };
    }

    if (event === 'qualified_call_showed') {
      let q = sb
        .from('t04_call_recordings')
        .select('id, qual_score, qual_summary, call_title, call_date, duration_min, closer_email, prospect_name, ghl_contact_id, booking_id')
        .gt('qual_score', 5)
        .order('call_date', { ascending: true })
        .limit(limit);
      if (since) q = q.gte('call_date', since);
      const { data, error } = await q;
      if (error) {
        (report.events as Record<string, unknown>)[event] = { error: error.message };
        continue;
      }
      const rows = (data ?? []) as Array<{
        id: string; qual_score: number; qual_summary: string | null;
        call_title: string | null; call_date: string | null; duration_min: number | null;
        closer_email: string | null; prospect_name: string | null;
        ghl_contact_id: string | null; booking_id: string | null;
      }>;

      if (dryRun) {
        (report.events as Record<string, unknown>)[event] = {
          count: rows.length,
          sample: rows.slice(0, 3).map(r => ({
            recording_id: r.id, qual_score: r.qual_score,
            prospect_name: r.prospect_name, call_date: r.call_date,
          })),
        };
        continue;
      }

      let fired = 0; let failed = 0;
      for (const r of rows) {
        const ok = await fireQualifiedShowedWebhook({
          recording_id: r.id,
          qual_score: r.qual_score,
          qual_summary: r.qual_summary,
          call_title: r.call_title,
          call_date: r.call_date,
          duration_min: r.duration_min,
          closer_email: r.closer_email,
          prospect_name: r.prospect_name,
          ghl_contact_id: r.ghl_contact_id,
          booking_id: r.booking_id,
        });
        if (ok) fired++; else failed++;
        if (delayMs) await sleep(delayMs);
      }
      (report.events as Record<string, unknown>)[event] = { count: rows.length, fired, failed };
    }

    if (event === 'client_closed') {
      let q = sb
        .from('t06_deals_closed')
        .select('id, name, email, phone, cash_collected, date_closed')
        .order('date_closed', { ascending: true })
        .limit(limit);
      if (since) q = q.gte('date_closed', since);
      const { data, error } = await q;
      if (error) {
        (report.events as Record<string, unknown>)[event] = { error: error.message };
        continue;
      }
      const rows = (data ?? []) as Array<{
        id: string; name: string; email: string | null; phone: string | null;
        cash_collected: number; date_closed: string | null;
      }>;

      if (dryRun) {
        (report.events as Record<string, unknown>)[event] = {
          count: rows.length,
          sample: rows.slice(0, 3).map(r => ({
            deal_id: r.id, name: r.name, email: r.email,
            cash_collected: r.cash_collected, date_closed: r.date_closed,
          })),
        };
        continue;
      }

      let fired = 0; let failed = 0;
      for (const r of rows) {
        const ok = await fireClientClosedWebhook({
          name: r.name,
          email: r.email,
          phone: r.phone,
          cash_collected: Number(r.cash_collected) || 0,
        });
        if (ok) fired++; else failed++;
        if (delayMs) await sleep(delayMs);
      }
      (report.events as Record<string, unknown>)[event] = { count: rows.length, fired, failed };
    }
  }

  return NextResponse.json(report);
}

export const GET = POST;
