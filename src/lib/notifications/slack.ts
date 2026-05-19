/**
 * Send alerts to Slack when integrations break or data anomalies are detected.
 */

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

// Use an existing channel or create a new #dashboard-alerts channel
// For now, we'll send to #sales-rep-eods as it's the team's main operational channel
const DEFAULT_CHANNEL = process.env.SLACK_CHANNEL_EODS || '';

export async function sendSlackAlert(
  message: string,
  channel?: string,
): Promise<boolean> {
  const token = SLACK_TOKEN;
  const targetChannel = channel || DEFAULT_CHANNEL;

  if (!token || !targetChannel) {
    console.warn('[slack-alert] Missing SLACK_BOT_TOKEN or channel ID');
    return false;
  }

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: targetChannel,
        text: message,
        unfurl_links: false,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('[slack-alert] Failed:', data.error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[slack-alert] Error:', e);
    return false;
  }
}

export function formatIntegrationAlert(broken: { name: string; message: string }[]): string {
  if (broken.length === 0) return '';
  const lines = broken.map(b => `• *${b.name}*: ${b.message}`).join('\n');
  return `:warning: *Dashboard Integration Alert*\n${broken.length} integration(s) need attention:\n${lines}\n\nFix at: http://localhost:3000 → Integrations`;
}

export function formatAnomalyAlert(count: number): string {
  if (count === 0) return '';
  return `:rotating_light: *Data Anomaly Alert*\n${count} data anomalies detected in the Daily Review Queue.\n\nReview at: http://localhost:3000 → Dashboard → Daily Review Queue`;
}
