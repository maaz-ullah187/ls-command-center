/**
 * Parser for "New Client Signed" messages from the #new-clients Slack channel.
 *
 * These are rich-text block messages with the "Pew Pew" emoji header and
 * structured key-value fields (CLOSER, Program, Name, Email, etc.).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewClientData {
  closerName: string;
  program: string;
  leadName: string;
  email: string;
  phone: string;
  source: string;
  paymentStructure: string;
  cashCollected: number;
  contractedRevenue: number;
  paymentPlan: string;
  recordingUrl: string | null;
  ghlContactUrl: string | null;
  keyPoints: string | null;
  slackTs: string;
  /** YYYY-MM-DD derived from Slack message ts (Unix epoch seconds) */
  date: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Slack ts ("1712678400.123456") to "YYYY-MM-DD". */
function tsToDate(ts: string): string {
  const epoch = parseFloat(ts) * 1000;
  const d = new Date(epoch);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Strip leading "mailto:" or "tel:" from a value. */
function stripProtocol(value: string): string {
  return value.replace(/^mailto:/i, '').replace(/^tel:/i, '').trim();
}

/**
 * Walk a Slack block-kit element tree and collect all plain-text content.
 * Handles section blocks, rich_text blocks, and their nested elements.
 */
function extractTextFromBlocks(blocks: any[]): string {
  const parts: string[] = [];

  function walk(node: any): void {
    if (!node) return;

    // Leaf text elements
    if (node.type === 'text' || node.type === 'plain_text') {
      if (node.text) parts.push(node.text);
      return;
    }
    if (node.type === 'mrkdwn' && node.text) {
      parts.push(node.text);
      return;
    }
    if (node.type === 'link' && node.url) {
      parts.push(node.url);
      return;
    }
    if (node.type === 'emoji' && node.name) {
      // Skip emojis — they don't carry structured data
      return;
    }

    // Container types — recurse
    if (node.text && typeof node.text === 'object') {
      walk(node.text);
    }
    if (Array.isArray(node.elements)) {
      for (const el of node.elements) walk(el);
    }
    if (Array.isArray(node.fields)) {
      for (const f of node.fields) walk(f);
    }
    if (node.accessory) walk(node.accessory);
  }

  for (const block of blocks) walk(block);
  return parts.join('\n');
}

/**
 * Walk blocks and collect every URL found in link elements or mrkdwn text.
 */
function extractUrlsFromBlocks(blocks: any[]): string[] {
  const urls: string[] = [];

  function walk(node: any): void {
    if (!node) return;

    if (node.type === 'link' && node.url) {
      urls.push(node.url);
    }

    // mrkdwn may contain <url|label> links
    if ((node.type === 'mrkdwn' || node.type === 'text') && typeof node.text === 'string') {
      const re = /<(https?:\/\/[^|>]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(node.text)) !== null) {
        urls.push(m[1]);
      }
    }

    if (node.text && typeof node.text === 'object') walk(node.text);
    if (Array.isArray(node.elements)) for (const el of node.elements) walk(el);
    if (Array.isArray(node.fields)) for (const f of node.fields) walk(f);
    if (node.accessory) walk(node.accessory);
  }

  for (const block of blocks) walk(block);
  return urls;
}

/**
 * Parse a field value from the extracted text.
 * Looks for `label:\n value` or `label: value` patterns.
 */
function fieldValue(text: string, label: string): string {
  // Try "LABEL:\n value" first (common in the real messages)
  const re = new RegExp(`${label}:\\s*\\n\\s*(.+)`, 'i');
  const m = text.match(re);
  if (m) return m[1].trim();

  // Fallback: "LABEL: value" on same line
  const re2 = new RegExp(`${label}:\\s*(.+)`, 'i');
  const m2 = text.match(re2);
  if (m2) return m2[1].trim();

  return '';
}

/**
 * Extract the SALES CALL KEY POINTS section (everything after the header
 * until the next known section or end of text).
 */
function extractKeyPoints(text: string): string | null {
  const startRe = /SALES CALL KEY POINTS\s*\n/i;
  const startMatch = startRe.exec(text);
  if (!startMatch) return null;

  const afterHeader = text.slice(startMatch.index + startMatch[0].length);

  // End at "Direct Link To Contact" or end of text
  const endRe = /Direct Link To Contact/i;
  const endMatch = endRe.exec(afterHeader);
  const raw = endMatch ? afterHeader.slice(0, endMatch.index) : afterHeader;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a Slack message from the #new-clients channel into structured
 * NewClientData. Returns null if the message doesn't match the expected
 * "New Client Signed" / "Pew Pew" format.
 */
export function parseNewClient(msg: {
  ts: string;
  text?: string;
  blocks?: any[];
}): NewClientData | null {
  // Gate: only process "New Client Signed" messages
  const rawText = msg.text ?? '';
  if (
    !rawText.includes('New Client Signed') &&
    !rawText.includes('Pew Pew')
  ) {
    return null;
  }

  // Extract full text from blocks (richer than msg.text)
  const blockText = msg.blocks?.length
    ? extractTextFromBlocks(msg.blocks)
    : rawText;

  // Use block text for field extraction, fall back to rawText
  // Strip Slack bold formatting (* around values) to improve field parsing
  const text = (blockText || rawText).replace(/\*/g, '');

  // Extract all URLs from block elements
  const urls = msg.blocks?.length ? extractUrlsFromBlocks(msg.blocks) : [];

  // Also pull URLs from the raw text / block text
  const urlRe = /https?:\/\/[^\s>]+/g;
  let um: RegExpExecArray | null;
  while ((um = urlRe.exec(text)) !== null) {
    if (!urls.includes(um[0])) urls.push(um[0]);
  }
  while ((um = urlRe.exec(rawText)) !== null) {
    if (!urls.includes(um[0])) urls.push(um[0]);
  }

  // Field extraction — strip emoji shortcodes from values
  const stripEmoji = (s: string) => s.replace(/:[a-z_]+:/g, '').trim();
  const closerName = stripEmoji(fieldValue(text, 'CLOSER'));
  const program = fieldValue(text, 'Program');
  const leadName = fieldValue(text, 'Name');
  const emailRaw = fieldValue(text, 'Email');
  const phoneRaw = fieldValue(text, 'Phone');
  const source = fieldValue(text, 'Source');
  const paymentStructure = fieldValue(text, 'Payment Structure');
  const cashCollectedStr = fieldValue(text, 'Cash Collected');
  const contractedRevenueStr = fieldValue(text, 'Contracted Revenue');
  const paymentPlan = fieldValue(text, 'Payment Plan');

  // Clean email & phone
  const email = stripProtocol(emailRaw);
  const phone = stripProtocol(phoneRaw);

  // Parse numbers — strip $, commas, whitespace
  const cashCollected = parseFloat(cashCollectedStr.replace(/[$,\s]/g, '')) || 0;
  const contractedRevenue = parseFloat(contractedRevenueStr.replace(/[$,\s]/g, '')) || 0;

  // Recording URL — prefer Grain / Fathom / Zoom / Google Drive URLs.
  // Prior bug: `.find(u => !u.includes('gohighlevel.com'))` picked up the
  // `mailto:` email link that appears before the recording in block order.
  const ghlContactUrl =
    urls.find((u) => u.includes('gohighlevel.com')) ?? null;

  const isLikelyRecording = (u: string) =>
    /grain\.com|fathom\.video|fathom\.ai|zoom\.us\/rec|drive\.google\.com|loom\.com|vimeo\.com|otter\.ai|riverside\.fm|tldv\.io|read\.ai/i.test(u);

  // Primary: a known recording host. Fallback: any http(s) URL that isn't
  // GHL, isn't mailto/tel, and isn't the email itself. Never return a mailto/tel.
  const recordingUrl =
    urls.find(isLikelyRecording) ??
    urls.find(
      (u) =>
        /^https?:\/\//i.test(u) &&
        !u.includes('gohighlevel.com') &&
        !/^mailto:|^tel:/i.test(u)
    ) ??
    null;

  // Key points
  const keyPoints = extractKeyPoints(text);

  // Date from Slack ts
  const date = tsToDate(msg.ts);

  return {
    closerName,
    program,
    leadName,
    email,
    phone,
    source,
    paymentStructure,
    cashCollected,
    contractedRevenue,
    paymentPlan,
    recordingUrl,
    ghlContactUrl,
    keyPoints,
    slackTs: msg.ts,
    date,
  };
}
