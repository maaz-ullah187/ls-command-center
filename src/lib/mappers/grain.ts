// Grain → call recording + transcript mapper (Pillar 5)
//
// Grain is the primary call recording & transcript source. Fetches workspace-wide
// recordings from the Grain Public API and returns enrichment maps for merging onto
// GHL leads via attendee/owner email matching.
//
// API base: https://api.grain.com/_/public-api
// Auth: Bearer <personal_access_token> (PAT — workspace-wide access)
//
// Team context: configure via TEAM_EMAILS / TEAM_FIRST_NAMES env vars
// (see TEAM_EMAILS Set construction below). The mapper itself is generic —
// it relies on attendee/owner email matching to GHL contacts.

import 'server-only';

const BASE = 'https://api.grain.com/_/public-api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GrainRecording {
  id: string;
  title: string;
  owners: string[];              // email addresses of hosts
  source: string;                // 'zoom', 'google_meet', etc.
  url: string;                   // shareable Grain URL
  publicUrl?: string;
  tags: string[];
  summary: string;
  startDatetime: string;
  endDatetime: string;
  durationMs: number;
  thumbnailUrl?: string;
  summaryPoints: Array<{ timestamp: number; text: string }>;
  transcriptTxtUrl?: string;
  transcriptJsonUrl?: string;
  intelligenceNotes?: string;    // markdown AI notes
  callType: 'sales' | 'setter' | 'fulfillment' | 'internal' | 'unknown';
}

export interface GrainEnrichment {
  recordingUrl: string;
  recordingId: string;
  callTitle: string;
  callDate: string;
  callType: GrainRecording['callType'];
  durationMin: number;
  summary: string;
  transcriptTxtUrl?: string;
  transcriptJsonUrl?: string;
  intelligenceNotes?: string;
  ownerEmail: string;
}

// ─── Call type inference ─────────────────────────────────────────────────────

const INTERNAL_KEYWORDS = [
  'team meeting', 'weekly sync', 'all team', 'standup', 'stand-up',
  'coaching', '1-1', 'q&a', 'mastermind', 'content synch', 'content sync',
  'strategy session', 'pps all team', 'entire team', 'onboarding call with',
  'call center', 'weekly content', 'daily standup', 'check in', 'check-in',
  'performance audit', 'fulfillment', 'founder call', 'all hands',
  'internal sync',
];

const SALES_KEYWORDS = [
  'demo', 'discovery', 'strategy call', 'intro call',
  'sales call', 'sales meeting',
  // Add your offer-specific call-name keywords here:
  // 'agency scaling', 'agency systems', 'ai integration', etc.
];

const SETTER_KEYWORDS = [
  'setter', 'qualification', 'pre-qual', 'screen', 'triage',
];

const FULFILLMENT_KEYWORDS = [
  'fulfillment', 'onboarding', 'kickoff', 'kick-off', 'check in',
  'check-in', 'implementation',
];

// Known internal team emails — calls between these only are internal.
// Populate from env var TEAM_EMAILS (comma-separated) so the template stays generic.
const TEAM_EMAILS = new Set(
  (process.env.TEAM_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
);

function inferCallType(title: string, owners: string[]): GrainRecording['callType'] {
  const lower = title.toLowerCase();
  if (INTERNAL_KEYWORDS.some(k => lower.includes(k))) return 'internal';

  // (Title-based team-only detection removed — relied on hardcoded names.
  //  The prospect-name extractor below handles the same case generically:
  //  if no prospect can be parsed and no sales keyword matches, it falls
  //  through to 'internal'.)

  if (FULFILLMENT_KEYWORDS.some(k => lower.includes(k))) return 'fulfillment';
  if (SETTER_KEYWORDS.some(k => lower.includes(k))) return 'setter';
  if (SALES_KEYWORDS.some(k => lower.includes(k))) return 'sales';

  // If title contains "and [CloserName]" pattern, likely a sales call
  const closerEmails = ['closer.one@example.com', 'closer.two@example.com'];
  if (owners.some(o => closerEmails.includes(o.toLowerCase()))) return 'sales';

  return 'unknown';
}

// ─── API fetching ────────────────────────────────────────────────────────────

interface GrainAPIRecording {
  id: string;
  title: string;
  owners: string[];
  source: string;
  url: string;
  public_url?: string;
  tags: string[];
  summary: string;
  start_datetime: string;
  end_datetime: string;
  duration_ms: number;
  public_thumbnail_url?: string;
  summary_points?: Array<{ timestamp: number; text: string }>;
  transcript_txt_url?: string;
  transcript_json_url?: string;
  transcript_srt_url?: string;
  transcript_vtt_url?: string;
  intelligence_notes_md?: string;
}

interface GrainAPIResponse {
  cursor?: string;
  recordings: GrainAPIRecording[];
}

function mapAPIRecording(r: GrainAPIRecording): GrainRecording {
  return {
    id: r.id,
    title: r.title,
    owners: r.owners ?? [],
    source: r.source,
    url: r.url,
    publicUrl: r.public_url,
    tags: r.tags ?? [],
    summary: r.summary ?? '',
    startDatetime: r.start_datetime,
    endDatetime: r.end_datetime,
    durationMs: r.duration_ms,
    thumbnailUrl: r.public_thumbnail_url,
    summaryPoints: r.summary_points ?? [],
    transcriptTxtUrl: r.transcript_txt_url,
    transcriptJsonUrl: r.transcript_json_url,
    intelligenceNotes: r.intelligence_notes_md,
    callType: inferCallType(r.title, r.owners),
  };
}

/**
 * Fetch all Grain recordings (paginated via cursor). Returns GrainRecording[].
 */
export async function fetchGrainRecordings(
  token: string,
  maxPages = 50
): Promise<GrainRecording[]> {
  const all: GrainRecording[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    let url = `${BASE}/recordings`;
    if (cursor) url += `?cursor=${encodeURIComponent(cursor)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 300 }, // 5 min cache
    });

    if (!res.ok) {
      console.error(`[grain] recordings HTTP ${res.status}`);
      break;
    }

    // Grain may return NDJSON — parse only the first JSON object
    const text = await res.text();
    let data: GrainAPIResponse;
    try {
      data = JSON.parse(text);
    } catch {
      // Try parsing just the first JSON object (NDJSON format)
      const firstBrace = text.indexOf('{');
      if (firstBrace === -1) break;
      let depth = 0;
      let end = firstBrace;
      for (let i = firstBrace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        if (depth === 0) { end = i + 1; break; }
      }
      data = JSON.parse(text.slice(firstBrace, end));
    }

    const items = data.recordings ?? [];
    for (const r of items) {
      all.push(mapAPIRecording(r));
    }

    cursor = data.cursor ?? null;
    if (!cursor || items.length === 0) break;
  }

  return all;
}

/**
 * Fetch transcript text for a specific recording.
 */
export async function fetchGrainTranscript(
  token: string,
  recordingId: string
): Promise<string | null> {
  const url = `${BASE}/recordings/${recordingId}/transcript.txt`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 3600 }, // 1 hour cache — transcripts don't change
  });
  if (!res.ok) {
    console.error(`[grain] transcript HTTP ${res.status} for ${recordingId}`);
    return null;
  }
  return res.text();
}

/**
 * Build a per-email enrichment map from Grain recordings.
 *
 * Matching strategy:
 * 1. Extract prospect name from title pattern "[Prospect] and [TeamMember]"
 * 2. Match against GHL leads by title cross-ref (future: by attendee email from transcript)
 * 3. For now: match by owner email → recording metadata available for closer performance tracking
 *
 * Since Grain doesn't return attendee emails in the recordings list, we extract
 * the prospect name from the title and expose it for name-based matching.
 */
export function buildGrainEnrichmentByTitle(
  recordings: GrainRecording[]
): { byProspectName: Map<string, GrainEnrichment>; byOwner: Map<string, GrainEnrichment[]> } {
  const byProspectName = new Map<string, GrainEnrichment>();
  const byOwner = new Map<string, GrainEnrichment[]>();

  // Filter to sales/setter/unknown calls (exclude internal + fulfillment)
  const relevant = recordings.filter(r =>
    r.callType === 'sales' || r.callType === 'setter' || r.callType === 'unknown'
  );

  for (const r of relevant) {
    const enrichment: GrainEnrichment = {
      recordingUrl: r.url,
      recordingId: r.id,
      callTitle: r.title,
      callDate: r.startDatetime.slice(0, 10),
      callType: r.callType,
      durationMin: Math.round(r.durationMs / 60000),
      summary: r.summary,
      transcriptTxtUrl: r.transcriptTxtUrl,
      transcriptJsonUrl: r.transcriptJsonUrl,
      intelligenceNotes: r.intelligenceNotes,
      ownerEmail: r.owners[0] ?? '',
    };

    // Extract prospect name from title: "[Prospect Name] and [Team Member]"
    const prospectName = extractProspectName(r.title, r.owners);
    if (prospectName) {
      const key = prospectName.toLowerCase().trim();
      const existing = byProspectName.get(key);
      if (!existing || r.startDatetime > existing.callDate) {
        byProspectName.set(key, enrichment);
      }
    }

    // Index by owner email for closer performance tracking
    for (const owner of r.owners) {
      const ownerKey = owner.toLowerCase();
      const list = byOwner.get(ownerKey) ?? [];
      list.push(enrichment);
      byOwner.set(ownerKey, list);
    }
  }

  return { byProspectName, byOwner };
}

// Prefixes to strip from Grain titles before extracting prospect name
const TITLE_PREFIXES_TO_STRIP = [
  /^AI Integration™?\s*[-–—]\s*/i,
  /^AI[-\s]ROI Audit\s*[-–—]\s*/i,
  /^\[ProgB\]\s*[-–—]?\s*/i,
  /^\[AI\]\s*[-–—]?\s*/i,
];

// Suffixes to strip (e.g. "- Demo follow up", "- Patient Generation Call")
const TITLE_SUFFIXES_TO_STRIP = [
  /\s*[-–—]\s*Demo follow\s*up$/i,
  /\s*[-–—]\s*Patient Generation Call$/i,
  /\s*[-–—]\s*AI (Assessment|Integration)$/i,
  /\s*<>\s*YOUR_COMPANY\s*(call|booking)$/i,
];

// Calendly event name patterns embedded in Grain titles
// e.g. "[Prospect Name] - $100k/mo Agency Scaling Call w/  [Closer]"
// e.g. "[Prospect Name]: *Agency Systems Call [FB]"
const CALENDLY_TITLE_PATTERNS = [
  /^(.+?)\s*[-–—]\s*\$100k\/mo Agency Scaling Call\s+w\/\s*.+$/i,
  /^(.+?)\s*[-–—]\s*AI[-\s]ROI Audit\s*\(.*?\)\s*$/i,
  /^(.+?):\s*\*?Agency\s+(Systems|Launch)\s+Call\s*\[.*?\]$/i,
];

/** Normalize a name: collapse whitespace, trim, lowercase for comparison. */
function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Extract the prospect's name from a Grain recording title.
 * Exported so the Grain sync route can use the same logic.
 * Handles patterns like:
 *   "AI Integration™ - Max & Closer Two"  → "Max"
 *   "[Prospect] and [TeamMember]"     → "[Prospect]"
 *   "Natasha Jain-Nair - Demo follow up" → "Natasha Jain-Nair"
 *   "Hello Laser<> YOUR_COMPANY booking"       → "Hello Laser"
 */
export function extractProspectName(title: string, owners: string[]): string | null {
  // Try Calendly title patterns first — these are very specific and reliable
  for (const re of CALENDLY_TITLE_PATTERNS) {
    const m = title.match(re);
    if (m?.[1]) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name.length > 1) return name;
    }
  }

  let cleaned = title;

  // Strip known prefixes and suffixes
  for (const re of TITLE_PREFIXES_TO_STRIP) cleaned = cleaned.replace(re, '');
  for (const re of TITLE_SUFFIXES_TO_STRIP) cleaned = cleaned.replace(re, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (!cleaned) return null;

  // Get team member names from owner emails
  const ownerNames = owners.map(email => {
    const local = email.split('@')[0];
    return local.replace(/[._]/g, ' ').toLowerCase();
  });

  // Known team first names for fallback matching.
  // Populate from env var TEAM_FIRST_NAMES (comma-separated, lowercase).
  const teamFirstNames = new Set(
    (process.env.TEAM_FIRST_NAMES ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const isTeamName = (part: string): boolean => {
    const partLower = normalizeName(part);
    // Check against owner email-derived names
    const matchesOwner = ownerNames.some(n => {
      const nameWords = n.split(' ');
      return nameWords.some(w => w.length > 2 && partLower.includes(w));
    });
    if (matchesOwner) return true;
    // Check against known team first names (for first-name-only separations)
    if (teamFirstNames.has(partLower)) return true;
    // Check against team emails
    if (TEAM_EMAILS.has(partLower)) return true;
    return false;
  };

  // Handle "<>" separator first (no space before it): "Tori ResizeMe<> YOUR_COMPANY call"
  if (cleaned.includes('<>')) {
    const beforeAngle = cleaned.split('<>')[0].trim();
    if (beforeAngle.length > 1 && !isTeamName(beforeAngle)) {
      return beforeAngle.replace(/\s+/g, ' ').trim();
    }
  }

  // Split on common separators (w/ = "with" from Calendly titles)
  const separators = [' and ', ' x ', ' X ', ' & ', ' w/ '];
  for (const sep of separators) {
    if (cleaned.includes(sep)) {
      const parts = cleaned.split(sep).map(p => p.trim()).filter(p => p.length > 1);
      for (const part of parts) {
        if (!isTeamName(part)) {
          return part.replace(/\s+/g, ' ').trim();
        }
      }
    }
  }

  // If no separator found but title is not a team name, it might be the prospect name directly
  // (e.g. "Alexandra Huertas" or "Vitality Aesthetic Solutions")
  if (!isTeamName(cleaned) && cleaned.length > 2) {
    return cleaned;
  }

  return null;
}
