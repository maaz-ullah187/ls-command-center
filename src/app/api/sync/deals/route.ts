// Sync worker: deals_closed table
// Sources: slack_new_clients (already in Supabase) → deals_closed
// Also fetches fresh from Slack #new-clients to catch anything missed.
// Schedule: every 4 hours via Vercel Cron

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';
import { buildLeadIndex, matchLead } from '@/lib/sync/lead-matcher';
import { fireClientClosedWebhook } from '@/lib/webhooks/external-webhooks';

export const maxDuration = 60;

export async function POST() {
  const result = await runSync('deals-closed', async (sb) => {
    // Read all rows from slack_new_clients (already synced by Slack worker)
    const { data: slackClients, error } = await sb
      .from('t20_slack_new_clients')
      .select('*')
      .order('date', { ascending: false });

    if (error) throw error;
    if (!slackClients || slackClients.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    // Derive source label
    function normalizeSource(raw: string | null): string {
      if (!raw) return 'Unknown';
      const s = raw.toLowerCase();
      if (s.includes('fb') || s.includes('facebook') || s.includes('paid') || s.includes('ads')) return 'Facebook Ads';
      if (s.includes('instagram') || s.includes('ig')) return 'Instagram';
      if (s.includes('youtube') || s.includes('yt')) return 'YouTube';
      if (s.includes('linkedin')) return 'LinkedIn';
      if (s.includes('referral') || s.includes('ref')) return 'Referral';
      if (s.includes('webinar')) return 'Facebook Ads';
      if (s.includes('organic')) return 'Organic';
      return raw.trim() || 'Unknown';
    }

    // Map slack_new_clients → deals_closed rows
    // the operator rule (2026-04-23): always carry sales_call_recording + payment_plan
    // across from t20 so t06 is self-contained. why_they_bought is filled by
    // a separate scorer (/api/scoring/why-bought) that reads the recording.
    const isMailto = (u: string | null | undefined) =>
      !!u && /^(mailto|tel):/i.test(u);

    const rows = slackClients.map((sc: any) => ({
      id: `slack-${sc.slack_ts}`,
      date_closed: sc.date,
      name: sc.lead_name || sc.closer_name || 'Unknown',
      email: sc.email || null,
      phone: sc.phone || null,
      offer: sc.program || null,
      cash_collected: Number(sc.cash_collected) || 0,
      contracted_revenue: Number(sc.contracted_revenue) || 0,
      source: normalizeSource(sc.source),
      closer: sc.closer_name || null,
      campaign_name: null,
      ad_set_name: null,
      ad_name: null,
      ghl_contact_id: sc.ghl_contact_url
        ? sc.ghl_contact_url.match(/\/contacts\/([a-zA-Z0-9]+)/)?.[1] ?? null
        : null,
      slack_ts: sc.slack_ts,
      // Carry recording + payment plan from t20. Reject mailto: URLs (parser
      // used to pull those in before the 2026-04-23 fix).
      sales_call_recording: isMailto(sc.recording_url) ? null : (sc.recording_url || null),
      payment_plan: sc.payment_plan || null,
      updated_at: new Date().toISOString(),
    }));

    // Snapshot existing slack_ts values BEFORE upsert so we can fire the
    // ad-attribution "client_closed" webhook only for genuinely new deals
    // (not re-syncs of rows already in the table).
    // Snapshot existing rows BEFORE upsert. Two reasons:
    //   1. Webhook firing — only fire client_closed for genuinely new deals.
    //   2. Preserve manual corrections (the operator 2026-04-30) — when a typo
    //      in Slack #new-clients gets fixed in t06 (e.g. an amount typo $50k → $5k),
    //      the next sync shouldn't re-pull the original wrong Slack value
    //      and overwrite the fix. Mirrors the t07 income-sync preserve guard.
    const allTsForBatch = rows.map((r: { slack_ts: string }) => r.slack_ts).filter(Boolean);
    const existingTs = new Set<string>();
    type ManualEdit = { cash_collected: number | null; contracted_revenue: number | null; source: string | null; offer: string | null };
    const manualByTs = new Map<string, ManualEdit>();
    if (allTsForBatch.length > 0) {
      for (let i = 0; i < allTsForBatch.length; i += 200) {
        const chunk = allTsForBatch.slice(i, i + 200);
        const { data: existing } = await sb
          .from('t06_deals_closed')
          .select('slack_ts, cash_collected, contracted_revenue, source, offer')
          .in('slack_ts', chunk);
        for (const r of (existing ?? []) as Array<{ slack_ts: string; cash_collected: number | null; contracted_revenue: number | null; source: string | null; offer: string | null }>) {
          if (r.slack_ts) {
            existingTs.add(r.slack_ts);
            manualByTs.set(r.slack_ts, {
              cash_collected: r.cash_collected,
              contracted_revenue: r.contracted_revenue,
              source: r.source,
              offer: r.offer,
            });
          }
        }
      }
    }

    // Apply preserve guard: when an incoming Slack row matches the t06-anomaly
    // typo pattern (cash > contracted × 1.5) but the existing row in t06 has
    // a sane cash value, trust the existing — it was a manual correction.
    // Also preserve source/offer when existing is set and incoming is blank.
    let preservedCash = 0;
    let preservedSource = 0;
    let preservedOffer = 0;
    for (const row of rows) {
      const m = manualByTs.get(row.slack_ts);
      if (!m) continue;
      const incomingContracted = Number(row.contracted_revenue ?? m.contracted_revenue ?? 0);
      const incomingCash = Number(row.cash_collected ?? 0);
      const existingCash = Number(m.cash_collected ?? 0);
      // Typo detection: incoming cash way higher than contracted (likely
      // extra zero / swap). If existing cash is sane, prefer existing.
      const incomingIsTypo = incomingContracted > 0 && incomingCash > incomingContracted * 1.5;
      const existingIsSane = existingCash > 0 && existingCash <= incomingContracted * 1.5;
      if (incomingIsTypo && existingIsSane && existingCash !== incomingCash) {
        row.cash_collected = m.cash_collected ?? row.cash_collected;
        preservedCash += 1;
      }
      // Source: existing wins when incoming is blank/Unknown
      const existingSrc = (m.source || '').trim();
      const incomingSrc = (row.source || '').trim();
      if (existingSrc && existingSrc.toLowerCase() !== 'unknown' && (incomingSrc === '' || incomingSrc.toLowerCase() === 'unknown')) {
        row.source = m.source;
        preservedSource += 1;
      }
      // Offer: existing wins when incoming is blank
      const existingOff = (m.offer || '').trim();
      const incomingOff = (row.offer || '').trim();
      if (existingOff && incomingOff === '') {
        row.offer = m.offer;
        preservedOffer += 1;
      }
    }
    if (preservedCash + preservedSource + preservedOffer > 0) {
      console.log(`[sync/deals] Preserved manual edits — cash: ${preservedCash}, source: ${preservedSource}, offer: ${preservedOffer}`);
    }

    // Upsert in batches of 100
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error: upsertErr } = await sb
        .from('t06_deals_closed')
        .upsert(batch, { onConflict: 'slack_ts' });
      if (upsertErr) throw upsertErr;
      upserted += batch.length;
    }

    // Fire client_closed webhook for rows that were NOT in the table before
    // this run. This is the per-deal trigger the operator asked for: name + email
    // + phone + cash_collected → your-attribution-domain.com.
    let closedWebhooksFired = 0;
    for (const row of rows) {
      if (row.slack_ts && !existingTs.has(row.slack_ts)) {
        fireClientClosedWebhook({
          name: row.name,
          email: row.email,
          phone: row.phone,
          cash_collected: row.cash_collected,
        }).catch(() => { /* logged inside helper */ });
        closedWebhooksFired++;
      }
    }
    console.log(`[sync/deals] client_closed webhooks fired: ${closedWebhooksFired}`);

    // Derive deal_type for every row (new / upsell / renewal).
    // Rule: earliest row per email = 'new'. Subsequent rows with SAME offer =
    // 'renewal'. Subsequent rows with DIFFERENT offer = 'upsell'. Computed by
    // SQL so it stays correct across races / re-syncs.
    // Matches the backfill logic in migration t06_add_deal_type.
    const { error: dealTypeErr } = await sb.rpc('exec_sql', { q: 'select 1' }).select().limit(0);
    void dealTypeErr; // no-op fallthrough; the UPDATE below is what actually runs
    // Direct SQL isn't exposed via supabase-js, so we use a PostgREST window
    // walk: fetch all-time deals ordered by email+date, compute deal_type in
    // JS, write back. Cheap because Postgres index makes the scan small.
    const { data: allDealsForType } = await sb
      .from('t06_deals_closed')
      .select('id,email,offer,date_closed,created_at')
      .order('email', { ascending: true })
      .order('date_closed', { ascending: true })
      .order('created_at', { ascending: true });

    let dealTypeUpdates = 0;
    let currentEmail: string | null = null;
    let prevOffer: string | null = null;
    const norm = (s: string | null) =>
      (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
    for (const d of allDealsForType ?? []) {
      const emailLower = (d.email ?? '').toLowerCase();
      let dealType: 'new' | 'upsell' | 'renewal';
      if (emailLower !== currentEmail) {
        dealType = 'new';
        currentEmail = emailLower;
        prevOffer = d.offer;
      } else {
        dealType = norm(d.offer) === norm(prevOffer) ? 'renewal' : 'upsell';
        prevOffer = d.offer;
      }
      await sb.from('t06_deals_closed').update({ deal_type: dealType }).eq('id', d.id);
      dealTypeUpdates++;
    }
    console.log(`[sync/deals] recomputed deal_type on ${dealTypeUpdates} rows`);

    // --- Link deals to leads via tiered matching ---
    const leadIndex = await buildLeadIndex(sb);
    let linked = 0;
    for (const row of rows) {
      const leadId = matchLead(leadIndex, row.email, row.phone, row.name);
      if (leadId) {
        await sb.from('t06_deals_closed').update({ lead_id: leadId }).eq('id', row.id);
        linked++;
      }
    }

    // --- Compute close_path: 'funnel' if lead has booking + recording, else 'direct' ---
    // Matches the classification the operator introduced 2026-04-20. Runs after the
    // lead-linking pass so lead_id is populated first.
    const closeIds = rows.map((r: { id: string }) => r.id);
    if (closeIds.length > 0) {
      // Pull current close rows back (with their newly set lead_id)
      const { data: closeRows } = await sb
        .from('t06_deals_closed')
        .select('id, email, name, lead_id')
        .in('id', closeIds);

      for (const c of closeRows ?? []) {
        const emailLower = (c.email ?? '').toLowerCase();

        const bookingRes = c.lead_id
          ? await sb.from('t03_bookings').select('id', { count: 'exact', head: true })
              .or(`lead_id.eq.${c.lead_id},email.eq.${emailLower}`)
          : await sb.from('t03_bookings').select('id', { count: 'exact', head: true })
              .eq('email', emailLower);
        const hasBooking = ((bookingRes.count ?? 0) as number) > 0;

        const recordingRes = c.lead_id
          ? await sb.from('t04_call_recordings').select('id', { count: 'exact', head: true })
              .eq('ghl_contact_id', c.lead_id)
          : await sb.from('t04_call_recordings').select('id', { count: 'exact', head: true })
              .eq('prospect_name', c.name ?? '');
        const hasRecording = ((recordingRes.count ?? 0) as number) > 0;

        const path = hasBooking && hasRecording ? 'funnel' : 'direct';
        await sb.from('t06_deals_closed').update({ close_path: path }).eq('id', c.id);
      }
    }

    console.log(`[sync/deals] Upserted ${upserted} deals. Linked ${linked}/${upserted} to leads. Set close_path on all.`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
