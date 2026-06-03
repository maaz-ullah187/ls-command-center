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
  // SDR EODs use the same form template as closers but are tracked separately.
  // Match both the standalone token and the common "SDR EOD" header.
  'SDR EOD',
  'SDR DEPARTMENT',
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
  // Handle all of:
  //   Label: value
  //   Label: *value*
  //   *Label:* value          (Slack bold wrapping label + colon)
  //   *Label*: value          (bold ends before colon)
  //   *Label:*0               (no space between colon-star and value)
  //   *Label:* *value*
  // Optional leading `*`, label, optional `*` before colon, colon, optional
  // `*` after colon, optional whitespace, then capture the value (which may
  // itself be wrapped in `*`).
  const re = new RegExp(
    `\\*?\\s*${escaped}\\s*\\*?\\s*:\\s*\\*?\\s*([^*\\n]*?)\\s*\\*?\\s*$`,
    'm',
  );
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : undefined;
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
  // Extract block text FIRST — bot messages (e.g. EOD form bots) usually
  // put the real content in section blocks and set `msg.text` to a generic
  // fallback like "New EOD posted". Gating on msg.text alone drops them all.
  let blockText = '';
  if (msg.blocks?.length) {
    for (const block of msg.blocks) {
      if (block.type === 'section' && block.text?.text) {
        blockText += block.text.text + '\n';
      }
    }
  }

  // Combined haystack for the gate + skip checks.
  const combined = `${msg.text ?? ''}\n${blockText}`;

  // ── DEBUG (temporary) ───────────────────────────────────────────────
  // Remove once EOD sync is confirmed working end-to-end.
  const debugTs = (msg as { ts?: string }).ts ?? 'no-ts';
  console.log(`[eod-debug] ─── msg ts=${debugTs} ───`);
  console.log(`[eod-debug] msg.text:`, JSON.stringify(msg.text ?? '').slice(0, 200));
  console.log(`[eod-debug] blockText (first 400):`, JSON.stringify(blockText).slice(0, 400));

  // Gate: only process Closer EOD messages.
  // Accept any of:
  //   1. "Closer EOD" header  (original convention)
  //   2. "SALES DEPARTMENT" header  (Jacob's bot-posted form)
  //   3. Header-less manual submissions that carry all three structural
  //      markers: Name:, Date:, and a Demo Call Metrics section.
  //      `.includes('Name:')` matches inside bold-wrapped `*Name:*` too.
  const hasHeader =
    combined.includes('Closer EOD') || combined.includes('SALES DEPARTMENT');
  const hasManualMarkers =
    combined.includes('Name:') &&
    combined.includes('Date:') &&
    combined.includes('Demo Call Metrics');

  if (!hasHeader && !hasManualMarkers) {
    console.log(
      `[eod-debug] ts=${debugTs} SKIP: no header and missing manual markers ` +
        `(Name/Date/Demo Call Metrics)`,
    );
    return null;
  }
  if (!hasHeader) {
    console.log(`[eod-debug] ts=${debugTs} accepted via header-less manual markers`);
  }

  // Skip other EOD types and summaries
  for (const pattern of SKIP_PATTERNS) {
    if (combined.includes(pattern)) {
      console.log(`[eod-debug] ts=${debugTs} SKIP: matched SKIP_PATTERN "${pattern}"`);
      return null;
    }
  }
  console.log(`[eod-debug] ts=${debugTs} PASSED skip-patterns gate`);

  // Field extraction prefers block text (where bots put structured fields)
  // and falls back to msg.text for plain user posts.
  const text = blockText || msg.text || '';

  // Extract fields
  const rawDate = extractField(text, 'Date');
  const closerName = extractField(text, 'Name') ?? '';
  console.log(
    `[eod-debug] ts=${debugTs} rawDate=${JSON.stringify(rawDate)} closerName=${JSON.stringify(closerName)}`,
  );
  if (!rawDate || !closerName) {
    console.log(`[eod-debug] ts=${debugTs} SKIP: missing rawDate or closerName`);
    return null;
  }

  const date = parseDate(rawDate);

  // Demo-only fields (Calls Scheduled, Calls Taken, Offers Made, Deposits,
  // Total Cash Collected, plus Show Rate / Show→Close Rate if added later)
  // must be pulled from the "Demo Call Metrics" section ONLY — Jacob's EOD
  // template has an "Intro Call Metrics" section with identical labels, and
  // the original parser was matching the first occurrence (intro values).
  //
  // Slice strategy: find the Demo Call Metrics header and use everything
  // after it as the haystack for these fields. Fall back to the full text
  // if the header isn't present (legacy / non-bot formats).
  const demoIdx = text.search(/Demo Call Metrics/i);
  const demoText = demoIdx >= 0 ? text.slice(demoIdx) : text;
  console.log(
    `[eod-debug] ts=${debugTs} demoHeaderFound=${demoIdx >= 0} demoTextLen=${demoText.length}`,
  );

  return {
    date,
    closerName,
    callsBooked: parseNum(extractField(demoText, 'Calls Scheduled')),
    callsShown: parseNum(extractField(demoText, 'Calls Taken')),
    noShows: parseNum(extractField(text, 'No Shows')),
    callsCancelled: parseNum(extractField(text, 'Calls Cancelled')),
    offersGiven: parseNum(extractField(demoText, 'Offers Made')),
    deposits: parseNum(extractField(demoText, 'Deposits')),
    // "Client Closed" lives in the ADMIN section of the EOD form (not in
    // either of the Intro / Demo Call Metrics sections), so we extract from
    // the full `text` rather than `demoText`. This replaces the previous
    // "Deals Closed" field, which the team no longer uses.
    dealsClosed: parseNum(extractField(text, 'Client Closed')),
    cashCollected: parseNum(extractField(demoText, 'Total Cash Collected')),
    revenueGenerated: parseNum(extractField(text, 'Revenue Generated')),
    feedback: extractFeedback(text),
    newCalls: parseNum(extractField(text, 'New Calls')),
    followUpCalls: parseNum(extractField(text, 'Follow Up Calls')),
    rawMessage: text,
    slackTs: msg.ts ?? '',
  };
}
