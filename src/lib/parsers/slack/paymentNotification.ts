/**
 * Parser for "PAYMENT NOTIS" messages from the #payment-notifications Slack channel.
 *
 * Real message format (inside section block text):
 *
 *   *PAYMENT NOTIS - :white_check_mark: *
 *
 *   Action - payment.succeeded
 *   Full Name - Jane Doe
 *   Email - jane@example.com
 *   Amount - 4500
 *
 * Failures include an extra Reason field:
 *
 *   Action - payment.failed
 *   ...
 *   Reason - 1
 *
 * Fields use " - " (space-dash-space) as the separator.
 * Slack wraps emails as <mailto:email|email> — we strip that.
 */

export interface PaymentNotificationData {
  action: 'succeeded' | 'failed' | 'refunded' | 'chargedback';
  fullName: string;
  email: string;
  amount: number;
  reason: string;
  slackTs: string;
  /** YYYY-MM-DD derived from the Slack message timestamp */
  date: string;
}

// Slack message types (minimal subset we need)
interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; elements?: Array<{ type: string; text?: string }> }>;
}

interface SlackMessage {
  ts: string;
  text?: string;
  blocks?: SlackBlock[];
}

/**
 * Extract the plain-text body from a Slack message's blocks.
 * Checks section blocks first, then rich_text blocks.
 */
function extractBlockText(msg: SlackMessage): string {
  if (!msg.blocks?.length) return msg.text ?? '';

  // Try section blocks
  for (const block of msg.blocks) {
    if (block.type === 'section' && block.text?.text) {
      return block.text.text;
    }
  }

  // Try rich_text blocks
  for (const block of msg.blocks) {
    if (block.type === 'rich_text' && block.elements?.length) {
      const parts: string[] = [];
      for (const section of block.elements) {
        if (section.elements) {
          for (const el of section.elements) {
            if (el.text) parts.push(el.text);
          }
        }
      }
      if (parts.length) return parts.join('');
    }
  }

  return msg.text ?? '';
}

/**
 * Strip Slack's mailto formatting: `<mailto:foo@bar.com|foo@bar.com>` → `foo@bar.com`
 */
function stripMailto(raw: string): string {
  const match = raw.match(/<mailto:[^|]+\|([^>]+)>/);
  return match ? match[1] : raw.replace(/<|>/g, '');
}

/**
 * Convert a Slack timestamp (e.g. "1712678400.123456") to YYYY-MM-DD.
 */
function slackTsToDate(ts: string): string {
  const epochSeconds = parseFloat(ts);
  const d = new Date(epochSeconds * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a single field line using " - " as separator.
 * Returns [key, value] or null if no separator found.
 */
function parseField(line: string): [string, string] | null {
  const idx = line.indexOf(' - ');
  if (idx === -1) return null;
  return [line.slice(0, idx).trim(), line.slice(idx + 3).trim()];
}

/**
 * Parse a Slack message from #payment-notifications into structured data.
 * Returns null if the message is not a PAYMENT NOTIS message or lacks required fields.
 */
export function parsePaymentNotification(
  msg: SlackMessage
): PaymentNotificationData | null {
  // Gate: only match PAYMENT NOTIS messages
  if (!msg.text?.includes('PAYMENT NOTIS')) return null;

  const body = extractBlockText(msg);
  if (!body) return null;

  const lines = body.split('\n');

  const fields: Record<string, string> = {};
  for (const line of lines) {
    const parsed = parseField(line);
    if (parsed) {
      // Normalise key to lowercase for flexible matching
      fields[parsed[0].toLowerCase()] = parsed[1];
    }
  }

  const rawAction = (fields['action'] ?? '').toLowerCase();
  // the operator 2026-04-25: extended to capture refund + chargeback events
  // (previously dropped, leaving t07 with zero refunds despite real refunds happening).
  let actionType: PaymentNotificationData['action'] | null = null;
  if (rawAction.includes('refund'))                            actionType = 'refunded';
  else if (rawAction.includes('chargeback') || rawAction.includes('disput')) actionType = 'chargedback';
  else if (rawAction.includes('failed'))                        actionType = 'failed';
  else if (rawAction.includes('succeeded'))                     actionType = 'succeeded';
  if (!actionType) return null;

  const fullName = fields['full name'] ?? '';
  const rawEmail = fields['email'] ?? '';
  const rawAmount = fields['amount'] ?? '';

  if (!fullName || !rawEmail) return null;

  const email = stripMailto(rawEmail);
  const amount = parseFloat(rawAmount) || 0;
  const reason = fields['reason'] ?? '';

  return {
    action: actionType,
    fullName,
    email,
    amount,
    reason,
    slackTs: msg.ts,
    date: slackTsToDate(msg.ts),
  };
}
