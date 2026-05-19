// Fathom → call recording + transcript mapper (Pillar 5)
//
// Fathom is the primary call recording source. Fetches meetings from the
// Fathom API and returns a Map<email, FathomEnrichment> for merging onto
// GHL leads via attendee email matching.
//
// Team context (per the spec 2026-04-09):
//   Closers: Closer One, Closer Two
//   Setter:  Setter One
//   Fathom API key = the operator's account, which sees team-shared meetings.

import 'server-only';

export interface FathomMeeting {
  id: string;            // recording_id
  title: string;
  url: string;           // fathom.video/calls/XXX
  createdAt: string;
  scheduledStart: string;
  scheduledEnd: string;
  recordingId: number;
  /** Attendee emails (may be empty if Fathom doesn't expose them) */
  attendeeEmails: string[];
  /** Meeting type inferred from title/attendees */
  callType: 'sales' | 'setter' | 'internal' | 'unknown';
}

export interface FathomEnrichment {
  recordingUrl: string;
  recordingId: string;
  callTitle: string;
  callDate: string;
  callType: 'sales' | 'setter' | 'internal' | 'unknown';
}

const BASE = 'https://api.fathom.ai/external/v1';

// Keywords that indicate internal/team meetings (not sales calls)
const INTERNAL_KEYWORDS = [
  'team meeting', 'weekly sync', 'all team', 'standup', 'stand-up',
  'coaching', '1-1', 'q&a', 'mastermind', 'content synch', 'content sync',
  'strategy', 'pps all team', 'entire team', 'onboarding call with',
  'call center',
];

// Keywords indicating a sales/closer call
const SALES_KEYWORDS = [
  'agency gameplan', 'agency scaling', 'agency systems', 'agency launch',
  'ai marketing', 'ai-roi audit', 'ai integration',
  'demo', 'discovery', 'strategy call', 'intro call',
];

// Keywords indicating a setter call
const SETTER_KEYWORDS = [
  'setter', 'qualification', 'pre-qual', 'screen',
];

function inferCallType(title: string): FathomMeeting['callType'] {
  const lower = title.toLowerCase();
  if (INTERNAL_KEYWORDS.some(k => lower.includes(k))) return 'internal';
  if (SETTER_KEYWORDS.some(k => lower.includes(k))) return 'setter';
  if (SALES_KEYWORDS.some(k => lower.includes(k))) return 'sales';
  return 'unknown';
}

interface FathomAPIItem {
  title: string;
  meeting_title?: string;
  url: string;
  created_at: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  recording_id: number;
  attendees?: Array<{ name?: string; email?: string }>;
}

/**
 * Fetch all Fathom meetings (paginated via cursor). Returns FathomMeeting[].
 */
export async function fetchFathomMeetings(
  token: string,
  lookbackDays = 90,
  maxPages = 10
): Promise<FathomMeeting[]> {
  const all: FathomMeeting[] = [];
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    let url = `${BASE}/meetings?created_after=${encodeURIComponent(since)}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const res = await fetch(url, {
      headers: { 'X-Api-Key': token },
      next: { revalidate: 300 }, // 5 min cache
    });

    if (!res.ok) {
      console.error(`[fathom] meetings HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    const items: FathomAPIItem[] = data.items ?? [];

    for (const m of items) {
      all.push({
        id: String(m.recording_id),
        title: m.title || m.meeting_title || '',
        url: m.url,
        createdAt: m.created_at,
        scheduledStart: m.scheduled_start_time ?? '',
        scheduledEnd: m.scheduled_end_time ?? '',
        recordingId: m.recording_id,
        attendeeEmails: (m.attendees ?? [])
          .map(a => a.email?.toLowerCase().trim())
          .filter((e): e is string => !!e),
        callType: inferCallType(m.title || m.meeting_title || ''),
      });
    }

    cursor = data.next_cursor ?? null;
    if (!cursor || items.length === 0) break;
  }

  return all;
}

/**
 * Build a per-email enrichment map from Fathom meetings.
 * Matches attendee emails to GHL lead emails.
 * Only includes sales + setter + unknown calls (excludes internal meetings).
 */
export function buildFathomEnrichmentByEmail(
  meetings: FathomMeeting[]
): Map<string, FathomEnrichment> {
  const map = new Map<string, FathomEnrichment>();

  // Filter out internal meetings — we only care about sales/setter calls
  const relevant = meetings.filter(m => m.callType !== 'internal');

  for (const m of relevant) {
    for (const email of m.attendeeEmails) {
      // Keep the most recent call per email
      const existing = map.get(email);
      if (existing && m.createdAt < existing.callDate) continue;

      map.set(email, {
        recordingUrl: m.url,
        recordingId: String(m.recordingId),
        callTitle: m.title,
        callDate: m.createdAt.slice(0, 10),
        callType: m.callType,
      });
    }
  }

  return map;
}
