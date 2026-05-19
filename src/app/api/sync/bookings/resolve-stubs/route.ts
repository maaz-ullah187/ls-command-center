// Backfill: resolve existing cal-* stub leads by live-searching GHL.
// For each cal-* row in t01_leads, query GHL (phone → email → name).
// If a real contact is found:
//   1. Upsert the real contact into t01_leads with full attribution
//   2. Rewrite t03_bookings.lead_id from stub → real id
//   3. Delete the stub row from t01_leads
// If not found, leave the stub alone (likely test data or truly untrackable).

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import { tieredSearchGHLContact, mapGHLContactToLeadRow } from '@/lib/mappers/ghl';

export const maxDuration = 300;

export async function POST() {
  const result = await runSync('bookings-resolve-stubs', async (sb) => {
    const token = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    if (!token || !locationId) throw new Error('GHL_API_KEY or GHL_LOCATION_ID not set');

    // Pull every cal-* stub
    const { data: stubs, error: stubErr } = await sb
      .from('t01_leads')
      .select('id, name, email, phone')
      .like('id', 'cal-%');
    if (stubErr) throw stubErr;

    let resolved = 0;
    let unresolved = 0;
    const resolvedExamples: Array<{ stubId: string; realId: string; name: string }> = [];

    for (const stub of stubs ?? []) {
      const ghlContact = await tieredSearchGHLContact(token, locationId, {
        phone: stub.phone,
        email: stub.email,
        name: stub.name,
      });

      if (!ghlContact) {
        unresolved++;
        continue;
      }

      const leadRow = mapGHLContactToLeadRow(ghlContact, locationId);
      if (!leadRow) {
        // GHL contact exists but fails junk filter — skip
        unresolved++;
        continue;
      }

      // 1. Upsert the real GHL contact
      const { error: upErr } = await sb
        .from('t01_leads')
        .upsert(leadRow, { onConflict: 'id' });
      if (upErr) {
        console.warn(`[resolve-stubs] upsert failed for ${leadRow.id}:`, upErr.message);
        unresolved++;
        continue;
      }

      // 2. Rewrite all t03_bookings.lead_id that point at the stub
      const { error: bookingErr } = await sb
        .from('t03_bookings')
        .update({ lead_id: leadRow.id, contact_link: leadRow.contact_link })
        .eq('lead_id', stub.id);
      if (bookingErr) {
        console.warn(`[resolve-stubs] booking update failed for stub ${stub.id}:`, bookingErr.message);
        unresolved++;
        continue;
      }

      // 3. Delete the stub (only after bookings have been repointed)
      const { error: delErr } = await sb
        .from('t01_leads')
        .delete()
        .eq('id', stub.id);
      if (delErr) {
        console.warn(`[resolve-stubs] stub delete failed for ${stub.id}:`, delErr.message);
      }

      resolved++;
      if (resolvedExamples.length < 10) {
        resolvedExamples.push({ stubId: stub.id, realId: leadRow.id, name: leadRow.name });
      }
    }

    console.log(`[resolve-stubs] resolved ${resolved}, unresolved ${unresolved} (of ${stubs?.length ?? 0} stubs)`);
    return {
      rowsUpserted: resolved,
      rowsSkipped: unresolved,
    };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
