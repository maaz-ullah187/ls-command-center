// Switching layer — the single source of truth for "where does dashboard data
// come from right now?"
//
// EVERY consumer in the dashboard reads via the helpers exported from this
// file. They never import from `mock-data.ts` directly and never call
// third-party APIs (Meta, GHL, etc) directly. That contract is what lets us
// flip a single pillar from mock → live without touching consumer code.
//
// Resolution order for every getter:
//   1. If Supabase is configured AND the relevant table has rows → return live
//      data, with the `overrides` table left-joined so user edits win.
//   2. Otherwise → return the deterministic mock data.
//
// As each pillar lands its sync worker starts populating the corresponding
// Supabase table and the dashboard automatically switches to live data for
// that slice — no consumer changes required.
//
// NOTE: Pillar 0 ships this file with the mock-fallback path wired up. The
// Supabase read paths are added as each pillar's sync worker lands. Until
// then `isSupabaseConfigured()` may be true but every table is empty, in
// which case we still fall through to mock — see `firstNonEmpty` below.

import 'server-only';
import {
  mockLeads,
  mockAds,
  mockDailyMetrics,
  mockYouTubeVideos,
  mockInstagramPosts,
  mockLinkedInPosts,
  mockXPosts,
  mockClients,
  mockExpenses,
} from './mock-data';
import type {
  Lead,
  Ad,
  DailyMetrics,
  ContentPost,
  YouTubeVideo,
  Client,
  Expense,
} from './types';
import { getServerSupabaseAsync, isSupabaseConfigured } from './supabase/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the live array if it has at least one row, otherwise the fallback.
 * IMPORTANT: When `integrationConnected` is true, NEVER return mock data —
 * return empty array instead. Mock data should only appear when NO
 * integration is configured for that data source.
 */
function firstNonEmpty<T>(live: T[] | null | undefined, fallback: T[], integrationConnected = false): T[] {
  if (live && live.length > 0) return live;
  // If the integration IS connected but returned empty/null, return empty — not mock
  if (integrationConnected) return [];
  return fallback;
}

interface OverrideRow {
  table_name: string;
  row_id: string;
  field: string;
  corrected: unknown;
}

/**
 * Apply override rows to a list of records. The dashboard reads everything
 * through this so a typo'd EOD report (or any other bad source value) can be
 * corrected inline without ever being clobbered by the next sync.
 */
function applyOverrides<T extends { id: string }>(
  rows: T[],
  overrides: OverrideRow[],
  tableName: string
): T[] {
  if (overrides.length === 0) return rows;
  const byRow = new Map<string, Record<string, unknown>>();
  for (const o of overrides) {
    if (o.table_name !== tableName) continue;
    const existing = byRow.get(o.row_id) ?? {};
    existing[o.field] = o.corrected;
    byRow.set(o.row_id, existing);
  }
  return rows.map(r => {
    const patch = byRow.get(r.id);
    return patch ? { ...r, ...patch } : r;
  });
}

/**
 * Drop rows that the user has soft-removed via the dashboard. A lead is
 * "removed" when an override row exists with field='removed_at' (set by the
 * Remove button on the Unknown Source queue when a fake/junk lead is found).
 */
function filterRemoved<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((r) => !(r as any).removed_at);
}

/**
 * Fetch all overrides for a given source table. Returns [] if Supabase is not
 * configured or the table doesn't exist yet — never throws.
 */
async function fetchOverrides(tableName: string): Promise<OverrideRow[]> {
  const sb = await getServerSupabaseAsync();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('t16_overrides')
      .select('table_name,row_id,field,corrected')
      .eq('table_name', tableName);
    if (error) return [];
    return (data ?? []) as OverrideRow[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public getters — these are the only API consumer components should use
// ---------------------------------------------------------------------------

export async function getLeads(): Promise<Lead[]> {
  // Supabase-first: read from t01_leads (populated by sync worker).
  // Falls back to live GHL fetch if Supabase is empty.
  const sb = await getServerSupabaseAsync();
  if (sb) {
    try {
      const { count } = await sb.from('t01_leads').select('id', { count: 'exact', head: true });
      if (count && count > 0) {
        const allData: any[] = [];
        const PAGE_SIZE = 1000;
        for (let offset = 0; offset < count; offset += PAGE_SIZE) {
          const { data: page } = await sb
            .from('t01_leads')
            .select('*')
            .order('date', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);
          if (page) allData.push(...page);
        }
        if (allData.length > 0) {
          const mapped: Lead[] = allData.map(r => ({
            id: r.id,
            date: r.date,
            name: r.name,
            email: r.email,
            phone: r.phone ?? '',
            appAnswers: r.app_answers ?? null,
            campaignName: r.campaign_name ?? '',
            adSetName: r.ad_set_name ?? '',
            adName: r.ad_name ?? '',
            source: r.source ?? 'Unknown',
            contactLink: r.contact_link ?? null,
            offer: r.offer ?? null,
          }));
          const overrides = await fetchOverrides('t01_leads');
          return filterRemoved(applyOverrides(mapped, overrides, 't01_leads'));
        }
      }
    } catch (e) {
      console.error('[getLeads] Supabase read failed, falling back to live:', e);
    }
  }

  // Fallback: live GHL fetch (local dev or before first cron run)
  const ghlToken = process.env.GHL_API_KEY;
  const ghlLocation = process.env.GHL_LOCATION_ID;
  if (ghlToken && ghlLocation) {
    try {
      const { fetchGHLLeads } = await import('./mappers/ghl');
      const liveGhl = await fetchGHLLeads(ghlToken, ghlLocation);
      if (liveGhl.length > 0) {
        const overrides = await fetchOverrides('t01_leads');
        return filterRemoved(applyOverrides(liveGhl, overrides, 't01_leads'));
      }
    } catch (e) {
      console.error('[getLeads] GHL fetch failed, falling back:', e);
    }
  }

  // Final fallback: mock data (local dev with no integrations)
  const ghlConnected = !!(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID);
  const base = firstNonEmpty(null, mockLeads as any, ghlConnected);
  const overrides = await fetchOverrides('t01_leads');
  return filterRemoved(applyOverrides(base as any, overrides, 't01_leads'));
}

export async function getAds(): Promise<Ad[]> {
  // Supabase-first: read from t02_ads (populated by /api/sync/meta).
  // The Meta API has no date-range parameter on the request the dashboard
  // makes today, so previous behavior of always hitting Meta meant the
  // returned rows ignored whatever date window the UI applied. Reading
  // from t02_ads lets per-day rows flow through (each row has a `date`
  // column the dashboard filters on).
  //
  // Fallback chain: Supabase rows → live Meta API → mock data.
  const sb = await getServerSupabaseAsync();
  if (sb) {
    try {
      const { count } = await sb.from('t02_ads').select('id', { count: 'exact', head: true });
      if (count && count > 0) {
        const allRows: any[] = [];
        const PAGE_SIZE = 1000;
        for (let offset = 0; offset < count; offset += PAGE_SIZE) {
          const { data: page } = await sb
            .from('t02_ads')
            .select('*')
            .range(offset, offset + PAGE_SIZE - 1);
          if (page) allRows.push(...page);
        }

        // Map snake_case t02_ads rows → camelCase Ad objects.
        // Mirror of `adToRow` in src/app/api/sync/meta/route.ts.
        const ads: Ad[] = allRows.map((r: any) => ({
          id: r.id,
          date: r.date ?? undefined,
          adAccountName: r.ad_account_name ?? '',
          campaignName: r.campaign_name ?? '',
          adSetName: r.ad_set_name ?? '',
          adName: r.ad_name ?? '',
          campaignId: r.campaign_id ?? undefined,
          adSetId: r.ad_set_id ?? undefined,
          adId: r.ad_id ?? undefined,
          channel: r.channel ?? 'Facebook Ads',
          spend: Number(r.spend ?? 0),
          impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0),
          leads: Number(r.leads ?? 0),
          scheduledCalls: Number(r.scheduled_calls ?? 0),
          qualifiedCalls: Number(r.qualified_calls ?? 0),
          purchases: Number(r.purchases ?? 0),
          revenue: Number(r.revenue ?? 0),
          active: r.active ?? true,
          costPerLead: r.cost_per_lead ?? undefined,
          metaLeads: r.meta_leads ?? undefined,
          costPerResult: r.cost_per_result ?? undefined,
          actions: r.actions ?? undefined,
          actionValues: r.action_values ?? undefined,
        }));

        const overrides = await fetchOverrides('t02_ads');
        return applyOverrides(ads, overrides, 't02_ads');
      }
    } catch (e) {
      console.error('[getAds] Supabase t02_ads read failed, falling back to Meta:', e);
    }
  }

  // Fallback 1: live Meta API
  const metaToken = process.env.META_ACCESS_TOKEN;
  const metaAccountId = process.env.META_AD_ACCOUNT_ID;
  if (metaToken && metaAccountId) {
    try {
      const { fetchMetaInsights } = await import('./mappers/meta');
      const liveMeta = await fetchMetaInsights(metaToken, metaAccountId);
      if (liveMeta.length > 0) {
        const overrides = await fetchOverrides('t02_ads');
        return applyOverrides(liveMeta, overrides, 't02_ads');
      }
    } catch (e) {
      console.error('[getAds] Meta fetch failed, falling back to mock:', e);
    }
  }

  // Fallback 2: mock data
  const metaConnected = !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID);
  const base = firstNonEmpty(null, mockAds, metaConnected);
  const overrides = await fetchOverrides('t02_ads');
  return applyOverrides(base, overrides, 't02_ads');
}

export async function getDailyMetrics(): Promise<DailyMetrics[]> {
  // Built up from leads + ads + payments by sync workers. Until the full
  // pillar stack lands we piece it together on the fly:
  //   - spend → real from Meta (per-day insights)
  //   - leads → real from GHL (getLeads, bucketed by date)
  //   - revenue → mock until Pillar 4 (Whop/Fanbasis)
  //   - callsBooked / callsShown / callsClosed → mock until Pillars 3/5
  let live: DailyMetrics[] | null = null;
  const sb = await getServerSupabaseAsync();
  if (sb) {
    try {
      // daily_metrics table was dropped in migration 0008 — skip Supabase read
      live = null;
    } catch {
      live = null;
    }
  }

  // Any real integration means we should not fall back to mock daily metrics
  const anyIntegrationConnected = !!(process.env.GHL_API_KEY || process.env.META_ACCESS_TOKEN);
  const base = firstNonEmpty(live, mockDailyMetrics, anyIntegrationConnected);
  let result = base;

  // Overlay real Meta daily spend when credentials are set. Skip on failure.
  const metaToken = process.env.META_ACCESS_TOKEN;
  const metaAcct = process.env.META_AD_ACCOUNT_ID;
  if (metaToken && metaAcct) {
    try {
      const { fetchMetaDailySpend } = await import('./mappers/meta');
      const dailySpend = await fetchMetaDailySpend(metaToken, metaAcct, 'last_90d');
      if (dailySpend.length > 0) {
        const spendByDate = new Map(dailySpend.map(d => [d.date, d.spend]));
        // Also overlay real GHL lead counts per day when available.
        let leadsByDate = new Map<string, number>();
        try {
          const { fetchGHLLeads } = await import('./mappers/ghl');
          const ghlToken = process.env.GHL_API_KEY;
          const ghlLoc = process.env.GHL_LOCATION_ID;
          if (ghlToken && ghlLoc) {
            const leads = await fetchGHLLeads(ghlToken, ghlLoc);
            for (const l of leads) {
              leadsByDate.set(l.date, (leadsByDate.get(l.date) ?? 0) + 1);
            }
          }
        } catch { /* ignore, fall back to base */ }

        // Build a fresh daily_metrics array spanning the union of base dates
        // and real Meta dates so the chart always has something to render.
        const allDates = new Set<string>([
          ...base.map(b => b.date),
          ...dailySpend.map(d => d.date),
        ]);
        const merged: DailyMetrics[] = Array.from(allDates).sort().map(date => {
          const baseRow = base.find(b => b.date === date);
          return {
            date,
            spend: spendByDate.get(date) ?? baseRow?.spend ?? 0,
            leads: leadsByDate.get(date) ?? baseRow?.leads ?? 0,
            callsBooked: baseRow?.callsBooked ?? 0,
            callsShown: baseRow?.callsShown ?? 0,
            callsClosed: baseRow?.callsClosed ?? 0,
            revenue: baseRow?.revenue ?? 0,
          };
        });
        result = merged;
      }
    } catch (e) {
      console.error('[dataSources] Meta daily spend overlay failed:', e);
    }
  }

  // Pillar 6: Overlay closer EOD data from Slack onto daily metrics.
  // Adds real callsShown, callsClosed, callsBooked from closer self-reports.
  // NOTE: We intentionally do NOT use EOD cash_collected for revenue because
  // closer self-reports can be cumulative or inflated (caused $110K spike on Apr 8).
  // Revenue is computed separately below from actual closed deals by close date.
  if (sb) {
    try {
      const { data: eods } = await sb
        .from('t05_eod_reports')
        .select('date, calls_shown, calls_closed, calls_booked');
      if (eods && eods.length > 0) {
        const eodByDate = new Map<string, { shown: number; closed: number; booked: number }>();
        for (const e of eods) {
          const existing = eodByDate.get(e.date) ?? { shown: 0, closed: 0, booked: 0 };
          existing.shown += Number(e.calls_shown) || 0;
          existing.closed += Number(e.calls_closed) || 0;
          existing.booked += Number(e.calls_booked) || 0;
          eodByDate.set(e.date, existing);
        }
        result = result.map(day => {
          const eod = eodByDate.get(day.date);
          if (!eod) return day;
          return {
            ...day,
            callsShown: eod.shown,
            callsClosed: eod.closed,
            callsBooked: eod.booked,
          };
        });
      }
    } catch (e) {
      console.error('[dataSources] Closer EOD overlay failed (non-fatal):', e);
    }
  }

  // Compute daily revenue from actual closed deals, keyed by CLOSE date
  // (slackNewClientDate from #new-clients channel, or demoDate as fallback).
  // This avoids the $110K spike bug where closer EOD cash_collected was
  // self-reported and could be cumulative or inflated.
  if (sb) {
    try {
      const { data: slackClients } = await sb
        .from('t20_slack_new_clients')
        .select('date, cash_collected');
      if (slackClients && slackClients.length > 0) {
        const revByDate = new Map<string, number>();
        for (const sc of slackClients) {
          const closeDate = sc.date;
          if (!closeDate) continue;
          const cash = Number(sc.cash_collected) || 0;
          if (cash > 0) {
            revByDate.set(closeDate, (revByDate.get(closeDate) ?? 0) + cash);
          }
        }
        if (revByDate.size > 0) {
          result = result.map(day => {
            const rev = revByDate.get(day.date);
            if (rev !== undefined) {
              return { ...day, revenue: rev };
            }
            return day;
          });
        }
      }
    } catch (e) {
      console.error('[dataSources] slack_new_clients revenue overlay failed (non-fatal):', e);
    }
  }

  return result;
}

export async function getClients(): Promise<Client[]> {
  // Clients are derived from leads with Closed Won status in useDashboardData.
  // Return empty — never mock. The hook's buildClientsFromLeads handles this.
  return [];
}

export async function getExpenses(): Promise<Expense[]> {
  // Pull expenses from Mercury banking ONLY (ProgB checking account).
  // Mercury is the single source of truth for expenses.
  const mercuryKey = process.env.MERCURY_API_KEY;
  if (mercuryKey) {
    try {
      const { fetchMercuryExpenses } = await import('./mappers/mercury');
      const summary = await fetchMercuryExpenses(mercuryKey);
      if (summary.transactions.length > 0) {
        // Map MercuryTransaction → Expense type
        return summary.transactions.map(t => ({
          id: t.id,
          date: t.date,
          category: mapMercuryCategory(t.category),
          description: t.description || t.counterpartyName,
          amount: t.amount,
          recurring: false,
        }));
      }
    } catch (e) {
      console.error('[getExpenses] Mercury fetch failed, falling back to mock:', e);
    }
  }

  // Fallback to mock if Mercury not connected
  return [...mockExpenses];
}

function mapMercuryCategory(cat: string): Expense['category'] {
  const c = cat.toLowerCase();
  if (c === 'marketing' || c.includes('market')) return 'marketing';
  if (c === 'labour' || c === 'labor' || c.includes('labor')) return 'labor';
  if (c === 'overhead' || c.includes('overhead')) return 'overhead';
  if (c === 'mastermind') return 'program_coaches';
  return 'overhead';
}

export type ContentChannel = 'youtube' | 'instagram' | 'linkedin' | 'x';

export async function getContent(
  channel: ContentChannel
): Promise<ContentPost[] | YouTubeVideo[]> {
  // Pillars 7 (YouTube) + 8 (IG/X/LinkedIn) populate `content_posts`.
  switch (channel) {
    case 'youtube': {
      // Supabase-first: if the sync worker has populated content_posts, read from there
      const sbYt = await getServerSupabaseAsync();
      if (sbYt) {
        try {
          const { data, count } = await sbYt
            .from('t12_content_youtube')
            .select('*', { count: 'exact', head: false })
            .range(0, 999);
          if (data && (count ?? 0) > 0) {
            const mapped: YouTubeVideo[] = (data as any[]).map(r => ({
              id: r.id,
              title: r.title ?? '',
              date: r.date ?? '',
              views: Number(r.views) || 0,
              likes: Number(r.likes) || 0,
              comments: Number(r.comments) || 0,
              subscribers: Number(r.follows) || 0,
              watchTimeHours: 0,
              avgViewDuration: '',
              ctr: 0,
              leads: Number(r.leads) || 0,
              booked: Number(r.booked) || 0,
              showed: Number(r.showed) || 0,
              closed: Number(r.closed) || 0,
              cashCollected: Number(r.cash_collected) || 0,
              contractedRevenue: Number(r.contracted_revenue) || 0,
              source: (r.id === 'yt-bio' ? 'bio' : 'video') as 'video' | 'bio',
              thumbnailUrl: r.thumbnail_url ?? undefined,
              duration: r.duration ?? undefined,
            }));
            return mapped;
          }
        } catch (e) {
          console.error('[getContent] Supabase YouTube read failed, falling back to live:', e);
        }
      }

      // Fallback: live YouTube API fetch
      const ytKey = process.env.YOUTUBE_API_KEY;
      const ytChannel = process.env.YOUTUBE_CHANNEL_ID;
      if (ytKey && ytChannel) {
        try {
          const { fetchYouTubeVideos, enrichYouTubeWithLeads, enrichYouTubeWithTrakyo } = await import('./mappers/youtube');
          let videos = await fetchYouTubeVideos(ytKey, ytChannel);
          if (videos.length > 0) {
            // Enrich with lead attribution from GHL
            const leads = await getLeads();
            videos = enrichYouTubeWithLeads(videos, leads);
            // Enrich with Trakyo deep link click data
            const trakyoKey = process.env.TRAKYO_API_KEY;
            if (trakyoKey) {
              videos = await enrichYouTubeWithTrakyo(videos, trakyoKey);
            }
            return videos;
          }
        } catch (e) {
          console.error('[getContent] YouTube fetch failed, falling back:', e);
        }
      }
      // YouTube integration is connected — return empty, not mock
      return [];
    }
    case 'instagram': {
      const proxyUrl = process.env.META_PROXY_URL;
      const proxyKey = process.env.META_PROXY_API_KEY;
      if (proxyUrl && proxyKey) {
        try {
          const { fetchInstagramPosts, enrichInstagramWithLeads } = await import('./mappers/instagram');
          let posts = await fetchInstagramPosts();
          if (posts.length > 0) {
            const leads = await getLeads();
            posts = enrichInstagramWithLeads(posts, leads);
            return posts;
          }
        } catch (e) {
          console.error('[getContent] Instagram fetch failed:', e);
        }
      }
      // Instagram integration connected — return empty, not mock
      return [];
    }
    case 'linkedin':
      return []; // No integration connected yet — return empty, not mock
    case 'x': {
      const xToken = process.env.TWITTER_BEARER_TOKEN;
      if (xToken) {
        try {
          const { fetchXPosts } = await import('./mappers/twitter');
          return fetchXPosts(xToken);
        } catch (e) {
          console.error('[getContent] X fetch failed:', e);
        }
      }
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Backend Revenue — Whop payments grouped by billing_reason + Slack new clients
// ---------------------------------------------------------------------------

export interface BackendRevenueData {
  newCash: number;       // initial/one-time purchases
  renewals: number;      // recurring billing
  upsells: number;       // upgrade billing
  arCollected: number;   // from slack_payment_notis succeeded
  totalBackend: number;  // sum of all
  breakdown: {
    whopInitial: number;
    whopRenewal: number;
    whopUpgrade: number;
    whopOther: number;
    slackNewClientCash: number;
    slackPaymentSucceeded: number;
  };
}

export async function getBackendRevenue(): Promise<BackendRevenueData> {
  let whopInitial = 0;
  let whopRenewal = 0;
  let whopUpgrade = 0;
  let whopOther = 0;

  // 1. Whop payments grouped by billing_reason
  const whopToken = process.env.WHOP_API_KEY;
  if (whopToken) {
    try {
      const { fetchWhopPayments } = await import('./mappers/whop');
      const payments = await fetchWhopPayments(whopToken);
      for (const p of payments) {
        if (p.status !== 'paid') continue;
        const reason = (p.billingReason ?? '').toLowerCase();
        if (reason === 'initial' || reason === 'one_time') {
          whopInitial += p.net;
        } else if (reason === 'recurring' || reason === 'renewal') {
          whopRenewal += p.net;
        } else if (reason === 'upgrade') {
          whopUpgrade += p.net;
        } else {
          whopOther += p.net;
        }
      }
    } catch (e) {
      console.error('[getBackendRevenue] Whop fetch failed (non-fatal):', e);
    }
  }

  // 2. Slack #new-clients cash (new client signings)
  let slackNewClientCash = 0;
  const sb = await getServerSupabaseAsync();
  if (sb) {
    try {
      const { data: newClients } = await sb
        .from('t20_slack_new_clients')
        .select('cash_collected');
      if (newClients) {
        for (const r of newClients) {
          slackNewClientCash += Number(r.cash_collected) || 0;
        }
      }
    } catch (e) {
      console.error('[getBackendRevenue] slack_new_clients read failed (non-fatal):', e);
    }
  }

  // 3. Slack #payment-notifications succeeded (AR collected)
  let slackPaymentSucceeded = 0;
  if (sb) {
    try {
      const { data: payments } = await sb
        .from('t19_payment_notis')
        .select('amount')
        .eq('action', 'succeeded');
      if (payments) {
        for (const r of payments) {
          slackPaymentSucceeded += Number(r.amount) || 0;
        }
      }
    } catch (e) {
      console.error('[getBackendRevenue] slack_payment_notis read failed (non-fatal):', e);
    }
  }

  // Aggregate
  const newCash = whopInitial + whopOther;
  const renewals = whopRenewal;
  const upsells = whopUpgrade;
  const arCollected = slackPaymentSucceeded;
  const totalBackend = newCash + renewals + upsells + arCollected + slackNewClientCash;

  return {
    newCash,
    renewals,
    upsells,
    arCollected,
    totalBackend,
    breakdown: {
      whopInitial, whopRenewal, whopUpgrade, whopOther,
      slackNewClientCash, slackPaymentSucceeded,
    },
  };
}

export async function getManyChatData() {
  const apiKey = process.env.MANYCHAT_API_KEY;
  if (!apiKey) return { leads: [], keywords: [], stages: [], overview: { totalLeads: 0, booked: 0, showed: 0, won: 0, cash: 0, dealRev: 0, bookRate: 0, showRate: 0, closeRate: 0, cashPerCall: 0 } };
  try {
    const { fetchAllManyChatLeads } = await import('./mappers/manychat');
    const ghlLeads = await getLeads();
    return fetchAllManyChatLeads(apiKey, ghlLeads);
  } catch (e) {
    console.error('[getManyChatData] failed:', e);
    return { leads: [], keywords: [], stages: [], overview: { totalLeads: 0, booked: 0, showed: 0, won: 0, cash: 0, dealRev: 0, bookRate: 0, showRate: 0, closeRate: 0, cashPerCall: 0 } };
  }
}

// ---------------------------------------------------------------------------
// Status helper used by SystemHealthTab
// ---------------------------------------------------------------------------

export interface DataSourceStatus {
  supabaseConfigured: boolean;
  liveTables: {
    t01_leads: boolean;
    t02_ads: boolean;
    t03_bookings: boolean;
    t06_deals_closed: boolean;
    t07_income_processors: boolean;
    t08_expenses: boolean;
    t05_eod_reports: boolean;
    t_client_ledger: boolean;
    t18_manychat_leads: boolean;
    t12_content_youtube: boolean;
  };
}

export async function getDataSourceStatus(): Promise<DataSourceStatus> {
  const sb = await getServerSupabaseAsync();
  const status: DataSourceStatus = {
    supabaseConfigured: await isSupabaseConfigured(),
    liveTables: {
      t01_leads: false,
      t02_ads: false,
      t03_bookings: false,
      t06_deals_closed: false,
      t07_income_processors: false,
      t08_expenses: false,
      t05_eod_reports: false,
      t_client_ledger: false,
      t18_manychat_leads: false,
      t12_content_youtube: false,
    },
  };
  if (!sb) return status;

  const tables = Object.keys(status.liveTables) as (keyof typeof status.liveTables)[];
  await Promise.all(
    tables.map(async t => {
      try {
        const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
        status.liveTables[t] = (count ?? 0) > 0;
      } catch {
        status.liveTables[t] = false;
      }
    })
  );
  return status;
}
