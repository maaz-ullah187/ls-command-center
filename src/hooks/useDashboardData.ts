'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Lead, Ad, DailyMetrics, Client, Expense, YouTubeVideo, ContentPost } from '@/lib/types';
import type { ManyChatSummary } from '@/lib/mappers/manychat';
import type { BackendRevenueData } from '@/lib/dataSources';
import type { MondayClient } from '@/lib/mappers/monday';

export interface SheetRevenueSummary {
  month: string;
  newCash: number;
  refunds: number;
  ar: number;
  renewals: number;
  upgrades: number;
  mastermind: number;
  totalRevenue: number;
  netRevenue: number;
  clientCount: number;
  // Per the operator: only Active + Upsold count as active clients.
  activeClientCount: number;
}

// Single hook that hydrates the dashboard's primary datasets via the
// switching layer (`/api/data/*` → `src/lib/dataSources.ts`).
//
// Until any pillar lands and populates Supabase, every endpoint returns the
// existing mock data unchanged, so the dashboard looks and feels identical to
// before this refactor. As pillars come online the same hook automatically
// returns live data — no consumer changes required.
//
// Usage:
//   const { leads, ads, dailyMetrics, clients, expenses, loading, error } = useDashboardData();
//
// Loading state holds until all core datasets are fetched. Errors don't
// blank out the UI — we surface them in console + return empty arrays so the
// dashboard degrades gracefully.

export interface DashboardData {
  leads: Lead[];
  ads: Ad[];
  dailyMetrics: DailyMetrics[];
  clients: Client[];
  expenses: Expense[];
  youtubeVideos: YouTubeVideo[];
  instagramPosts: ContentPost[];
  manychatData: ManyChatSummary;
  backendRevenue: BackendRevenueData;
  mondayClients: MondayClient[];
  sheetRevenue: SheetRevenueSummary;
  loading: boolean;
  error: string | null;
  /** Force a refetch — exposed so EditableValue can refresh after an override write */
  refresh: () => void;
}

/**
 * Build Client records from other data sources (t06_deals_closed, t09_clients).
 * t01_leads no longer has stage/cash data — clients come from dedicated tables.
 * For now return empty; the Monday/deals sync populates t09_clients directly.
 */
function buildClientsFromLeads(_leads: Lead[]): Client[] {
  // Leads no longer have stage/cashCollected — clients come from t09_clients
  return [];
}

export type DashboardSourceKey =
  | 'leads'
  | 'ads'
  | 'dailyMetrics'
  | 'expenses'
  | 'youtubeVideos'
  | 'instagramPosts'
  | 'manychatData'
  | 'backendRevenue'
  | 'mondayClients'
  | 'sheetRevenue';

export interface UseDashboardDataOptions {
  /**
   * Date range for the date-scoped main-dashboard endpoints
   * (revenue-buckets, cash-breakdown, revenue-composition). When omitted,
   * the endpoints fall back to their own default window (current month).
   */
  dateRange?: { start: string; end: string };
  /**
   * Restrict the hook to only fetch the listed data sources.
   * Useful for pages like /projections that only need leads, ads, and sheetRevenue.
   */
  sources?: DashboardSourceKey[];
}

export function useDashboardData(options: UseDashboardDataOptions = {}): DashboardData {
  const { dateRange, sources } = options;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetrics[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideo[]>([]);
  const [instagramPosts, setInstagramPosts] = useState<ContentPost[]>([]);
  const emptyMC: ManyChatSummary = { leads: [], keywords: [], stages: [], overview: { totalLeads: 0, booked: 0, showed: 0, won: 0, cash: 0, dealRev: 0, bookRate: 0, showRate: 0, closeRate: 0, cashPerCall: 0 } };
  const [manychatData, setManychatData] = useState<ManyChatSummary>(emptyMC);
  const emptyBR: BackendRevenueData = { newCash: 0, renewals: 0, upsells: 0, arCollected: 0, totalBackend: 0, breakdown: { whopInitial: 0, whopRenewal: 0, whopUpgrade: 0, whopOther: 0, slackNewClientCash: 0, slackPaymentSucceeded: 0 } };
  const [backendRevenue, setBackendRevenue] = useState<BackendRevenueData>(emptyBR);
  const [mondayClients, setMondayClients] = useState<MondayClient[]>([]);
  const emptySheet: SheetRevenueSummary = { month: '', newCash: 0, refunds: 0, ar: 0, renewals: 0, upgrades: 0, mastermind: 0, totalRevenue: 0, netRevenue: 0, clientCount: 0, activeClientCount: 0 };
  const [sheetRevenue, setSheetRevenue] = useState<SheetRevenueSummary>(emptySheet);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Each fetch is independent — one failure doesn't block the others
    const safeFetch = (url: string) => fetch(url).then(r => r.json()).catch(() => null);

    // Build the date-window query string for main-dashboard endpoints.
    // The API uses `from` / `to` (not `start` / `end`); we map here so callers
    // can use the dashboard's existing `DateRange { start, end, label }` shape.
    const dateQs = dateRange
      ? `?from=${encodeURIComponent(dateRange.start)}&to=${encodeURIComponent(dateRange.end)}`
      : '';

    const sourceKeys: DashboardSourceKey[] = sources ?? [
      'leads',
      'ads',
      'dailyMetrics',
      'expenses',
      'youtubeVideos',
      'instagramPosts',
      'manychatData',
      'backendRevenue',
      'mondayClients',
      'sheetRevenue',
    ];

    const fetchers: Record<DashboardSourceKey, () => Promise<any>> = {
      leads: () => safeFetch('/api/data/leads'),
      ads: () => safeFetch('/api/data/ads'),
      dailyMetrics: () => safeFetch('/api/data/daily-metrics'),
      expenses: () => safeFetch('/api/data/expenses'),
      youtubeVideos: () => safeFetch('/api/data/youtube'),
      instagramPosts: () => safeFetch('/api/data/instagram'),
      manychatData: () => safeFetch('/api/data/manychat'),
      backendRevenue: () => safeFetch(`/api/main/cash-breakdown${dateQs}`),
      mondayClients: () => safeFetch(`/api/main/revenue-composition${dateQs}`),
      sheetRevenue: () => safeFetch(`/api/main/revenue-buckets${dateQs}`),
    };

    const requests = sourceKeys.map((key) => [key, fetchers[key]()] as const);

    Promise.all(requests.map(([, req]) => req))
      .then((results) => {
        if (cancelled) return;
        results.forEach((data, index) => {
          const key = requests[index][0];
          if (!data) return;
          switch (key) {
            case 'leads':
              setLeads(Array.isArray(data) ? data : []);
              break;
            case 'ads':
              setAds(Array.isArray(data) ? data : []);
              break;
            case 'dailyMetrics':
              setDailyMetrics(Array.isArray(data) ? data : []);
              break;
            case 'expenses':
              setExpenses(Array.isArray(data) ? data : []);
              break;
            case 'youtubeVideos':
              setYoutubeVideos(Array.isArray(data) ? data : []);
              break;
            case 'instagramPosts':
              setInstagramPosts(Array.isArray(data) ? data : []);
              break;
            case 'manychatData':
              setManychatData(data && data.leads ? data : emptyMC);
              break;
            case 'backendRevenue':
              if (data && typeof data.total === 'number') {
                const slices = (data?.slices ?? []) as Array<{ category: string; amount: number }>;
                const sliceAmt = (cat: string) =>
                  slices.find(s => s.category === cat)?.amount ?? 0;
                setBackendRevenue({
                  newCash:     sliceAmt('new'),
                  renewals:    sliceAmt('renewals_upsells'),
                  upsells:     0,
                  arCollected: sliceAmt('ar'),
                  totalBackend: data.total,
                  breakdown: {
                    whopInitial: 0,
                    whopRenewal: 0,
                    whopUpgrade: 0,
                    whopOther: 0,
                    slackNewClientCash: 0,
                    slackPaymentSucceeded: 0,
                  },
                });
              }
              break;
            case 'mondayClients':
              setMondayClients([]);
              break;
            case 'sheetRevenue':
              if (typeof data.netRevenue === 'number') {
                setSheetRevenue({
                  month: data.monthYear ?? '',
                  newCash:      data.newCash ?? 0,
                  refunds:      data.refunds ?? 0,
                  ar:           data.ar ?? 0,
                  renewals:     data.upsellRenewal ?? 0,
                  upgrades:     0,
                  mastermind:   data.mastermind ?? 0,
                  totalRevenue: data.grossInflow ?? 0,
                  netRevenue:   data.netRevenue,
                  clientCount:        0,
                  activeClientCount:  0,
                });
              }
              break;
          }
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Refetch whenever the date window shifts or the requested source set
    // changes. We depend on primitive values so new object identities with
    // the same dates or sources don't cause redundant fetches.
  }, [tick, dateRange?.start, dateRange?.end, sources?.join(',')]);

  // Build clients from leads: any Closed Won lead with cashCollected > 0
  // is a real client (Whop-enriched). Falls back to empty if no leads loaded.
  const clients = useMemo(() => {
    const real = buildClientsFromLeads(leads);
    return real;
  }, [leads]);

  return {
    leads,
    ads,
    dailyMetrics,
    clients,
    expenses,
    youtubeVideos,
    instagramPosts,
    manychatData,
    backendRevenue,
    mondayClients,
    sheetRevenue,
    loading,
    error,
    refresh: () => setTick(t => t + 1),
  };
}
