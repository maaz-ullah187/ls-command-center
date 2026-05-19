// Outbound webhooks → your-attribution-domain.com (ad attribution platform).
//
// Two events:
//   1. fireCallShowedWebhook(booking)        — t03_bookings row hit status='Showed'
//   2. fireQualifiedShowedWebhook(recording) — t04_call_recordings got qual_score > 5
//
// Both URLs come from env (override-able) and fall back to the production
// endpoints the operator pasted on 2026-04-27. Fires are best-effort: a failed POST
// is logged but never throws — never block a Supabase mutation on the webhook.

const DEFAULT_CALL_SHOWED_URL =
  'https://your-attribution-domain.com/api/webhook/76374e22-f6ae-48c4-83da-335950825632/2f05697a-18d1-49a7-a26a-aa8fd4452e7c';

const DEFAULT_QUALIFIED_SHOWED_URL =
  'https://your-attribution-domain.com/api/webhook/76374e22-f6ae-48c4-83da-335950825632/8ab38569-f20b-4634-bc1c-dd8b2e2bdfd0';

const DEFAULT_CLIENT_CLOSED_URL =
  'https://your-attribution-domain.com/api/webhook/76374e22-f6ae-48c4-83da-335950825632/e96493c3-1d47-4b14-a5d4-9141e7296b5d';

async function postWebhook(url: string, payload: Record<string, unknown>, label: string) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Don't let a slow webhook stall a sync run
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[webhook:${label}] ${res.status} ${res.statusText} — ${body.slice(0, 500)}`);
      return false;
    }
    console.log(`[webhook:${label}] fired ✓`);
    return true;
  } catch (err) {
    console.error(`[webhook:${label}] failed:`, err);
    return false;
  }
}

export type CallShowedPayload = {
  event: 'call_showed';
  booking_id: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  date_booked_for?: string | null;
  ghl_contact_id?: string | null; // sourced from t03_bookings.lead_id
  calendly_event_url?: string | null;
  calendar?: string | null;
  offer?: string | null;
  source?: string | null;
  closer_assigned?: string | null;
  trigger?: 'enrich' | 'qa' | 'manual_correction' | 'backfill';
  triggered_at: string;
};

export async function fireCallShowedWebhook(payload: Omit<CallShowedPayload, 'event' | 'triggered_at'>) {
  const url = process.env.WEBHOOK_CALL_SHOWED_URL || DEFAULT_CALL_SHOWED_URL;
  const body: CallShowedPayload = {
    event: 'call_showed',
    triggered_at: new Date().toISOString(),
    ...payload,
  };
  return postWebhook(url, body, 'call_showed');
}

export type QualifiedShowedPayload = {
  event: 'qualified_call_showed';
  recording_id: string;
  qual_score: number;
  qual_summary?: string | null;
  call_title?: string | null;
  call_date?: string | null;
  duration_min?: number | null;
  closer_email?: string | null;
  prospect_name?: string | null;
  ghl_contact_id?: string | null;
  booking_id?: string | null;
  triggered_at: string;
};

export async function fireQualifiedShowedWebhook(payload: Omit<QualifiedShowedPayload, 'event' | 'triggered_at'>) {
  const url = process.env.WEBHOOK_QUALIFIED_SHOWED_URL || DEFAULT_QUALIFIED_SHOWED_URL;
  const body: QualifiedShowedPayload = {
    event: 'qualified_call_showed',
    triggered_at: new Date().toISOString(),
    ...payload,
  };
  return postWebhook(url, body, 'qualified_call_showed');
}

export type ClientClosedPayload = {
  event: 'client_closed';
  name: string;
  email: string | null;
  phone: string | null;
  cash_collected: number;
  triggered_at: string;
};

export async function fireClientClosedWebhook(payload: Omit<ClientClosedPayload, 'event' | 'triggered_at'>) {
  const url = process.env.WEBHOOK_CLIENT_CLOSED_URL || DEFAULT_CLIENT_CLOSED_URL;
  const body: ClientClosedPayload = {
    event: 'client_closed',
    triggered_at: new Date().toISOString(),
    ...payload,
  };
  return postWebhook(url, body, 'client_closed');
}
