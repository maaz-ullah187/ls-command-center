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

export function useDashboardData(): DashboardData {
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

    Promise.all([
      safeFetch('/api/data/leads'),
      safeFetch('/api/data/ads'),
      safeFetch('/api/data/daily-metrics'),
      safeFetch('/api/data/expenses'),
      safeFetch('/api/data/youtube'),
      safeFetch('/api/data/instagram'),
      safeFetch('/api/data/manychat'),
      // Main-dashboard endpoints (replace the legacy /api/data/* routes that
      // are no longer maintained). Response shapes differ, so each is
      // transformed below into the legacy types the dashboard already consumes.
      safeFetch('/api/main/cash-breakdown'),       // ← replaces /api/data/backend-revenue
      safeFetch('/api/main/revenue-composition'),  // ← replaces /api/data/monday-clients
      safeFetch('/api/main/headline'),             // ← replaces /api/data/sheet-revenue
    ])
      .then(([leadsData, adsData, dailyData, expensesData, ytData, igData, mcData, cashData, compData, headlineData]) => {
        if (cancelled) return;
        if (leadsData) setLeads(Array.isArray(leadsData) ? leadsData : []);
        if (adsData) setAds(Array.isArray(adsData) ? adsData : []);
        if (dailyData) setDailyMetrics(Array.isArray(dailyData) ? dailyData : []);
        if (expensesData) setExpenses(Array.isArray(expensesData) ? expensesData : []);
        if (ytData) setYoutubeVideos(Array.isArray(ytData) ? ytData : []);
        if (igData) setInstagramPosts(Array.isArray(igData) ? igData : []);
        if (mcData) setManychatData(mcData && mcData.leads ? mcData : emptyMC);

        // ─── backendRevenue ← /api/main/cash-breakdown ─────────────────────
        // cash-breakdown returns { total, bySource[], byOffer[] }. Map the
        // total into totalBackend so legacy cards keep reading the right
        // headline number. The per-program breakdown (newCash / renewals /
        // upsells / arCollected) isn't directly available from this endpoint
        // — those finer splits come from revenue-composition below and are
        // mirrored here so consumers that pull from backendRevenue still work.
        if (cashData && typeof cashData.total === 'number') {
          const slices = (compData?.slices ?? []) as Array<{ category: string; amount: number }>;
          const sliceAmt = (cat: string) =>
            slices.find(s => s.category === cat)?.amount ?? 0;
          setBackendRevenue({
            newCash:     sliceAmt('new'),
            renewals:    sliceAmt('renewals_upsells'),
            upsells:     0, // renewals and upsells are collapsed in revenue-composition
            arCollected: sliceAmt('ar'),
            totalBackend: cashData.total,
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

        // ─── mondayClients ← /api/main/revenue-composition ─────────────────
        // Note: revenue-composition returns donut slices, not a per-client
        // list. The MondayClient[] shape can't be derived from it, so
        // BackEndTab (which renders per-client rows) will show empty until
        // a real client-list endpoint is wired up.
        setMondayClients([]);

        // ─── sheetRevenue ← /api/main/headline + /api/main/revenue-composition ─
        // headline gives the canonical totalCash / refunded.
        // revenue-composition gives the per-category split the legacy UI needs
        // (new / renewals / upsells / ar / mastermind / refunds).
        if (headlineData && typeof headlineData.totalCash === 'number') {
          const slices = (compData?.slices ?? []) as Array<{ category: string; amount: number }>;
          const sliceAmt = (cat: string) =>
            slices.find(s => s.category === cat)?.amount ?? 0;
          const window = headlineData.window ?? {};
          const monthFromWindow = typeof window.from === 'string' ? window.from.slice(0, 7) : '';
          setSheetRevenue({
            month: monthFromWindow,
            newCash:      sliceAmt('new'),
            refunds:      Math.abs(sliceAmt('refund') || headlineData.refunded || 0),
            ar:           sliceAmt('ar'),
            renewals:     sliceAmt('renewals_upsells'),
            upgrades:     0, // renewals + upgrades collapsed into renewals_upsells
            mastermind:   sliceAmt('mastermind'),
            totalRevenue: headlineData.approved ?? 0,
            netRevenue:   headlineData.totalCash, // approved − refunded
            clientCount:        headlineData.count ?? 0,
            activeClientCount:  headlineData.count ?? 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

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
