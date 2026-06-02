// Slack → Closer EOD message parser (Pillar 6)
//
// Parses structured "Closer EOD" messages posted to #sales-rep-eods.
// Messages arrive as Slack block objects with a single section block
// containing mrkdwn text. Each field is on its own line as "Label: *value*".

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CloserEodData {
  date: string;               // YYYY-MM-DD
  closerName: string;
  callsBooked: number;
  callsShown: number;
  noShows: number;
  callsCancelled: number;
  offersGiven: number;
  deposits: number;
  dealsClosed: number;
  cashCollected: number;
  revenueGenerated: number;
  feedback: string;
  newCalls: number;
  followUpCalls: number;
  rawMessage: string;
  slackTs: string;
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text?: string; elements?: unknown[] }>;
}

export interface SlackMessage {
  text?: string;
  ts?: string;
  blocks?: SlackBlock[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  'DM Setter EOD',
  'Phone Setter EOD',
  'Daily Performance Summary',
  'Reminder',
];

/** Parse "Apr 9, 2026" → "2026-04-09" */
function parseDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Strip bold markers, dollar signs, commas → number. Returns 0 on failure. */
function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[*$,]/g, '').trim();
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Extract value from a "Label: *value*" line.
 * Handles both bold-wrapped values (*value*) and plain values.
 */
function extractField(text: string, label: string): string | undefined {
  // Escape special regex characters in label
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}:\\s*\\*?([^*\\n]+?)\\*?\\s*$`, 'm');
  const m = text.match(re);
  return m?.[1]?.trim();
}

/** Extract the full feedback field which may span multiple lines. */
function extractFeedback(text: string): string {
  const label =
    'What do you guys need feedback on or need help with? Give a summary of what went well today/and what we need to work on';
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}:\\s*\\*?([^*]+?)\\*?\\s*(?:\\n|$)`, 'm');
  const m = text.match(re);
  return m?.[1]?.trim() ?? '';
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a Slack message into structured Closer EOD data.
 * Returns null if the message is not a Closer EOD or cannot be parsed.
 */
export function parseCloserEod(msg: SlackMessage): CloserEodData | null {
  // Gate: only process Closer EOD messages
  if (!msg.text || !msg.text.includes('Closer EOD')) return null;

  // Skip other EOD types and summaries
  for (const pattern of SKIP_PATTERNS) {
    if (msg.text.includes(pattern)) return null;
  }

  // Extract block text from section blocks
  let blockText = '';
  if (msg.blocks?.length) {
    for (const block of msg.blocks) {
      if (block.type === 'section' && block.text?.text) {
        blockText += block.text.text + '\n';
      }
    }
  }

  // Fall back to msg.text if no block text found
  const text = blockText || msg.text;

  // Extract fields
  const rawDate = extractField(text, 'Date');
  const closerName = extractField(text, 'Name') ?? '';
  if (!rawDate || !closerName) return null;

  const date = parseDate(rawDate);

  return {
    date,
    closerName,
    callsBooked: parseNum(extractField(text, 'Calls Scheduled')),
    callsShown: parseNum(extractField(text, 'Calls Taken')),
    noShows: parseNum(extractField(text, 'No Shows')),
    callsCancelled: parseNum(extractField(text, 'Calls Cancelled')),
    offersGiven: parseNum(extractField(text, 'Offers Made')),
    deposits: parseNum(extractField(text, 'Deposits')),
    dealsClosed: parseNum(extractField(text, 'Deals Closed')),
    cashCollected: parseNum(extractField(text, 'Total Cash Collected')),
    revenueGenerated: parseNum(extractField(text, 'Revenue Generated')),
    feedback: extractFeedback(text),
    newCalls: parseNum(extractField(text, 'New Calls')),
    followUpCalls: parseNum(extractField(text, 'Follow Up Calls')),
    rawMessage: text,
    slackTs: msg.ts ?? '',
  };
}
