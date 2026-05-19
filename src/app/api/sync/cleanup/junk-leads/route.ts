// Scheduled junk-lead sweep.
// Runs hourly via Vercel Cron. Scans t01_leads with the shared isJunkPerson
// filter (same one used by GHL mapper + booking sync) and cascade-deletes
// any row that matches — plus orphan rows in dependent tables (bookings,
// call recordings, deals, lead scores).
//
// This is the belt-and-braces safety net: even if a new junk pattern slips
// past the ingest filters, it won't live in the DB longer than 1 hour.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import { isJunkPerson } from '@/lib/mappers/ghl';

export const maxDuration = 300;

export async function POST() {
  const result = await runSync('cleanup-junk-leads', async (sb) => {
    const { data: leads, error } = await sb
      .from('t01_leads')
      .select('id, name, email, phone');
    if (error) throw error;

    const junkIds: string[] = [];
    for (const lead of leads ?? []) {
      if (isJunkPerson({ name: lead.name, email: lead.email, phone: lead.phone })) {
        junkIds.push(lead.id);
      }
    }

    if (junkIds.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    console.log(`[cleanup-junk-leads] deleting ${junkIds.length} junk leads`);

    // Cascade through dependent tables (FKs → t01_leads.id).
    // Delete in dependency order so FK constraints don't block the parent delete.
    const { count: bookingsDel } = await sb
      .from('t03_bookings').delete({ count: 'exact' }).in('lead_id', junkIds);
    const { count: callsDel } = await sb
      .from('t04_call_recordings').delete({ count: 'exact' }).in('ghl_contact_id', junkIds);
    const { count: dealsDel } = await sb
      .from('t06_deals_closed').delete({ count: 'exact' }).in('lead_id', junkIds);
    // t10_lead_scores dropped 2026-04-23 — quality scoring lives in t04.

    const { error: leadsErr } = await sb
      .from('t01_leads').delete().in('id', junkIds);
    if (leadsErr) throw leadsErr;

    console.log(
      `[cleanup-junk-leads] deleted: ${junkIds.length} leads, ${bookingsDel ?? 0} bookings, ` +
      `${callsDel ?? 0} calls, ${dealsDel ?? 0} deals`
    );

    return {
      rowsUpserted: junkIds.length,
      rowsSkipped: 0,
    };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
