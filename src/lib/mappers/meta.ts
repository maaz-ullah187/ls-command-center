// Meta Ads → dashboard Ad type mapper (Pillar 1).
//
// Routes all Meta API calls through the local meta-proxy (Flask on port 5100)
// so that requests originate from the operator's home IP (not Vercel data center IPs).
// Proxy runs on Mac via launchd, exposed to Vercel over Tailscale.
//
// In dev: http://localhost:5100
// In prod: http://<mac-tailscale-ip>:5100
//
// The proxy handles Meta auth internally — we only pass our PROXY_API_KEY.

import 'server-only';
import type { Ad } from '../types';

// Proxy base URL: use META_PROXY_URL env var if set and not localhost
const PROXY_BASE = process.env.META_PROXY_URL || '';
const PROXY_KEY = process.env.META_PROXY_API_KEY || '';
// Direct API fallback: use META_ACCESS_TOKEN + META_AD_ACCOUNT_ID
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_ACCOUNT = process.env.META_AD_ACCOUNT_ID || '';
const USE_PROXY = PROXY_BASE && !PROXY_BASE.includes('localhost');
const GRAPH_BASE = `https://graph.facebook.com/v21.0/act_${META_ACCOUNT}`;

interface MetaActionEntry {
  action_type: string;
  value: string;
}

interface MetaInsight {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  account_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  date_start?: string;
  date_stop?: string;
  actions?: MetaActionEntry[];
  action_values?: MetaActionEntry[];
  cost_per_action_type?: MetaActionEntry[];
}

interface MetaInsightResponse {
  data?: MetaInsight[];
  error?: { message: string; type: string; code: number };
}

interface MetaAdRow {
  id?: string;
  effective_status?: string;
  creative?: {
    thumbnail_url?: string;
    image_url?: string;
  };
}

interface MetaAdMeta {
  thumbnailUrl?: string;
  effectiveStatus?: string;
}

interface MetaAdsResponse {
  data?: MetaAdRow[];
  error?: { message: string; type: string; code: number };
}

function findActionValue(entries: MetaActionEntry[] | undefined, type: string): number | undefined {
  const entry = entries?.find(e => e.action_type === type);
  if (!entry) return undefined;
  const n = parseFloat(entry.value);
  return isNaN(n) ? undefined : n;
}

export function mapMetaInsightToAd(i: MetaInsight, meta?: MetaAdMeta): Ad {
  const metaLeads = findActionValue(i.actions, 'lead');
  const costPerLead = findActionValue(i.cost_per_action_type, 'lead');
  // cost_per_result uses whichever objective action has a cost entry
  const costPerResult = i.cost_per_action_type?.length
    ? parseFloat(i.cost_per_action_type[0].value)
    : undefined;

  return {
    id: i.date_start
      ? `${i.ad_id ?? 'meta'}-${i.date_start}`
      : i.ad_id ?? `meta-${Math.random().toString(36).slice(2)}`,
    date: i.date_start,
    adAccountName: i.account_name ?? 'Program B',
    campaignName: i.campaign_name ?? 'Unknown Campaign',
    adSetName: i.adset_name ?? 'Unknown Ad Set',
    adName: i.ad_name ?? 'Unknown Ad',
    channel: 'Facebook Ads',
    spend: parseFloat(i.spend ?? '0'),
    impressions: parseInt(i.impressions ?? '0', 10),
    clicks: parseInt(i.clicks ?? '0', 10),
    leads: metaLeads ?? 0,
    scheduledCalls: 0,
    qualifiedCalls: 0,
    purchases: 0,
    revenue: 0,
    // effective_status values: ACTIVE | PAUSED | DELETED | ARCHIVED | ...
    active: meta?.effectiveStatus === 'ACTIVE',
    thumbnailUrl: meta?.thumbnailUrl,
    campaignId: i.campaign_id,
    adSetId: i.adset_id,
    adId: i.ad_id,
    metaLeads: metaLeads !== undefined ? Math.round(metaLeads) : undefined,
    costPerLead,
    costPerResult: isNaN(costPerResult as number) ? undefined : costPerResult,
    actions: i.actions,
    actionValues: i.action_values,
  };
}

interface MetaAdsResponsePaged extends MetaAdsResponse {
  paging?: { next?: string };
}

async function fetchAdMeta(
  _token: string,
  _accountId: string
): Promise<Map<string, MetaAdMeta>> {
  const map = new Map<string, MetaAdMeta>();
  async function tryAdFetch(url: string, headers: Record<string, string>) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.error) return null;
      return json as MetaAdsResponsePaged;
    } catch { return null; }
  }

  try {
    let adJson: MetaAdsResponsePaged | null = null;
    if (USE_PROXY) {
      adJson = await tryAdFetch(
        `${PROXY_BASE}/api/ads?fields=id,effective_status,creative{thumbnail_url,image_url}&limit=100`,
        { 'X-API-Key': PROXY_KEY }
      );
    }
    if (!adJson && META_TOKEN && META_ACCOUNT) {
      adJson = await tryAdFetch(
        `${GRAPH_BASE}/ads?fields=id,effective_status,creative{thumbnail_url,image_url}&limit=100&access_token=${META_TOKEN}`,
        {}
      );
    }
    if (!adJson) return map;
    for (const row of adJson.data ?? []) {
      if (!row.id) continue;
      const thumb = row.creative?.thumbnail_url || row.creative?.image_url;
      map.set(row.id, { thumbnailUrl: thumb, effectiveStatus: row.effective_status });
    }
  } catch (e) {
    console.error('[meta-proxy] fetchAdMeta failed:', e);
  }
  return map;
}

// Fetch Meta spend broken down by day. Used by the Daily Spend chart on the
// main dashboard — replaces the mock daily_metrics values for the `spend`
// column. Leads/revenue still come from GHL/Whop respectively.
export interface MetaDailySpend {
  date: string;      // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
}

export async function fetchMetaDailySpend(
  _token: string,
  _accountId: string,
  datePreset: string = 'last_90d',
): Promise<MetaDailySpend[]> {
  async function tryDailyFetch(url: string, headers: Record<string, string>) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.error) return null;
      return json;
    } catch { return null; }
  }

  try {
    let json: any = null;
    if (USE_PROXY) {
      json = await tryDailyFetch(
        `${PROXY_BASE}/api/insights?level=account&fields=spend,impressions,clicks&time_increment=1&date_preset=${datePreset}`,
        { 'X-API-Key': PROXY_KEY }
      );
    }
    if (!json && META_TOKEN && META_ACCOUNT) {
      json = await tryDailyFetch(
        `${GRAPH_BASE}/insights?level=account&fields=spend,impressions,clicks&time_increment=1&date_preset=${datePreset}&access_token=${META_TOKEN}`,
        {}
      );
    }
    if (!json) return [];
    return (json.data ?? []).map((row: any) => ({
      date: row.date_start ?? '',
      spend: parseFloat(row.spend ?? '0'),
      impressions: parseInt(row.impressions ?? '0', 10),
      clicks: parseInt(row.clicks ?? '0', 10),
    }));
  } catch (e) {
    console.error('[meta] fetchMetaDailySpend threw:', e);
    return [];
  }
}

// Pull insights from Meta. Supports either a date_preset ('last_30d') or a
// specific time_range ({ since, until } in YYYY-MM-DD). Daily cron uses
// time_range for yesterday only; backfill uses date_preset for broader pulls.
export async function fetchMetaInsights(
  _token: string,
  _accountId: string,
  datePreset?: string,
  timeRange?: { since: string; until: string },
): Promise<Ad[]> {
  const fields = [
    'ad_id',
    'ad_name',
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'account_name',
    'spend',
    'impressions',
    'clicks',
    'actions',
    'action_values',
    'cost_per_action_type',
  ].join(',');

  // Helper: fetch insights with pagination (Meta returns max 25 per page)
  async function fetchAllInsights(baseUrl: string, headers: Record<string, string>, maxPages = 50): Promise<MetaInsight[]> {
    const allData: MetaInsight[] = [];
    let url: string | null = baseUrl;
    let page = 0;
    while (url && page < maxPages) {
      try {
        const res = await fetch(url, { headers, cache: 'no-store' });
        if (!res.ok) break;
        const json = await res.json();
        if (json.error) break;
        if (json.data) {
          // Log the first row once so we can confirm actions fields arrive from the proxy
          if (allData.length === 0 && json.data.length > 0) {
            const sample = json.data[0];
            console.log('[meta] first insight row keys:', Object.keys(sample).join(','));
            console.log('[meta] sample actions:', JSON.stringify(sample.actions?.slice(0, 3) ?? null));
          }
          allData.push(...json.data);
        }
        url = json.paging?.next || null;
        page++;
      } catch { break; }
    }
    return allData;
  }

  try {
    // Build date filter: time_range takes priority over date_preset
    const dateParam = timeRange
      ? `time_range=${encodeURIComponent(JSON.stringify(timeRange))}`
      : `date_preset=${datePreset || 'last_30d'}`;

    // Try proxy first, then direct API with pagination
    let allInsights: MetaInsight[] = [];
    if (USE_PROXY) {
      const proxyUrl = `${PROXY_BASE}/api/insights?level=ad&fields=${fields}&${dateParam}&time_increment=1`;
      allInsights = await fetchAllInsights(proxyUrl, { 'X-API-Key': PROXY_KEY });
    }
    if (allInsights.length === 0 && META_TOKEN && META_ACCOUNT) {
      const directUrl = `${GRAPH_BASE}/insights?level=ad&fields=${fields}&${dateParam}&time_increment=1&limit=100&access_token=${META_TOKEN}`;
      allInsights = await fetchAllInsights(directUrl, {});
    }
    if (allInsights.length === 0) return [];

    const adMeta = await fetchAdMeta(_token, _accountId);

    return allInsights.map(i =>
      mapMetaInsightToAd(i, i.ad_id ? adMeta.get(i.ad_id) : undefined)
    );
  } catch (e) {
    console.error('[meta-proxy] fetchMetaInsights threw:', e);
    return [];
  }
}
