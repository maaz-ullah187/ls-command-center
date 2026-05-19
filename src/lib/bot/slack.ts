// Minimal Slack Web API helpers + Events API signature verification.
// No external dependencies — just fetch + Node crypto.

import 'server-only';
import crypto from 'crypto';

const SLACK_API = 'https://slack.com/api';

function requireToken(): string {
  // Prefer the dedicated ops bot token if set; fall back to the generic
  // SLACK_BOT_TOKEN so existing Slack-sync flows (which already use the old
  // token) continue to work without change.
  const t = process.env.SLACK_OPS_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error('Neither SLACK_OPS_BOT_TOKEN nor SLACK_BOT_TOKEN set');
  return t;
}

export async function postMessage(opts: {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: unknown[];
  unfurl_links?: boolean;
}): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ unfurl_links: false, unfurl_media: false, ...opts }),
  });
  const data = await res.json();
  return { ok: !!data.ok, ts: data.ts, error: data.error };
}

export async function addReaction(opts: {
  channel: string;
  timestamp: string;
  name: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${SLACK_API}/reactions.add`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireToken()}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  return { ok: !!data.ok, error: data.error };
}

/**
 * Verify Slack Events API request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  const secret = process.env.SLACK_OPS_SIGNING_SECRET || process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  // Reject requests older than 5 min (replay protection)
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret).update(base).digest('hex');
  const computed = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Strip the bot's own @mention from incoming text. */
export function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}
