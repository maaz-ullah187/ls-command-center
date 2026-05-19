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
      safeFetch('/api/data/backend-revenue'),
      safeFetch('/api/data/monday-clients'),
      safeFetch('/api/data/sheet-revenue'),
    ])
      .then(([leadsData, adsData, dailyData, expensesData, ytData, igData, mcData, brData, mondayData, sheetData]) => {
        if (cancelled) return;
        if (leadsData) setLeads(Array.isArray(leadsData) ? leadsData : []);
        if (adsData) setAds(Array.isArray(adsData) ? adsData : []);
        if (dailyData) setDailyMetrics(Array.isArray(dailyData) ? dailyData : []);
        if (expensesData) setExpenses(Array.isArray(expensesData) ? expensesData : []);
        if (ytData) setYoutubeVideos(Array.isArray(ytData) ? ytData : []);
        if (igData) setInstagramPosts(Array.isArray(igData) ? igData : []);
        if (mcData) setManychatData(mcData && mcData.leads ? mcData : emptyMC);
        if (brData && typeof brData.totalBackend === 'number') setBackendRevenue(brData);
        if (mondayData) setMondayClients(Array.isArray(mondayData) ? mondayData : []);
        if (sheetData && typeof sheetData.newCash === 'number') setSheetRevenue(sheetData);
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
