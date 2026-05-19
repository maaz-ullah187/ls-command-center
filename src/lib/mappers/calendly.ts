// Calendly → Lead enrichment mapper (Pillar 3)
//
// Fetches org-wide scheduled events from Calendly and returns a
// Map<email, CalendlyEnrichment> that getLeads() merges onto GHL leads.
// Match key is invitee email → GHL lead email.

import 'server-only';

export interface CalendlyEnrichment {
  eventName: string;
  eventUrl: string;
  startTime: string;
  status: 'active' | 'canceled';
}

const ORG_URI = process.env.CALENDLY_ORG_URI
  ?? `https://api.calendly.com/organizations/${process.env.CALENDLY_ORG_ID ?? ''}`;

interface CalendlyEvent {
  uri: string;
  name: string;
  start_time: string;
  end_time: string;
  status: string;
  location?: { join_url?: string };
}

interface CalendlyInvitee {
  email: string;
  name: string;
  status: string;
}

/**
 * Fetch all org-wide Calendly events for the last N days.
 * Returns Map<email, CalendlyEnrichment> keyed by invitee email (lowercased).
 */
export async function fetchCalendlyEnrichment(
  token: string,
  lookbackDays = 90
): Promise<Map<string, CalendlyEnrichment>> {
  const map = new Map<string, CalendlyEnrichment>();

  const now = new Date();
  const min = new Date(now.getTime() - lookbackDays * 86400000);

  // Fetch events (paginated, up to 500)
  const events: CalendlyEvent[] = [];
  let nextPage: string | null = null;
  const maxPages = 5; // 5 × 100 = 500 events

  for (let page = 0; page < maxPages; page++) {
    const url = nextPage || (
      `https://api.calendly.com/scheduled_events?organization=${encodeURIComponent(ORG_URI)}` +
      `&min_start_time=${min.toISOString()}` +
      `&max_start_time=${now.toISOString()}` +
      `&count=100&sort=start_time:desc`
    );

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 300 }, // 5 min cache
    });

    if (!res.ok) {
      console.error(`[calendly] events HTTP ${res.status}: ${res.statusText}`);
      break;
    }

    const data = await res.json();
    const items: CalendlyEvent[] = data.collection ?? [];
    events.push(...items);

    nextPage = data.pagination?.next_page_token
      ? `https://api.calendly.com/scheduled_events?organization=${encodeURIComponent(ORG_URI)}&page_token=${data.pagination.next_page_token}&count=100&sort=start_time:desc`
      : null;
    if (!nextPage || items.length < 100) break;
  }

  if (events.length === 0) return map;

  // For each event, fetch invitees in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 10;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const inviteeResults = await Promise.allSettled(
      batch.map(async (event) => {
        const invRes = await fetch(`${event.uri}/invitees`, {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 300 },
        });
        if (!invRes.ok) return [];
        const invData = await invRes.json();
        return (invData.collection ?? []) as CalendlyInvitee[];
      })
    );

    for (let j = 0; j < batch.length; j++) {
      const event = batch[j];
      const result = inviteeResults[j];
      if (result.status !== 'fulfilled') continue;

      for (const inv of result.value) {
        const email = inv.email?.toLowerCase().trim();
        if (!email) continue;

        // Keep the most recent event per email
        if (map.has(email)) {
          const existing = map.get(email)!;
          if (event.start_time < existing.startTime) continue;
        }

        map.set(email, {
          eventName: event.name,
          eventUrl: event.location?.join_url || event.uri,
          startTime: event.start_time,
          status: event.status === 'canceled' ? 'canceled' : 'active',
        });
      }
    }
  }

  return map;
}
