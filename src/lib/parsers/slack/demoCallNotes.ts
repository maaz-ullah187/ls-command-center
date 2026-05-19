// Slack → #demo-call-notes message parser
//
// Parses structured "Demo Call Notes" messages from the #demo-call-notes channel.
// Messages contain structured fields like:
//   Submitted By: Closer Two
//   Lead Email: lead@example.com
//   Next Status: :thumbsdown:Call No Show
//   Cash Collected: $0.00
//   Call Type: New Call / Follow Up Call
//
// Next Status values observed:
//   "Long Term Follow Up", "Short Term Follow Up", "Call No Show",
//   "Rescheduling", "Closed - ProgB ($18k)", "Call Cancelled",
//   "Not financially qualified", "Bad fit"

export interface DemoCallNote {
  slackTs: string;
  date: string;              // YYYY-MM-DD from Slack ts
  submittedBy: string | null;
  leadEmail: string | null;
  nextStatus: string | null; // raw Next Status value
  callType: string | null;   // "New Call" or "Follow Up Call"
  cashCollected: number;
  rawMessage: string;
}

/** Booking status derived from the Slack "Next Status" field. */
export type SlackDerivedStatus = 'Showed' | 'No Showed' | 'Cancelled' | 'Rescheduled' | null;

/**
 * Map a Slack "Next Status" to a booking status (canonical vocabulary:
 * Showed / No Showed / Cancelled / Rescheduled / Needs Review).
 * - "Call No Show" → 'No Showed'
 * - "Call Cancelled" → 'Cancelled'
 * - "Rescheduling" → 'Rescheduled' (they didn't attend THIS booking)
 * - Everything else (Closed, Follow Up, Bad fit, etc.) → 'Showed' (they showed up)
 */
export function deriveStatusFromSlack(nextStatus: string | null): SlackDerivedStatus {
  if (!nextStatus) return null;
  const lower = nextStatus.toLowerCase().trim();

  if (lower.includes('no show') || lower.includes('no-show')) return 'No Showed';
  if (lower.includes('cancelled') || lower.includes('canceled')) return 'Cancelled';
  if (lower.includes('rescheduling') || lower.includes('reschedule')) return 'Rescheduled';

  // Any other status means they showed: Closed, Follow Up, Bad fit, Not financially qualified, etc.
  return 'Showed';
}

interface SlackMessage {
  text?: string;
  ts?: string;
  blocks?: any[];
}

/** Strip Slack emoji codes like :thumbsdown:, :-1:, :white_check_mark:, etc. */
function stripEmoji(text: string): string {
  return text.replace(/:[a-z0-9_+-]+:/g, '').trim();
}

/** Extract a field value from structured text. Case-insensitive label match. */
function extractField(text: string, label: string): string | null {
  // Match "Label: value" or "Label : value" across lines
  const re = new RegExp(`${label}\\s*:\\s*(.+?)(?:\\n|$)`, 'i');
  const match = text.match(re);
  if (!match) return null;
  return stripEmoji(match[1]).trim() || null;
}

/** Parse a dollar amount like "$18,000.00" or "$0.00" to a number. */
function parseDollar(value: string | null): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse a #demo-call-notes Slack message into structured data.
 * Returns null if the message doesn't look like a demo call note.
 */
export function parseDemoCallNote(msg: SlackMessage): DemoCallNote | null {
  // Get text from blocks or fallback to msg.text
  let text = '';
  if (msg.blocks?.length) {
    for (const block of msg.blocks) {
      if (block.type === 'section' && block.text?.text) {
        text += block.text.text + '\n';
      }
      if (block.type === 'rich_text' && block.elements) {
        for (const el of block.elements) {
          if (el.elements) {
            for (const inner of el.elements as any[]) {
              if (inner.text) text += inner.text;
            }
            text += '\n';
          }
        }
      }
    }
  }
  if (!text) text = msg.text ?? '';
  if (!text) return null;

  // Must have at least a "Lead Email" or "Next Status" field to be a demo call note
  const leadEmail = extractField(text, 'Lead Email');
  const nextStatus = extractField(text, 'Next Status');

  if (!leadEmail && !nextStatus) return null;

  const ts = msg.ts ?? '';
  const date = ts ? new Date(parseFloat(ts) * 1000).toISOString().slice(0, 10) : '';

  return {
    slackTs: ts,
    date,
    submittedBy: extractField(text, 'Submitted By'),
    leadEmail: leadEmail?.toLowerCase().trim() ?? null,
    nextStatus,
    callType: extractField(text, 'Call Type'),
    cashCollected: parseDollar(extractField(text, 'Cash Collected')),
    rawMessage: text.slice(0, 2000),
  };
}
