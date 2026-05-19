// Tool definitions + handlers for the dashboard-ops Slack bot.
// All handlers run server-side with service-role access to Supabase + GHL.

import 'server-only';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { tieredSearchGHLContact } from '@/lib/mappers/ghl';

export const TOOL_DEFINITIONS = [
  {
    name: 'query_supabase',
    description:
      'Run a read-only SQL query against the dashboard Supabase Postgres. ' +
      'Only SELECT statements are allowed. Use this to look up leads, bookings, ' +
      'deals, payments, freshness (MAX(updated_at)), status distributions, etc. ' +
      'Returns up to 100 rows as JSON.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A single SELECT statement.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'check_freshness',
    description:
      'Quickly check the last write time across all sync tables (t01_leads, ' +
      't02_ads, t03_bookings, t06_deals_closed, etc). Returns a summary with ' +
      'status OK / STALE per table. Faster than running multiple queries.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sync',
    description:
      'Manually trigger a sync endpoint to backfill data immediately (e.g. after ' +
      'an API token was fixed). Calls POST /api/sync/{source} on production.',
    input_schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: [
            'ghl', 'bookings', 'bookings/enrich', 'bookings/details',
            'bookings/qa', 'bookings/resolve-stubs', 'deals', 'income',
            'meta', 'youtube', 'grain', 'clients', 'manychat', 'expenses',
            'eod-reports', 'cleanup/junk-leads',
          ],
        },
      },
      required: ['source'],
    },
  },
  {
    name: 'get_lead',
    description:
      'Look up a lead in t01_leads by email, phone, or name. Returns the lead ' +
      'row plus any linked bookings. Use this when a human asks about a specific person.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'email, phone, or name' },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'get_ghl_contact',
    description:
      'Live-search GHL directly by phone/email/name to inspect the raw GHL contact ' +
      '(custom fields, source, tags, pipeline). Use when Supabase is missing data ' +
      'or when debugging why attribution is empty.',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        email: { type: 'string' },
        name:  { type: 'string' },
      },
    },
  },
  {
    name: 'update_booking_status',
    description:
      'Manually override a t03_bookings.status. Use this when the human in Slack ' +
      'tells you the correct status after they investigated (e.g. "this one showed, ' +
      'mark it Showed"). Clears call_outcome_details so it regenerates congruent.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['Showed', 'No Showed', 'Cancelled', 'Rescheduled', 'Needs Review'],
        },
        reason: { type: 'string', description: 'Why \u2014 stored in call_outcome_explanation.' },
      },
      required: ['booking_id', 'status', 'reason'],
    },
  },
] as const;

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleQuerySupabase(input: { sql: string }) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return { error: 'Supabase not configured' };
  const sql = input.sql.trim();
  // Safety: only allow SELECT (no DELETE/UPDATE/INSERT/DROP)
  if (!/^select\s/i.test(sql)) {
    return { error: 'Only SELECT statements are allowed. Use update_booking_status for writes.' };
  }
  // Postgres REST doesn't support arbitrary SQL directly; use the rpc pattern
  // via a named SQL-executor function if present, else fall back to an error.
  // For now, provide a clear error so we know to add the RPC later.
  // Supabase-js offers .rpc('exec_sql', { q: sql }) if we create a function
  // named `exec_sql(q text) returns setof json`. Without that, we can't run
  // arbitrary SQL. The bot will still function with the dedicated tools below.
  try {
    // @ts-expect-error — rpc shape is dynamic
    const { data, error } = await sb.rpc('exec_read_sql', { q: sql });
    if (error) return { error: error.message };
    return { rows: Array.isArray(data) ? data.slice(0, 100) : data };
  } catch (e) {
    return {
      error:
        'query_supabase requires a Postgres function `exec_read_sql(q text) returns jsonb`. ' +
        'Until then, use the dedicated tools: check_freshness, get_lead, get_ghl_contact.',
      detail: String(e),
    };
  }
}

async function handleCheckFreshness() {
  const res = await fetch(`${baseUrl()}/api/monitor/staleness`, { method: 'POST' });
  const data = await res.json();
  return data;
}

async function handleRunSync(input: { source: string }) {
  const url = `${baseUrl()}/api/sync/${input.source}`;
  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST' });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  return { status: res.status, durationMs: Date.now() - t0, url, body };
}

async function handleGetLead(input: { identifier: string }) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return { error: 'Supabase not configured' };
  const q = input.identifier.trim();
  const digits = q.replace(/[^\d]/g, '');
  const clauses: string[] = [];
  if (q.includes('@')) clauses.push(`email.eq.${q.toLowerCase()}`);
  if (digits.length >= 7) clauses.push(`phone.ilike.%${digits}%`);
  clauses.push(`name.ilike.%${q}%`);
  const { data: leads } = await sb.from('t01_leads').select('*').or(clauses.join(',')).limit(5);
  if (!leads?.length) return { found: false };
  const leadIds = leads.map(l => l.id);
  const { data: bookings } = await sb
    .from('t03_bookings')
    .select('id, name, email, date_booked_for, status, calendar, call_outcome_explanation')
    .in('lead_id', leadIds);
  return { found: true, leads, bookings: bookings ?? [] };
}

async function handleGetGHLContact(input: { phone?: string; email?: string; name?: string }) {
  const token = process.env.GHL_API_KEY;
  const loc = process.env.GHL_LOCATION_ID;
  if (!token || !loc) return { error: 'GHL env vars not configured' };
  const contact = await tieredSearchGHLContact(token, loc, input);
  if (!contact) return { found: false };
  return {
    found: true,
    id: contact.id,
    name: contact.contactName || [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    email: contact.email,
    phone: contact.phone,
    source: contact.source,
    tags: contact.tags,
    customFields: (contact.customFields ?? []).filter(f => f.value != null && f.value !== ''),
    dateAdded: contact.dateAdded,
  };
}

async function handleUpdateBookingStatus(input: { booking_id: string; status: string; reason: string }) {
  const sb = await getServerSupabaseAsync();
  if (!sb) return { error: 'Supabase not configured' };
  const { error } = await sb
    .from('t03_bookings')
    .update({
      status: input.status,
      call_outcome_explanation: `Slack override: ${input.reason}`,
      call_outcome_details: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.booking_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, booking_id: input.booking_id, status: input.status };
}

// ── Base URL helper ─────────────────────────────────────────────────────────

function baseUrl(): string {
  // On Vercel, the cron/event handler lives on the prod deployment — use the
  // project's public alias. Locally, fall back to localhost.
  return (
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || 'https://tracking-dashboard-your-app.vercel.app'
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export async function dispatchTool(name: string, input: unknown): Promise<unknown> {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'query_supabase':         return handleQuerySupabase(i as { sql: string });
    case 'check_freshness':        return handleCheckFreshness();
    case 'run_sync':               return handleRunSync(i as { source: string });
    case 'get_lead':               return handleGetLead(i as { identifier: string });
    case 'get_ghl_contact':        return handleGetGHLContact(i as { phone?: string; email?: string; name?: string });
    case 'update_booking_status':  return handleUpdateBookingStatus(i as { booking_id: string; status: string; reason: string });
    default:                        return { error: `Unknown tool: ${name}` };
  }
}
