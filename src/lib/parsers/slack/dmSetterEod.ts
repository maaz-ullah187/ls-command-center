// Slack → DM Setter EOD message parser (Pillar 6 extension)
//
// Parses structured "New DM Setter EOD!" messages posted to your Slack
// EOD channel by the RepVision bot. DM-setter activity uses a distinct
// format that the closerEod parser SKIPS, so this parser handles it
// separately and writes to t05_eod_reports as `role='setter'`.
//
// Example message body:
//   New DM Setter EOD!
//   Date: May 1, 2026
//   Sales Rep: <name>
//   DMs Sent: 10
//   Appointments Set: 0
//   Follow Ups: 23
//   Conversations: 10
//   Quality Conversations: 10
//   Feedback: ...

import type { SlackMessage } from './closerEod';

export interface DmSetterEodData {
  date: string;                  // YYYY-MM-DD
  setterName: string;
  dmsSent: number;
  appointmentsSet: number;       // → calls_booked in t05
  followUps: number;
  conversations: number;
  qualityConversations: number;
  feedback: string;
  rawMessage: string;
  slackTs: string;
}

/** Parse "May 1, 2026" → "2026-05-01" */
function parseDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[*$,]/g, '').trim();
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

function extractField(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}:\\s*\\*?([^*\\n]+?)\\*?\\s*$`, 'm');
  const m = text.match(re);
  return m?.[1]?.trim();
}

function extractFeedback(text: string): string {
  // Feedback may span multiple lines until end of message.
  const m = text.match(/Feedback:\s*([\s\S]*?)$/);
  return m?.[1]?.trim() ?? '';
}

/**
 * Pull plain text from a Slack message, preferring `blocks[].text.text`
 * over `msg.text` because the latter is just the truncated preview
 * (e.g. "New DM Setter EOD! — <name>") and doesn't contain the
 * field labels we need to parse.
 */
function getMessageText(msg: SlackMessage): string {
  let blockText = '';
  if (msg.blocks) {
    for (const block of msg.blocks) {
      if (block.type === 'section' && block.text?.text) {
        blockText += block.text.text + '\n';
      }
    }
  }
  if (blockText.trim()) return blockText;
  return msg.text ?? '';
}

/**
 * Parse a Slack message and return a DmSetterEodData object — or null if
 * the message isn't a DM Setter EOD report.
 */
export function parseDmSetterEod(msg: SlackMessage): DmSetterEodData | null {
  const text = getMessageText(msg);
  if (!text) return null;

  // Header detection — distinguishes from closer EOD + other bot posts.
  if (!/New DM Setter EOD!?/i.test(text) && !/DM Setter EOD!?/i.test(text)) return null;

  const dateRaw = extractField(text, 'Date');
  const setterName = extractField(text, 'Sales Rep') ?? '';
  if (!dateRaw || !setterName) return null;

  return {
    date: parseDate(dateRaw),
    setterName,
    dmsSent: parseNum(extractField(text, 'DMs Sent')),
    appointmentsSet: parseNum(extractField(text, 'Appointments Set')),
    followUps: parseNum(extractField(text, 'Follow Ups')),
    conversations: parseNum(extractField(text, 'Conversations')),
    qualityConversations: parseNum(extractField(text, 'Quality Conversations')),
    feedback: extractFeedback(text),
    rawMessage: text,
    slackTs: msg.ts ?? '',
  };
}
