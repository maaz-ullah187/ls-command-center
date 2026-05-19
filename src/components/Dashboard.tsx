'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Channel, Lead, ContentPost } from '@/lib/types';
import { getCloserStats } from '@/lib/mock-data';
import { useDashboardData } from '@/hooks/useDashboardData';
import { aggregateMetrics, filterLeadsByChannel, filterAdsByChannel, filterByProgram, filterByDateRange } from '@/lib/calculations';
import { detectTrends } from '@/lib/trends';
import { STORAGE_KEYS, loadJSON, saveJSON } from '@/lib/storage/localStore';
import TimeframeSelector, { DateRange } from './TimeframeSelector';
import MetricCard from './MetricCard';
import AlertBanner from './AlertBanner';
import ReviewQueueBanner from './ReviewQueueBanner';
import IntegrationHealthBanner from './IntegrationHealthBanner';
import SourceTable from './SourceTable';
import CRMTab from './CRMTab';
import CloserBreakdown from './CloserBreakdown';
import EODReportsView from './EODReportsView';
import LeadJourneyModal from './LeadJourneyModal';
import CallDetailPanel from './CallDetailPanel';
import { ChevronDown, ChevronRight } from 'lucide-react';
import AIChatPanel from './AIChatPanel';
import TrendChart from './TrendChart';
import WeeklyComparison from './WeeklyComparison';
import DrillDownModal from './DrillDownModal';
import LeadDetail from './LeadDetail';
import YouTubeTab from './YouTubeTab';
import InstagramTab from './InstagramTab';
import LinkedInTab from './LinkedInTab';
import XTab from './XTab';
import BackEndTab from './BackEndTab';
import ExpensesPnLTab from './ExpensesPnLTab';
import ExpensesTab from './ExpensesTab';
import IntegrationsTab from './IntegrationsTab';
import SystemHealthTab from './SystemHealthTab';
import CommissionsTab from './CommissionsTab';
import SalesCallsTab from './SalesCallsTab';
import ChannelIcon from './ChannelIcon';
import CEOKPIBar from './CEOKPIBar';
import CompetitorTracker from './CompetitorTracker';
import BillingTracker from './BillingTracker';

type MainTab = 'dashboard' | 'reports' | 'crm' | 'sales-calls' | 'closers' | 'commissions' | 'billing' | 'expenses-mercury' | 'integrations' | 'system-health' | 'competitors';
type BusinessView = 'all' | 'frontend' | 'backend';

interface TabDef {
  key: MainTab;
  label: string;
  icon: string;
}
interface FolderDef {
  key: string;
  label: string;
  tabs: TabDef[];
}

const FOLDERS: FolderDef[] = [
  {
    key: 'main',
    label: 'Main',
    tabs: [
      { key: 'dashboard', label: 'Dashboard', icon: '\u{1F4CA}' },
      { key: 'reports', label: 'Source Breakdown', icon: '\u{1F3AF}' },
    ],
  },
  {
    key: 'micro',
    label: 'Micro',
    tabs: [
      { key: 'crm', label: 'CRM', icon: '\u{1F465}' },
      { key: 'sales-calls', label: 'Sales Calls', icon: '\u{1F4DE}' },
      { key: 'closers', label: 'EOD Reports', icon: '\u{1F4DD}' },
      { key: 'commissions', label: 'Commissions', icon: '\u{1F4B5}' },
      { key: 'billing', label: 'Billing', icon: '\u{1F4B0}' },
      { key: 'expenses-mercury', label: 'Expenses', icon: '\u{1F4B8}' },
    ],
  },
  {
    key: 'other',
    label: 'Other',
    tabs: [
      { key: 'competitors', label: 'Competitors', icon: '\u{1F50D}' },
      { key: 'integrations', label: 'Integrations', icon: '\u{2699}\u{FE0F}' },
      { key: 'system-health', label: 'System Health', icon: '\u{1FA7A}' },
    ],
  },
];

export default function Dashboard() {
  // Pillar 0: data hydrated from /api/data/* via the switching layer in
  // src/lib/dataSources.ts. Falls back to mock when no pillar is wired yet.
  const { leads: rawLeads, ads: rawAds, dailyMetrics: rawDailyMetrics, clients, expenses, youtubeVideos, instagramPosts, manychatData, backendRevenue, mondayClients, sheetRevenue } = useDashboardData();
  const [xPosts, setXPosts] = useState<ContentPost[]>([]);
  useEffect(() => {
    fetch('/api/data/x').then(r => r.json()).then(d => { if (Array.isArray(d)) setXPosts(d); }).catch(() => {});
  }, []);

  const [activeTab, setActiveTab] = useState<MainTab>('dashboard');
  const [channel, setChannel] = useState<Channel | 'All'>('All');
  const [program, setProgram] = useState('All');
  const [businessView, setBusinessView] = useState<BusinessView>('all');
  const [leadModalData, setLeadModalData] = useState<{ leads: Lead[]; title: string } | null>(null);
  const [journeyLead, setJourneyLead] = useState<Lead | null>(null);
  const [callPanelLeadId, setCallPanelLeadId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['main', 'micro', 'other'])
  );

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Timeframe state — default to "This Month" so the operator sees current data on load
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const today = now.toISOString().split('T')[0];
    return { start: monthStart, end: today, label: 'This Month' };
  });

  // Mutable leads state (for call outcome updates). Hydrated from localStorage
  // on mount (client-only) so form edits survive a page reload. We start with
  // an empty object on the server to keep SSR deterministic, then swap in the
  // persisted value inside a useEffect — avoids hydration mismatch.
  const [leadOverrides, setLeadOverrides] = useState<Record<string, Partial<Lead>>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persisted = loadJSON<Record<string, Partial<Lead>>>(STORAGE_KEYS.leadOverrides, {});
    setLeadOverrides(persisted);
    setHydrated(true);
  }, []);

  // Persist every change, but only after the initial hydration read — otherwise
  // the empty-state write on mount would clobber the saved data.
  useEffect(() => {
    if (!hydrated) return;
    saveJSON(STORAGE_KEYS.leadOverrides, leadOverrides);
  }, [leadOverrides, hydrated]);

  // Apply local form-edit overrides (in-flight closer/lead edits stored in
  // localStorage) onto leads coming from the switching layer. Once Pillar 0.5
  // ships, the localStorage path is replaced by the Supabase `overrides`
  // table joined server-side in dataSources.ts.
  const allLeads = useMemo(() => {
    return rawLeads.map(l => {
      const overrides = leadOverrides[l.id];
      if (overrides) return { ...l, ...overrides };
      return l;
    });
  }, [rawLeads, leadOverrides]);

  // Date-filtered base data
  const dateFilteredLeads = useMemo(() => filterByDateRange(allLeads, dateRange.start, dateRange.end), [allLeads, dateRange]);
  const dateFilteredDailyMetrics = useMemo(() =>
    rawDailyMetrics.filter(d => d.date >= dateRange.start && d.date <= dateRange.end),
    [rawDailyMetrics, dateRange]
  );

  // Channel + Program filtered
  const filteredLeads = useMemo(() => {
    let leads = filterLeadsByChannel(dateFilteredLeads, channel);
    leads = filterByProgram(leads, program);
    return leads;
  }, [dateFilteredLeads, channel, program]);

  const dateFilteredAds = useMemo(() => {
    // Ads with a date field are filtered by the active date range.
    // Ads without a date (aggregate rows from Meta) always pass through
    // since we can't determine their time range.
    return rawAds.filter(a => {
      if (a.date) return a.date >= dateRange.start && a.date <= dateRange.end;
      return true;
    });
  }, [rawAds, dateRange]);
  const filteredAds = useMemo(() => filterAdsByChannel(dateFilteredAds, channel), [dateFilteredAds, channel]);
  const metrics = useMemo(() => aggregateMetrics(filteredLeads, filteredAds, dateFilteredDailyMetrics), [filteredLeads, filteredAds, dateFilteredDailyMetrics]);
  const alerts = useMemo(() => detectTrends(dateFilteredDailyMetrics), [dateFilteredDailyMetrics]);

  // Previous period comparison (first half vs second half of selected range)
  const midpoint = Math.floor(dateFilteredDailyMetrics.length / 2);
  const prevLeads = useMemo(() => {
    let leads = dateFilteredLeads.filter(l => {
      const idx = dateFilteredDailyMetrics.findIndex(d => d.date === l.date);
      return idx >= 0 && idx < midpoint;
    });
    leads = filterLeadsByChannel(leads, channel);
    return filterByProgram(leads, program);
  }, [dateFilteredLeads, dateFilteredDailyMetrics, midpoint, channel, program]);
  const prevMetrics = useMemo(() => aggregateMetrics(prevLeads, filteredAds, dateFilteredDailyMetrics.slice(0, midpoint)), [prevLeads, filteredAds, dateFilteredDailyMetrics, midpoint]);

  // Handle call outcome updates
  const handleLeadUpdate = useCallback((leadId: string, updates: Partial<Lead>) => {
    setLeadOverrides(prev => ({
      ...prev,
      [leadId]: { ...prev[leadId], ...updates },
    }));
  }, []);

  // Derive the live lead for the detail panel so updates reflect immediately
  const callPanelLead = useMemo(
    () => (callPanelLeadId ? allLeads.find(l => l.id === callPanelLeadId) ?? null : null),
    [callPanelLeadId, allLeads]
  );

  const isOrganicChannel = channel === 'YouTube' || channel === 'Instagram' || channel === 'LinkedIn' || channel === 'X';

  const CHANNELS: (Channel | 'All')[] = ['All', 'Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'];
  const PROGRAMS = ['All', 'Program A', 'Program B', 'Program C'];
  const BUSINESS_VIEWS: { key: BusinessView; label: string }[] = [
    { key: 'all', label: 'All Business' },
    { key: 'frontend', label: 'Front-End' },
    { key: 'backend', label: 'Back-End' },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] text-gray-300">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 bottom-0 w-56 bg-[#1a1d23] border-r border-gray-700 flex flex-col z-10">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-lg font-bold text-white">CRM</h1>
          <p className="text-xs text-gray-500 mt-0.5">Performance Tracking</p>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {FOLDERS.map((folder) => {
            const isOpen = expandedFolders.has(folder.key);
            return (
              <div key={folder.key} className="mb-2">
                <button
                  onClick={() => toggleFolder(folder.key)}
                  className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300 font-semibold transition-colors"
                >
                  {isOpen ? (
                    <ChevronDown size={10} />
                  ) : (
                    <ChevronRight size={10} />
                  )}
                  {folder.label}
                </button>
                {isOpen && (
                  <div className="mt-0.5">
                    {folder.tabs.map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`w-full flex items-center gap-3 pl-6 pr-4 py-2 text-sm transition-colors ${
                          activeTab === tab.key
                            ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-500'
                            : 'text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                      >
                        <span className="text-xs">{tab.icon}</span>
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-gray-700 text-[10px] text-gray-600">
          Data: Mock | Connect Sheets + GHL for live
        </div>
      </div>

      {/* Main Content */}
      <div className="ml-56">
        {/* Top Bar with filters */}
        <div className="sticky top-0 z-10 bg-[#0f1117] border-b border-gray-800 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-[#1a1d23] rounded-lg p-1">
                {CHANNELS.map(ch => (
                  <button
                    key={ch}
                    onClick={() => setChannel(ch)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center ${
                      channel === ch ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <ChannelIcon channel={ch} size={14} className="mr-1" />
                    {ch}
                  </button>
                ))}
              </div>
              {/* Business View Toggle */}
              <div className="flex items-center gap-1 bg-[#1a1d23] rounded-lg p-1 border border-gray-700">
                {BUSINESS_VIEWS.map(bv => (
                  <button
                    key={bv.key}
                    onClick={() => setBusinessView(bv.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      businessView === bv.key ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {bv.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-[#1a1d23] rounded-lg p-1">
                {PROGRAMS.map(p => (
                  <button
                    key={p}
                    onClick={() => setProgram(p)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      program === p ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <TimeframeSelector value={dateRange} onChange={setDateRange} />
              <span className="text-xs text-gray-600">{filteredLeads.length} leads</span>
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              <ReviewQueueBanner leads={dateFilteredLeads} onUpdateLead={handleLeadUpdate} onNavigate={(tab) => setActiveTab(tab as MainTab)} />
              <IntegrationHealthBanner />
              <AlertBanner alerts={alerts} />

              {/* Channel-specific content views */}
              {channel === 'YouTube' && <YouTubeTab leads={filteredLeads} videos={youtubeVideos} />}
              {channel === 'Instagram' && <InstagramTab leads={filteredLeads} posts={instagramPosts} manychatData={manychatData} />}
              {channel === 'LinkedIn' && <LinkedInTab leads={filteredLeads} posts={[]} />}
              {channel === 'X' && <XTab leads={filteredLeads} posts={xPosts} />}

              {/* CEO KPI Bar — overarching business metrics */}
              {!isOrganicChannel && (businessView === 'all' || businessView === 'frontend') && (
                <CEOKPIBar leads={dateFilteredLeads} ads={filteredAds} expenses={expenses} backendRevenue={backendRevenue} sheetRevenue={sheetRevenue} onNavigate={(tab, filter) => {
                  if (tab === 'crm') setActiveTab('crm');
                  else if (tab === 'backend') setActiveTab('backend');
                }} />
              )}

              {/* Standard dashboard metrics (shown for All, Paid) */}
              {!isOrganicChannel && (businessView === 'all' || businessView === 'frontend') && (
                <>
                  {/* Top Metrics */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6">
                    <MetricCard label="Total Spend" value={metrics.totalSpend} kpiKey="spend" format="currency" previousValue={prevMetrics.totalSpend} subtitle={`${metrics.totalLeads} leads`} />
                    <MetricCard label="Revenue" value={sheetRevenue && sheetRevenue.newCash > 0 ? sheetRevenue.newCash : metrics.totalRevenue} kpiKey="revenue" format="currency" previousValue={prevMetrics.totalRevenue} subtitle={`${sheetRevenue && sheetRevenue.clientCount > 0 ? sheetRevenue.clientCount : metrics.callsClosed} deals`} />
                    <MetricCard label="ROAS" value={metrics.roas} kpiKey="roas" previousValue={prevMetrics.roas} />
                    <MetricCard label="CPC" value={metrics.cpc} kpiKey="cpc" previousValue={prevMetrics.cpc} />
                    <MetricCard label="CPL" value={metrics.cpl} kpiKey="cpl" previousValue={prevMetrics.cpl} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-8">
                    <MetricCard label="CPQC" value={metrics.cpqc} kpiKey="cpqc" previousValue={prevMetrics.cpqc} />
                    <MetricCard label="Cost for Acquisition" value={metrics.costPerPurchase} kpiKey="costPerPurchase" previousValue={prevMetrics.costPerPurchase} />
                    <MetricCard label="Close Rate" value={metrics.closeRate} kpiKey="closeRate" previousValue={prevMetrics.closeRate} />
                    <MetricCard label="Show Rate" value={metrics.showRate} kpiKey="showRate" previousValue={prevMetrics.showRate} />
                    <MetricCard label="$ Per Call" value={metrics.dollarPerCall} kpiKey="dollarPerCall" previousValue={prevMetrics.dollarPerCall} />
                  </div>

                  {/* Source Performance Snapshot */}
                  {channel === 'All' && (
                    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5 mb-8">
                      <h3 className="text-sm font-semibold text-white mb-4">{'\u{1F4CA}'} Source Performance Snapshot</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-gray-400 text-xs">
                              <th className="text-left py-2 pr-4 font-medium">Source</th>
                              <th className="text-right py-2 px-3 font-medium">Booked</th>
                              <th className="text-right py-2 px-3 font-medium">Showed</th>
                              <th className="text-right py-2 px-3 font-medium">Closed</th>
                              <th className="text-right py-2 px-3 font-medium">Cash Collected</th>
                              <th className="text-right py-2 px-3 font-medium">Cash/Call</th>
                              <th className="text-right py-2 pl-3 font-medium">Contracted Rev</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const snapshotChannels: Channel[] = ['Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral', 'Unknown'];
                              const rows = snapshotChannels.map(ch => {
                                const chLeads = dateFilteredLeads.filter(l => l.source === ch);
                                const booked = chLeads.filter(l => l.demoBooked).length;
                                const showed = chLeads.filter(l => l.showStatus === 'Showed').length;
                                const isWon = (l: typeof chLeads[0]) => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1;
                                const closed = chLeads.filter(isWon).length;
                                const cash = chLeads.filter(isWon).reduce((s, l) => s + l.cashCollected, 0);
                                const contracted = chLeads.filter(isWon).reduce((s, l) => s + l.contractedRevenue, 0);
                                const cashPerCall = showed > 0 ? cash / showed : 0;
                                return { ch, booked, showed, closed, cash, cashPerCall, contracted };
                              });
                              const totals = rows.reduce((acc, r) => ({
                                booked: acc.booked + r.booked,
                                showed: acc.showed + r.showed,
                                closed: acc.closed + r.closed,
                                cash: acc.cash + r.cash,
                                contracted: acc.contracted + r.contracted,
                              }), { booked: 0, showed: 0, closed: 0, cash: 0, contracted: 0 });

                              return (
                                <>
                                  {rows.map(r => (
                                    <tr key={r.ch} className="border-t border-gray-800 hover:bg-gray-800/30">
                                      <td className="py-2 pr-4 flex items-center gap-2">
                                        <ChannelIcon channel={r.ch} size={14} />
                                        <span className="text-gray-300">{r.ch}</span>
                                      </td>
                                      <td className="text-right py-2 px-3 text-gray-300">{r.booked || '-'}</td>
                                      <td className="text-right py-2 px-3 text-gray-300">{r.showed || '-'}</td>
                                      <td className="text-right py-2 px-3 text-gray-300">{r.closed || '-'}</td>
                                      <td className={`text-right py-2 px-3 ${r.cash > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {r.cash > 0 ? `$${r.cash.toLocaleString()}` : '-'}
                                      </td>
                                      <td className={`text-right py-2 px-3 ${r.cashPerCall > 0 ? 'text-yellow-400' : 'text-gray-500'}`}>
                                        {r.cashPerCall > 0 ? `$${r.cashPerCall.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                                      </td>
                                      <td className={`text-right py-2 pl-3 ${r.contracted > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {r.contracted > 0 ? `$${r.contracted.toLocaleString()}` : '-'}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-gray-600 font-bold">
                                    <td className="py-2 pr-4 text-white">TOTAL</td>
                                    <td className="text-right py-2 px-3 text-white">{totals.booked}</td>
                                    <td className="text-right py-2 px-3 text-white">{totals.showed}</td>
                                    <td className="text-right py-2 px-3 text-white">{totals.closed}</td>
                                    <td className="text-right py-2 px-3 text-emerald-400 font-bold">${totals.cash.toLocaleString()}</td>
                                    <td className="text-right py-2 px-3 text-yellow-400 font-bold">${totals.showed > 0 ? (totals.cash / totals.showed).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'}</td>
                                    <td className="text-right py-2 pl-3 text-emerald-400 font-bold">${totals.contracted.toLocaleString()}</td>
                                  </tr>
                                </>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Charts */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    <TrendChart data={dateFilteredDailyMetrics} metric="spend" label="Daily Spend" color="#ef4444" />
                    <TrendChart data={dateFilteredDailyMetrics} metric="revenue" label="Daily Revenue" color="#10b981" />
                    <TrendChart data={dateFilteredDailyMetrics} metric="leads" label="Daily Leads" color="#3b82f6" />
                  </div>

                  {/* Weekly Comparison */}
                  <div className="mb-8">
                    <WeeklyComparison leads={filteredLeads} ads={filteredAds} dailyMetrics={dateFilteredDailyMetrics} />
                  </div>

                  {/* Quick Stats */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
                      <h3 className="text-sm font-semibold text-white mb-4">Top Closers</h3>
                      <div className="space-y-3">
                        {getCloserStats(filteredLeads).sort((a, b) => b.revenue - a.revenue).slice(0, 5).map(c => (
                          <div key={c.name} className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">{c.name}</p>
                              <p className="text-xs text-gray-500">{c.totalCalls} calls | {c.closedDeals} closed</p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-emerald-400">${c.revenue.toLocaleString()}</p>
                              <p className="text-xs text-gray-500">{c.totalCalls > 0 ? ((c.closedDeals / c.totalCalls) * 100).toFixed(0) : 0}% close rate</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
                      <h3 className="text-sm font-semibold text-white mb-4">Recent Closes</h3>
                      <div className="space-y-3">
                        {filteredLeads.filter(l => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(l => (
                          <div key={l.id} className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">{l.name}</p>
                              <p className="text-xs text-gray-500">{l.source} · {l.program} · {l.assignedCloser}</p>
                            </div>
                            <span className="text-sm font-bold text-emerald-400">${l.cashCollected.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Back-End Business view on dashboard when toggled */}
              {!isOrganicChannel && (businessView === 'backend') && (
                <BackEndTab mondayClients={mondayClients} />
              )}
            </>
          )}

          {/* Data Reports (formerly Ad Tracking) */}
          {activeTab === 'reports' && (
            <SourceTable
              leads={filteredLeads}
              ads={filteredAds}
              onViewLeads={(leads, title) => setLeadModalData({ leads, title })}
            />
          )}

          {/* CRM Tab — direct Supabase mirror (t06 / t01 / t03), self-fetching */}
          {activeTab === 'crm' && <CRMTab />}

          {/* Closers Tab */}
          {activeTab === 'closers' && (
            <div className="space-y-6">
              <CloserBreakdown
                leads={filteredLeads}
                ads={filteredAds}
                onViewLeads={(closer) => setLeadModalData({
                  leads: filteredLeads.filter(l => l.assignedCloser === closer && l.showStatus === 'Showed'),
                  title: `Calls for: ${closer}`,
                })}
                dateRange={dateRange}
              />
              <EODReportsView leads={filteredLeads} />
            </div>
          )}

          {/* Sales Calls Tab — every Grain call w/ quality analysis */}
          {activeTab === 'sales-calls' && <SalesCallsTab />}

          {/* Commissions Tab — per-person auto-calculated payout */}
          {activeTab === 'commissions' && <CommissionsTab />}

          {/* Billing Tab */}
          {activeTab === 'billing' && <BillingTracker />}

          {/* Expenses Tab (Mercury transactions) */}
          {activeTab === 'expenses-mercury' && <ExpensesTab />}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && <IntegrationsTab />}

          {activeTab === 'system-health' && <SystemHealthTab leads={allLeads} />}

          {/* Competitor Tracker */}
          {activeTab === 'competitors' && <CompetitorTracker />}
        </div>
      </div>

      {/* AI Chat Panel */}
      <AIChatPanel activeTab={activeTab} />

      {/* Lead Journey Modal */}
      <LeadJourneyModal lead={journeyLead} onClose={() => setJourneyLead(null)} />

      {/* Call Detail Side Panel */}
      <CallDetailPanel
        lead={callPanelLead}
        onClose={() => setCallPanelLeadId(null)}
        onUpdateLead={handleLeadUpdate}
        onOpenJourney={(l) => {
          setCallPanelLeadId(null);
          setJourneyLead(l);
        }}
      />

      {/* Lead Detail Modal */}
      {leadModalData && (
        <DrillDownModal
          isOpen={true}
          onClose={() => setLeadModalData(null)}
          title={leadModalData.title}
          subtitle={`${leadModalData.leads.length} leads`}
        >
          <LeadDetail leads={leadModalData.leads} title={leadModalData.title} onOpenLead={(lead) => { setLeadModalData(null); setJourneyLead(lead); }} />
        </DrillDownModal>
      )}
    </div>
  );
}
