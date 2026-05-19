import { NextResponse } from 'next/server';
import { sendSlackAlert, formatIntegrationAlert } from '@/lib/notifications/slack';

export const maxDuration = 30;

// Track previous state to only alert on transitions (ok → broken)
let lastBrokenSet = new Set<string>();

export async function POST() {
  try {
    // Fetch current integration status
    const statusRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/integrations/status`,
      { cache: 'no-store' }
    );
    if (!statusRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
    }

    const status = await statusRes.json();
    const integrations = status.integrations || {};

    // Find broken integrations
    const broken: { name: string; message: string }[] = [];
    for (const [name, info] of Object.entries(integrations)) {
      const s = info as { configured?: boolean; ok?: boolean; message?: string };
      if (s.configured && !s.ok) {
        broken.push({ name, message: s.message || 'Unknown error' });
      }
    }

    const currentBrokenSet = new Set(broken.map(b => b.name));

    // Only alert on NEW breakages (not already broken ones we've alerted about)
    const newlyBroken = broken.filter(b => !lastBrokenSet.has(b.name));
    lastBrokenSet = currentBrokenSet;

    let slackSent = false;
    if (newlyBroken.length > 0) {
      const message = formatIntegrationAlert(newlyBroken);
      slackSent = await sendSlackAlert(message);
    }

    return NextResponse.json({
      checked: Object.keys(integrations).length,
      broken: broken.length,
      newlyBroken: newlyBroken.length,
      slackSent,
    });
  } catch (e) {
    console.error('[integration-check] Error:', e);
    return NextResponse.json({ error: 'Check failed' }, { status: 500 });
  }
}

// Also support GET for manual testing
export async function GET() {
  return POST();
}
