// Sync worker: t18_manychat_leads table
// Source: ManyChat API — Instagram DM keyword funnel subscribers
// Schedule: daily via Vercel Cron
// GHL cross-reference happens at read time in dataSources.ts (not stored here)

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 120;

export async function POST() {
  const result = await runSync('manychat-leads', async (sb) => {
    const manychatKey = process.env.MANYCHAT_API_KEY;
    if (!manychatKey) throw new Error('MANYCHAT_API_KEY not set');

    const { fetchAllManyChatLeads } = await import('@/lib/mappers/manychat');
    // Pass empty leads — GHL cross-reference handled at read time
    const summary = await fetchAllManyChatLeads(manychatKey, []);

    if (summary.leads.length === 0) return { rowsUpserted: 0, rowsSkipped: 0 };

    const rows = summary.leads.map(lead => ({
      id: lead.id,
      name: lead.name,
      ig_username: lead.igUsername || null,
      profile_pic: lead.profilePic || null,
      email: lead.email || null,
      stage: lead.stage || null,
      optin_keyword: lead.optinKeyword || null,
      setter: lead.setter || null,
      subscribed_at: lead.subscribedAt || null,
      last_interaction: lead.lastInteraction || null,
      last_message: lead.lastMessage || null,
      chat_link: lead.chatLink || null,
      trigger_source: lead.triggerSource || null,
      ads_type: lead.adsType || null,
      ghl_lead_id: null, // enriched at read time by dataSources.ts
      updated_at: new Date().toISOString(),
    }));

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb
        .from('t18_manychat_leads')
        .upsert(rows.slice(i, i + 100), { onConflict: 'id' });
      if (error) throw error;
      upserted += rows.slice(i, i + 100).length;
    }

    console.log(`[sync/manychat] Upserted ${upserted} ManyChat leads to t18_manychat_leads`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
