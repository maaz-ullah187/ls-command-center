'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Lead, Channel } from '@/lib/types';
import { AlertTriangle, ChevronDown, ChevronUp, Check, X, Search, ExternalLink, Loader2, FileX2, Plus, MessageSquare } from 'lucide-react';
import ChannelIcon from './ChannelIcon';
import Select from './Select';
import PingButton from './PingButton';
import type { MissingEod, EodAnomaly } from '@/app/api/data/missing-eods/route';

interface MissingBillingRow {
  id: string;
  date: string;
  amount: number;
  email: string | null;
  name: string | null;
  paymentType: string | null;
  offer: string | null;
  closer: string | null;
  source: string;
}

interface MissingExpenseRow {
  id: string;
  date: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  expenseType: string | null;
  card: string | null;
}

interface NeedsReviewBookingRow {
  id: string;
  dateBookedFor: string;
  name: string | null;
  email: string | null;
  closer: string | null;
  offer: string | null;
  contactLink: string | null;
}

interface ReviewQueueBannerProps {
  leads: Lead[];
  onUpdateLead: (leadId: string, updates: Partial<Lead>) => void;
  onNavigate?: (tab: string) => void;
}

const SOURCE_OPTIONS: Channel[] = ['Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X', 'Referral'];

// 'missingQuality' and 'revenueFlags' are removed per the spec 2026-04-28.
// Revenue flags merged into 'dataAnomalies' as a unified anomalies tab.
// 'unreviewedApplicants' bucket was added 2026-05-01 then removed
// 2026-05-02 — the operator clarified that wasn't the right surface for it.
type TabId = 'unknownSource' | 'unloggedCalls' | 'dataAnomalies' | 'missingEods' | 'missingBilling' | 'missingExpense';

interface DataAnomaly {
  leadId: string;
  leadName: string;
  email: string;
  date: string;
  issue: string;
  ghlContactId: string;
  ghlContactUrl?: string;
}

interface RevenueFlag {
  leadId: string;
  leadName: string;
  email: string;
  date: string;
  issue: string;
  issueType: 'zero_cash_close' | 'cash_no_close' | 'unverified_cash';
  cashCollected: number;
  contractedRevenue: number;
  stage: string;
  ghlContactId: string;
  ghlContactUrl?: string;
}

/**
 * Daily review banner that lives at the top of the Dashboard.
 * Surfaces three buckets of data that need human attention:
 *   1. Leads with unknown/missing source
 *   2. Calls that showed but have no outcome logged
 *   3. Closed leads without a quality score
 * Inline quick-edit so items get cleared without leaving the dashboard.
 */
export default function ReviewQueueBanner({ leads, onUpdateLead, onNavigate }: ReviewQueueBannerProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('unknownSource');
  const [search, setSearch] = useState('');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [missingEods, setMissingEods] = useState<MissingEod[]>([]);
  const [eodAnomalies, setEodAnomalies] = useState<EodAnomaly[]>([]);
  const [dismissedEods, setDismissedEods] = useState<Set<string>>(new Set());
  const [missingBilling, setMissingBilling] = useState<MissingBillingRow[]>([]);
  const [missingExpense, setMissingExpense] = useState<MissingExpenseRow[]>([]);
  const [needsReviewBookings, setNeedsReviewBookings] = useState<NeedsReviewBookingRow[]>([]);
  const [dismissedRowIds, setDismissedRowIds] = useState<Set<string>>(new Set());
  const [fillInTarget, setFillInTarget] = useState<{ closer: string; date: string } | null>(null);
  const [eodRefreshKey, setEodRefreshKey] = useState(0);
  const [crossCardAnomalies, setCrossCardAnomalies] = useState<Array<{
    kind: string;
    issue: string;
    delta: number;
  }>>([]);
  // Per-deal t06 anomalies (cash > contracted, blank source, etc.) — surface
  // in Data Anomalies so closer-typo rows like Sample Lead 4's $50k-on-a-$5k-
  // contract get caught instead of silently inflating Cash by Source.
  // the operator 2026-04-29.
  const [t06Anomalies, setT06Anomalies] = useState<Array<{
    dealId: string;
    customerName: string;
    customerEmail: string | null;
    date: string;
    issue: string;
    suggestedFix: string | null;
    closer: string | null;
  }>>([]);

  // Cross-card mismatch detector — flags net AND per-bucket mismatches
  // (refunds, AR, new cash, renewals/upsells, mastermind) between the sheet,
  // Revenue Composition, and Cash by Source. Each anomaly surfaces as its own
  // SYSTEM row at the top of the Data Anomalies tab.
  useEffect(() => {
    fetch('/api/data/cross-card-check')
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok === false && Array.isArray(data?.anomalies)) {
          setCrossCardAnomalies(
            data.anomalies.map((a: any) => ({
              kind: a.kind,
              issue: a.issue,
              delta: a.delta,
            }))
          );
        } else {
          setCrossCardAnomalies([]);
        }
      })
      .catch(() => {});

    fetch('/api/data/t06-anomalies')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.rows)) {
          setT06Anomalies(
            data.rows.map((a: any) => ({
              dealId: a.dealId,
              customerName: a.customerName,
              customerEmail: a.customerEmail,
              date: a.date,
              issue: a.issue,
              suggestedFix: a.suggestedFix,
              closer: a.closer,
            }))
          );
        } else {
          setT06Anomalies([]);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch missing EOD reports + anomalies from Supabase
  useEffect(() => {
    fetch('/api/data/missing-eods')
      .then((r) => r.json())
      .then((data) => {
        if (data?.missing) setMissingEods(data.missing);
        if (data?.anomalies) setEodAnomalies(data.anomalies);
      })
      .catch(() => {});
  }, [eodRefreshKey]);

  // Fetch missing-billing-type and missing-expense-type buckets (Phase 0.3).
  // Also subscribe to the billing:categorized / expense:categorized events
  // so when ANY user (the operator OR Catherine on her own laptop) categorizes
  // a row, every other open dashboard updates without a manual refresh.
  useEffect(() => {
    const cb = `?_t=${Date.now()}`;
    const loadBilling = () => fetch(`/api/data/missing-billing-types${cb}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.rows)) setMissingBilling(data.rows); })
      .catch(() => {});
    const loadExpense = () => fetch(`/api/data/missing-expense-types${cb}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.rows)) setMissingExpense(data.rows); })
      .catch(() => {});
    const loadBookings = () => fetch(`/api/data/needs-review-bookings${cb}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.rows)) setNeedsReviewBookings(data.rows); })
      .catch(() => {});

    loadBilling();
    loadExpense();
    loadBookings();

    const onBilling = () => loadBilling();
    const onExpense = () => loadExpense();
    window.addEventListener('billing:categorized', onBilling);
    window.addEventListener('expense:categorized', onExpense);

    // Poll every 30s while the tab is visible — catches edits from other
    // users (different browser sessions) without needing a websocket.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadBilling();
        loadExpense();
        loadBookings();
      }
    }, 30_000);

    return () => {
      window.removeEventListener('billing:categorized', onBilling);
      window.removeEventListener('expense:categorized', onExpense);
      clearInterval(interval);
    };
  }, [eodRefreshKey]);

  const activeMissingBilling = useMemo(
    () => missingBilling.filter((r) => !dismissedRowIds.has(`billing-${r.id}`)),
    [missingBilling, dismissedRowIds]
  );

  const activeMissingExpense = useMemo(
    () => missingExpense.filter((r) => !dismissedRowIds.has(`expense-${r.id}`)),
    [missingExpense, dismissedRowIds]
  );

  const activeMissingEods = useMemo(
    () => missingEods.filter((e) => !dismissedEods.has(`${e.date}|${e.closer}`)),
    [missingEods, dismissedEods]
  );

  const activeEodAnomalies = useMemo(
    () => eodAnomalies.filter((a) => !dismissedEods.has(`anomaly-${a.id}-${a.field}`)),
    [eodAnomalies, dismissedEods]
  );

  const totalEodIssues = activeMissingEods.length + activeEodAnomalies.length;

  // Bucket 1: leads with unknown/missing source.
  // Date floor (April 2026+) per the spec 2026-04-30: pre-April leads are
  // historical noise the team isn't going to fix. Keep the queue focused on
  // recent rows where attribution can still be recovered.
  const unknownSourceLeads = useMemo(
    () => leads.filter((l) =>
      (l.source === 'Unknown' || !l.source)
      && (l.date ?? '') >= '2026-04-01'
      && !dismissedIds.has(l.id)
    ),
    [leads, dismissedIds]
  );

  // 2026-05-02: Unreviewed Applicants bucket removed (the operator clarified
  // that wasn't the right surface for it).

  // Bucket 2: bookings with status='Needs Review' — the team needs to mark
  // them as Showed / No Showed / Rescheduled / Cancelled. Source: t03_bookings.
  // Replaces the older lead-level "demoBooked + Showed + no outcome" check.
  const activeNeedsReview = useMemo(
    () => needsReviewBookings.filter((b) => !dismissedRowIds.has(`booking-${b.id}`)),
    [needsReviewBookings, dismissedRowIds]
  );

  // Bucket 3: data anomalies — impossible/suspicious metrics + revenue flags
  // (revenue flags merged in per the spec 2026-04-28)
  const dataAnomalies = useMemo(() => {
    const anomalies: DataAnomaly[] = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const emailToLeads = new Map<string, Lead[]>();

    // 0. System-level: cross-card revenue mismatches (always at the top)
    for (const cc of crossCardAnomalies) {
      const id = `__cross_card_${cc.kind}__`;
      if (dismissedIds.has(id)) continue;
      anomalies.push({
        leadId: id,
        leadName: 'SYSTEM — Revenue source mismatch',
        email: '',
        date: new Date().toISOString().slice(0, 10),
        issue: cc.issue,
        ghlContactId: '',
        ghlContactUrl: undefined,
      });
    }

    // 0a. Per-deal t06 anomalies (cash > contracted, missing source, etc.)
    // These come from /api/data/t06-anomalies and represent specific deals
    // where a closer mistyped a value when posting in #new-clients.
    for (const ta of t06Anomalies) {
      const id = `__t06_${ta.dealId}__`;
      if (dismissedIds.has(id)) continue;
      anomalies.push({
        leadId: id,
        leadName: ta.customerName + (ta.closer ? ` (closer: ${ta.closer})` : ''),
        email: ta.customerEmail ?? '',
        date: ta.date,
        issue: ta.suggestedFix ? `${ta.issue} — ${ta.suggestedFix}` : ta.issue,
        ghlContactId: '',
        ghlContactUrl: undefined,
      });
    }

    for (const lead of leads) {
      if (dismissedIds.has(lead.id)) continue;

      // 1. Show rate > 100% — more "Showed" than "Booked" (shouldn't be possible)
      if (lead.showStatus === 'Showed' && !lead.demoBooked) {
        anomalies.push({
          leadId: lead.id,
          leadName: lead.name,
          email: lead.email,
          date: lead.date,
          issue: 'Show rate anomaly: marked as Showed but no demo was booked',
          ghlContactId: lead.ghlContactId,
          ghlContactUrl: lead.ghlContactUrl,
        });
      }

      // 2. Negative cash collected
      if (lead.cashCollected < 0) {
        anomalies.push({
          leadId: lead.id,
          leadName: lead.name,
          email: lead.email,
          date: lead.date,
          issue: `Negative cash collected: $${lead.cashCollected.toLocaleString()}`,
          ghlContactId: lead.ghlContactId,
          ghlContactUrl: lead.ghlContactUrl,
        });
      }

      // 3. $0 or $1 closes — likely test transactions
      if (lead.callOutcome === 'Closed Won' && lead.cashCollected <= 1) {
        anomalies.push({
          leadId: lead.id,
          leadName: lead.name,
          email: lead.email,
          date: lead.date,
          issue: `Suspicious close: Closed Won with $${lead.cashCollected} cash (likely test transaction)`,
          ghlContactId: lead.ghlContactId,
          ghlContactUrl: lead.ghlContactUrl,
        });
      }

      // 4. Future dates
      if (lead.date) {
        const leadDate = new Date(lead.date);
        if (leadDate > today) {
          anomalies.push({
            leadId: lead.id,
            leadName: lead.name,
            email: lead.email,
            date: lead.date,
            issue: `Future date: lead date is ${lead.date} (in the future)`,
            ghlContactId: lead.ghlContactId,
            ghlContactUrl: lead.ghlContactUrl,
          });
        }
      }

      // Build email index for duplicate detection
      if (lead.email) {
        const key = lead.email.toLowerCase().trim();
        if (!emailToLeads.has(key)) emailToLeads.set(key, []);
        emailToLeads.get(key)!.push(lead);
      }
    }

    // 5. Duplicate leads — same email, different GHL contact IDs
    for (const [email, dupes] of emailToLeads) {
      const uniqueGhlIds = new Set(dupes.map((l) => l.ghlContactId).filter(Boolean));
      if (uniqueGhlIds.size > 1) {
        // Only flag the duplicates beyond the first occurrence
        for (let i = 1; i < dupes.length; i++) {
          const lead = dupes[i];
          anomalies.push({
            leadId: lead.id,
            leadName: lead.name,
            email: lead.email,
            date: lead.date,
            issue: `Duplicate lead: ${email} appears ${dupes.length} times with different GHL contact IDs`,
            ghlContactId: lead.ghlContactId,
            ghlContactUrl: lead.ghlContactUrl,
          });
        }
      }
    }

    // ── Revenue-flag patterns (merged into Data Anomalies per the spec 2026-04-28) ──
    for (const lead of leads) {
      if (dismissedIds.has(lead.id)) continue;

      // 6. Closed Won but $0 cash — payment didn't match
      if (
        (lead.callOutcome === 'Closed Won' || lead.stage === 'Closed Won') &&
        (lead.cashCollected ?? 0) === 0
      ) {
        anomalies.push({
          leadId: lead.id,
          leadName: lead.name,
          email: lead.email,
          date: lead.date,
          issue: 'Revenue: Closed Won with $0 cash — payment not matched',
          ghlContactId: lead.ghlContactId,
          ghlContactUrl: lead.ghlContactUrl,
        });
      }

      // 7. Cash collected without close status
      if (
        (lead.cashCollected ?? 0) > 0 &&
        lead.stage !== 'Closed Won' &&
        lead.callOutcome !== 'Closed Won'
      ) {
        anomalies.push({
          leadId: lead.id,
          leadName: lead.name,
          email: lead.email,
          date: lead.date,
          issue: `Revenue: $${(lead.cashCollected ?? 0).toLocaleString()} collected but stage is "${lead.stage}"`,
          ghlContactId: lead.ghlContactId,
          ghlContactUrl: lead.ghlContactUrl,
        });
      }

      // 8. Unverified cash from Whop/Slack but not in sheet
      if (
        (lead.cashCollected ?? 0) > 1 &&
        (lead.stage === 'Closed Won' || lead.callOutcome === 'Closed Won') &&
        !(lead as any).sheetVerified
      ) {
        anomalies.push({
          leadId: lead.id,
          leadName: lead.name,
          email: lead.email,
          date: lead.date,
          issue: `Revenue: $${(lead.cashCollected ?? 0).toLocaleString()} from Whop/Slack not in Client Payment Log sheet`,
          ghlContactId: lead.ghlContactId,
          ghlContactUrl: lead.ghlContactUrl,
        });
      }
    }

    return anomalies;
  }, [leads, dismissedIds, crossCardAnomalies, t06Anomalies]);

  const totalIssues = unknownSourceLeads.length + activeNeedsReview.length + dataAnomalies.length + totalEodIssues + activeMissingBilling.length + activeMissingExpense.length;

  // Must be before early return to preserve hook order
  const filteredAnomalies = useMemo(() => {
    if (activeTab !== 'dataAnomalies') return [];
    if (!search) return dataAnomalies;
    const q = search.toLowerCase();
    return dataAnomalies.filter(
      (a: any) =>
        (a.leadName || '').toLowerCase().includes(q) ||
        (a.email || '').toLowerCase().includes(q) ||
        (a.issue || '').toLowerCase().includes(q)
    );
  }, [activeTab, dataAnomalies, search]);

  // (revenueFlags merged into dataAnomalies — separate filter no longer needed)

  if (totalIssues === 0) {
    return (
      <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <Check size={18} className="text-emerald-400" />
          <div>
            <p className="text-emerald-400 font-semibold text-sm">All clean — no data needs review today</p>
            <p className="text-emerald-500/70 text-xs mt-0.5">
              Every lead has a source, every showed call has an outcome, every close has a quality score, no data anomalies, revenue discrepancies, or missing EOD reports.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeLeads =
    activeTab === 'unknownSource'
      ? unknownSourceLeads
      : []; // unloggedCalls + dataAnomalies tabs use their own rendering

  // filteredAnomalies is computed before the early return (hook order)

  const filteredActive = search
    ? activeLeads.filter(
        (l) =>
          l.name.toLowerCase().includes(search.toLowerCase()) ||
          l.email.toLowerCase().includes(search.toLowerCase())
      )
    : activeLeads;

  return (
    <div className="bg-gradient-to-br from-amber-950/40 to-red-950/30 border border-amber-800/50 rounded-xl mb-6 overflow-hidden shadow-lg">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-amber-950/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-amber-400" />
          </div>
          <div className="text-left">
            <h3 className="text-white font-bold text-sm flex items-center gap-2">
              Daily Review Queue
              <span className="bg-amber-500 text-amber-950 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {totalIssues} ITEMS
              </span>
            </h3>
            <p className="text-amber-300/80 text-xs mt-0.5">
              Clear these to keep your data accurate. Don&apos;t fly blind.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-3 text-xs">
            {unknownSourceLeads.length > 0 && (
              <span className="text-amber-300">
                <strong className="text-amber-200">{unknownSourceLeads.length}</strong> unknown source
              </span>
            )}
            {activeNeedsReview.length > 0 && (
              <span className="text-amber-300">
                <strong className="text-amber-200">{activeNeedsReview.length}</strong> unlogged calls
              </span>
            )}
            {dataAnomalies.length > 0 && (
              <span className="text-red-300">
                <strong className="text-red-200">{dataAnomalies.length}</strong> anomalies
              </span>
            )}
            {totalEodIssues > 0 && (
              <span className="text-purple-300">
                <strong className="text-purple-200">{totalEodIssues}</strong> EOD issues
              </span>
            )}
            {activeMissingBilling.length > 0 && (
              <span className="text-cyan-300">
                <strong className="text-cyan-200">{activeMissingBilling.length}</strong> uncategorized billing
              </span>
            )}
            {activeMissingExpense.length > 0 && (
              <span className="text-cyan-300">
                <strong className="text-cyan-200">{activeMissingExpense.length}</strong> uncategorized expense
              </span>
            )}
          </div>
          {expanded ? (
            <ChevronUp size={18} className="text-amber-300" />
          ) : (
            <ChevronDown size={18} className="text-amber-300" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-amber-900/40">
          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 pt-3 border-b border-amber-900/40">
            <TabButton
              active={activeTab === 'unknownSource'}
              label="Unknown Source"
              count={unknownSourceLeads.length}
              onClick={() => setActiveTab('unknownSource')}
            />
            <TabButton
              active={activeTab === 'unloggedCalls'}
              label="Unlogged Calls"
              count={activeNeedsReview.length}
              onClick={() => setActiveTab('unloggedCalls')}
            />
            <TabButton
              active={activeTab === 'dataAnomalies'}
              label="Data Anomalies"
              count={dataAnomalies.length}
              onClick={() => setActiveTab('dataAnomalies')}
              variant="danger"
            />
            <TabButton
              active={activeTab === 'missingEods'}
              label="EOD Issues"
              count={totalEodIssues}
              onClick={() => setActiveTab('missingEods')}
              variant="purple"
            />
            <TabButton
              active={activeTab === 'missingBilling'}
              label="Uncategorized Billing"
              count={activeMissingBilling.length}
              onClick={() => setActiveTab('missingBilling')}
              variant="cyan"
            />
            <TabButton
              active={activeTab === 'missingExpense'}
              label="Uncategorized Expense"
              count={activeMissingExpense.length}
              onClick={() => setActiveTab('missingExpense')}
              variant="cyan"
            />
            <div className="ml-auto relative mb-2">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-black/30 border border-amber-900/40 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-500 w-56"
              />
            </div>
          </div>

          {/* Table */}
          <div className="max-h-96 overflow-y-auto">
            {activeTab === 'missingEods' ? (
              /* EOD Issues tab — missing reports + anomalies */
              totalEodIssues === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  All closers submitted their EOD reports and no anomalies detected <span className="text-emerald-400">&#10003;</span>
                </div>
              ) : (
                <>
                  {activeMissingEods.length > 0 && (
                    <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-amber-900/40 bg-black/10">
                      <CopyEodsToSheetButton rows={activeMissingEods} />
                      <BulkPasteEodsButton onApplied={() => setEodRefreshKey((k) => k + 1)} />
                    </div>
                  )}
                  <table className="w-full text-xs">
                    <thead className="bg-black/20 sticky top-0 backdrop-blur-sm">
                      <tr className="text-[10px] text-gray-500 uppercase border-b border-amber-900/40">
                        <th className="text-left py-2 px-4">Date</th>
                        <th className="text-left py-2 px-4">Closer</th>
                        <th className="text-left py-2 px-4">Issue</th>
                        <th className="text-center py-2 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Missing EODs */}
                      {activeMissingEods.map((eod) => (
                        <tr
                          key={`missing-${eod.date}|${eod.closer}`}
                          className="border-b border-amber-900/20 hover:bg-black/20 transition-colors"
                        >
                          <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{eod.dayLabel}</td>
                          <td className="py-2 px-4 text-white font-medium">{eod.closer}</td>
                          <td className="py-2 px-4">
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-purple-950/40 border border-purple-800/30 text-[11px] text-purple-300">
                              <FileX2 size={10} className="text-purple-400 shrink-0" />
                              EOD report not submitted
                            </span>
                          </td>
                          <td className="py-2 px-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setFillInTarget({ closer: eod.closer, date: eod.date })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium transition-colors bg-purple-900/40 border-purple-700/50 text-purple-300 hover:bg-purple-800/50"
                                title="Fill in this EOD report now"
                              >
                                <Plus size={10} />
                                Fill In
                              </button>
                              <ExcuseEodButton
                                closer={eod.closer}
                                date={eod.date}
                                onExcused={() => {
                                  setDismissedEods((prev) => new Set(prev).add(`${eod.date}|${eod.closer}`));
                                  setEodRefreshKey((k) => k + 1);
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                      {/* EOD Anomalies */}
                      {activeEodAnomalies.map((anomaly) => (
                        <tr
                          key={`anomaly-${anomaly.id}-${anomaly.field}`}
                          className={`border-b border-amber-900/20 hover:bg-black/20 transition-colors ${
                            anomaly.severity === 'critical' ? 'bg-red-950/10' : ''
                          }`}
                        >
                          <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{anomaly.dayLabel}</td>
                          <td className="py-2 px-4 text-white font-medium">{anomaly.closer}</td>
                          <td className="py-2 px-4">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] ${
                              anomaly.severity === 'critical'
                                ? 'bg-red-950/40 border-red-800/30 text-red-300'
                                : 'bg-amber-950/40 border-amber-800/30 text-amber-300'
                            }`}>
                              <AlertTriangle size={10} className="shrink-0" />
                              {anomaly.fieldLabel}: ${anomaly.value.toLocaleString()}
                              <span className="text-[9px] opacity-70">
                                ({anomaly.multiplier}× median ${anomaly.median.toLocaleString()})
                              </span>
                            </span>
                          </td>
                          <td className="py-2 px-4">
                            <div className="flex items-center justify-center gap-2">
                              {onNavigate && (
                                <button
                                  onClick={() => onNavigate('closers')}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium transition-colors bg-amber-900/40 border-amber-700/50 text-amber-300 hover:bg-amber-800/50"
                                  title="Review in EOD Reports"
                                >
                                  Review
                                </button>
                              )}
                              <ExcuseEodAnomalyButton
                                anomalyId={anomaly.id}
                                field={anomaly.field}
                                onExcused={() => {
                                  setDismissedEods((prev) =>
                                    new Set(prev).add(`anomaly-${anomaly.id}-${anomaly.field}`)
                                  );
                                  setEodRefreshKey((k) => k + 1);
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )
            ) : activeTab === 'missingBilling' ? (
              activeMissingBilling.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  All payment rows have a payment_type and offer set <span className="text-emerald-400">&#10003;</span>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-black/20 sticky top-0 backdrop-blur-sm">
                    <tr className="text-[10px] text-gray-500 uppercase border-b border-amber-900/40">
                      <th className="text-left py-2 px-4">Date</th>
                      <th className="text-left py-2 px-4">Customer</th>
                      <th className="text-right py-2 px-4">Amount</th>
                      <th className="text-left py-2 px-4">Closer</th>
                      <th className="text-left py-2 px-4">Source</th>
                      <th className="text-left py-2 px-4">Set Type</th>
                      <th className="text-center py-2 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMissingBilling.slice(0, 50).map((row) => (
                      <UncategorizedBillingRow
                        key={row.id}
                        row={row}
                        onCategorized={() => setDismissedRowIds((prev) => new Set(prev).add(`billing-${row.id}`))}
                        onDismiss={() => setDismissedRowIds((prev) => new Set(prev).add(`billing-${row.id}`))}
                      />
                    ))}
                  </tbody>
                </table>
              )
            ) : activeTab === 'missingExpense' ? (
              activeMissingExpense.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  All expense rows have an expense_type set <span className="text-emerald-400">&#10003;</span>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-black/20 sticky top-0 backdrop-blur-sm">
                    <tr className="text-[10px] text-gray-500 uppercase border-b border-amber-900/40">
                      <th className="text-left py-2 px-4">Date</th>
                      <th className="text-left py-2 px-4">Vendor</th>
                      <th className="text-right py-2 px-4">Amount</th>
                      <th className="text-left py-2 px-4">Description</th>
                      <th className="text-left py-2 px-4">Card</th>
                      <th className="text-center py-2 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMissingExpense.slice(0, 50).map((row) => (
                      <UncategorizedExpenseRow
                        key={row.id}
                        row={row}
                        onCategorized={() => setDismissedRowIds((prev) => new Set(prev).add(`expense-${row.id}`))}
                        onDismiss={() => setDismissedRowIds((prev) => new Set(prev).add(`expense-${row.id}`))}
                      />
                    ))}
                  </tbody>
                </table>
              )
            ) : activeTab === 'unloggedCalls' ? (
              /* Unlogged Calls — t03_bookings.status='Needs Review' rows */
              activeNeedsReview.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  All bookings have a resolved status <span className="text-emerald-400">✓</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-end px-4 py-2 border-b border-amber-900/40 bg-black/10">
                    <CopyToSheetButton rows={activeNeedsReview} />
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-black/20 sticky top-0 backdrop-blur-sm">
                      <tr className="text-[10px] text-gray-500 uppercase border-b border-amber-900/40">
                        <th className="text-left py-2 px-4">Booking Date</th>
                        <th className="text-left py-2 px-4">Lead</th>
                        <th className="text-left py-2 px-4">Closer</th>
                        <th className="text-left py-2 px-4">Offer</th>
                        <th className="text-center py-2 px-4">Set Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeNeedsReview.slice(0, 100).map((b) => (
                        <NeedsReviewRow
                          key={b.id}
                          row={b}
                          onResolved={() => setDismissedRowIds((prev) => new Set(prev).add(`booking-${b.id}`))}
                        />
                      ))}
                    </tbody>
                  </table>
                </>
              )
            ) : activeTab === 'dataAnomalies' ? (
              /* Data Anomalies tab — custom rendering */
              filteredAnomalies.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  {search ? 'No matches' : 'No data anomalies detected '}
                  {!search && <span className="text-emerald-400">✓</span>}
                </div>
              ) : (
                <>
                  <table className="w-full text-xs">
                    <thead className="bg-black/20 sticky top-0 backdrop-blur-sm">
                      <tr className="text-[10px] text-gray-500 uppercase border-b border-amber-900/40">
                        <th className="text-left py-2 px-4">Date</th>
                        <th className="text-left py-2 px-4">Lead</th>
                        <th className="text-left py-2 px-4">Issue</th>
                        <th className="text-center py-2 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAnomalies.slice(0, 50).map((anomaly, idx) => (
                        <AnomalyRow
                          key={`${anomaly.leadId}-${idx}`}
                          anomaly={anomaly}
                          onDismiss={() => setDismissedIds((prev) => new Set(prev).add(anomaly.leadId))}
                        />
                      ))}
                    </tbody>
                  </table>
                  {filteredAnomalies.length > 50 && (
                    <p className="text-center text-xs text-gray-500 py-3">
                      Showing 50 of {filteredAnomalies.length}. Clear these first.
                    </p>
                  )}
                </>
              )
            ) : (
              /* Standard buckets */
              <>
                {filteredActive.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    {search ? 'No matches' : 'Nothing to review in this bucket '}
                    {!search && <span className="text-emerald-400">✓</span>}
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-black/20 sticky top-0 backdrop-blur-sm">
                      <tr className="text-[10px] text-gray-500 uppercase border-b border-amber-900/40">
                        <th className="text-left py-2 px-4">Date</th>
                        <th className="text-left py-2 px-4">Lead</th>
                        <th className="text-left py-2 px-4">Current Source</th>
                        <th className="text-left py-2 px-4">Campaign Hint</th>
                        {activeTab === 'unknownSource' && (
                          <th className="text-left py-2 px-4">Assign Source</th>
                        )}
                        <th className="text-center py-2 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredActive.slice(0, 50).map((lead) => (
                        <ReviewRow
                          key={lead.id}
                          lead={lead}
                          tab={activeTab}
                          onUpdateLead={onUpdateLead}
                          onDismiss={() => setDismissedIds((prev) => new Set(prev).add(lead.id))}
                        />
                      ))}
                    </tbody>
                  </table>
                )}

                {filteredActive.length > 50 && (
                  <p className="text-center text-xs text-gray-500 py-3">
                    Showing 50 of {filteredActive.length}. Clear these first.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Inline fill-in modal for missing EODs */}
      {fillInTarget && (
        <InlineEodModal
          closer={fillInTarget.closer}
          date={fillInTarget.date}
          onClose={() => setFillInTarget(null)}
          onSaved={() => {
            setFillInTarget(null);
            setEodRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

/** Inline row for the Uncategorized Billing tab — lets the team set the
 *  payment_type bucket directly without leaving the dashboard. Writes through
 *  /api/billing/categorize which mirrors to t07_income_processors. */
function UncategorizedBillingRow({
  row,
  onCategorized,
  onDismiss,
}: {
  row: MissingBillingRow;
  onCategorized: () => void;
  onDismiss: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setType = async (bucket: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: row.id, paymentType: bucket }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onCategorized();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setSaving(false);
    }
  };

  const BUCKETS: Array<{ value: string; label: string; cls: string }> = [
    { value: 'new_client',         label: 'New',       cls: 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300 hover:bg-emerald-800/50' },
    { value: 'account_receivable', label: 'AR',        cls: 'bg-orange-900/40 border-orange-700/50 text-orange-300 hover:bg-orange-800/50' },
    { value: 'upsell_renewal',     label: 'Upsell/Ren', cls: 'bg-amber-900/40 border-amber-700/50 text-amber-300 hover:bg-amber-800/50' },
    { value: 'mastermind',         label: 'M-mind',    cls: 'bg-purple-900/40 border-purple-700/50 text-purple-300 hover:bg-purple-800/50' },
    { value: 'refund',             label: 'Refund',    cls: 'bg-red-900/40 border-red-700/50 text-red-300 hover:bg-red-800/50' },
    // 'excluded' = the operator's "Remove" path: payment landed in our processor
    // but shouldn't have (wrong business / mis-routed wire / test charge).
    // Keeps audit trail in t07 but every revenue card filters this bucket out.
    { value: 'excluded',           label: 'Remove',    cls: 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700' },
  ];

  return (
    <tr className="border-b border-amber-900/20 hover:bg-black/20">
      <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{row.date}</td>
      <td className="py-2 px-4 text-white font-medium">{row.name ?? row.email ?? '—'}</td>
      <td className="py-2 px-4 text-right text-emerald-300">${row.amount.toLocaleString()}</td>
      <td className="py-2 px-4 text-gray-300">{row.closer ?? '—'}</td>
      <td className="py-2 px-4 text-gray-400 capitalize">{row.source}</td>
      <td className="py-2 px-4">
        <div className="flex items-center gap-1 flex-wrap">
          {BUCKETS.map((b) => (
            <button
              key={b.value}
              disabled={saving}
              onClick={() => setType(b.value)}
              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-medium transition-colors disabled:opacity-50 ${b.cls}`}
              title={`Set to ${b.label}`}
            >
              {b.label}
            </button>
          ))}
          {error && <span className="text-[9px] text-red-400 ml-1" title={error}>!</span>}
        </div>
      </td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-center gap-2">
          {saving && <Loader2 size={12} className="animate-spin text-gray-400" />}
        </div>
      </td>
    </tr>
  );
}

/** Inline row for the Uncategorized Expense tab — dropdown picks the bucket;
 *  POSTs to /api/expense/categorize → updates t08_expenses.expense_type
 *  and the row drops out of the queue. */
function UncategorizedExpenseRow({
  row,
  onCategorized,
  onDismiss,
}: {
  row: MissingExpenseRow;
  onCategorized: () => void;
  onDismiss: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setBucket = useCallback(async (expense_type: string) => {
    setSaving(expense_type);
    setError(null);
    try {
      const res = await fetch('/api/expense/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, expense_type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      // Global event so any open expense / P&L card refetches without a
      // page reload (mirror of the billing:categorized pattern).
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('expense:categorized', { detail: { id: row.id, expense_type } }));
      }
      onCategorized();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(null);
    }
  }, [row.id, onCategorized]);

  // DB stores 'labour' (UK spelling, kept for back-compat); UI shows "Labor".
  const buckets: Array<{ label: string; value: string }> = [
    { label: 'Labor', value: 'labour' },
    { label: 'Marketing', value: 'marketing' },
    { label: 'Overhead', value: 'overhead' },
    { label: 'Coaching', value: 'coaching' },
    { label: 'Mastermind', value: 'mastermind' },
    { label: 'Software', value: 'software' },
    { label: 'Call Centre', value: 'call_centre' },
    { label: 'Other', value: 'other' },
  ];

  return (
    <tr className="border-b border-amber-900/20 hover:bg-black/20">
      <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{row.date}</td>
      <td className="py-2 px-4 text-white font-medium">{row.vendor ?? '—'}</td>
      <td className="py-2 px-4 text-right text-red-300">${row.amount.toLocaleString()}</td>
      <td className="py-2 px-4 text-gray-400 truncate max-w-xs">{row.description ?? '—'}</td>
      <td className="py-2 px-4 text-gray-400">{row.card ?? '—'}</td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {buckets.map((b) => (
            <button
              key={b.value}
              onClick={() => setBucket(b.value)}
              disabled={saving !== null}
              className={`px-2 py-1 rounded border text-[10px] font-medium transition-colors disabled:opacity-50 ${
                saving === b.value
                  ? 'bg-cyan-700/60 border-cyan-500 text-white'
                  : 'bg-cyan-900/30 border-cyan-700/40 text-cyan-300 hover:bg-cyan-800/50'
              }`}
              title={`Set as ${b.label}`}
            >
              {saving === b.value ? <Loader2 size={10} className="animate-spin inline" /> : b.label}
            </button>
          ))}
          {error && (
            <span className="text-[10px] text-red-400 max-w-[100px] truncate" title={error}>
              {error}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function TabButton({
  active,
  label,
  count,
  onClick,
  variant = 'default',
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'purple' | 'cyan';
}) {
  const colorClasses = {
    default: {
      active: 'text-amber-200 border-amber-400',
      inactive: 'text-gray-400 border-transparent hover:text-amber-300',
      badgeActive: 'bg-amber-400 text-amber-950',
      badgeInactive: 'bg-gray-700 text-gray-300',
    },
    danger: {
      active: 'text-red-200 border-red-400',
      inactive: 'text-red-400/70 border-transparent hover:text-red-300',
      badgeActive: 'bg-red-400 text-red-950',
      badgeInactive: 'bg-red-900/60 text-red-300',
    },
    purple: {
      active: 'text-purple-200 border-purple-400',
      inactive: 'text-purple-400/70 border-transparent hover:text-purple-300',
      badgeActive: 'bg-purple-400 text-purple-950',
      badgeInactive: 'bg-purple-900/60 text-purple-300',
    },
    cyan: {
      active: 'text-cyan-200 border-cyan-400',
      inactive: 'text-cyan-400/70 border-transparent hover:text-cyan-300',
      badgeActive: 'bg-cyan-400 text-cyan-950',
      badgeInactive: 'bg-cyan-900/60 text-cyan-300',
    },
  };

  const colors = colorClasses[variant];

  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
        active ? colors.active : colors.inactive
      }`}
    >
      {label}
      {count > 0 && (
        <span
          className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold ${
            active ? colors.badgeActive : colors.badgeInactive
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Determine anomaly type from the issue string */
function getAnomalyType(issue: string): 'showed_no_demo' | 'test_transaction' | 'negative_cash' | 'future_date' | 'duplicate' | 'unknown' {
  if (issue.includes('Showed but no demo') || issue.includes('Show rate anomaly')) return 'showed_no_demo';
  if (issue.includes('Suspicious close') || issue.includes('likely test transaction')) return 'test_transaction';
  if (issue.includes('Negative cash')) return 'negative_cash';
  if (issue.includes('Future date')) return 'future_date';
  if (issue.includes('Duplicate lead') || issue.includes('Duplicate')) return 'duplicate';
  return 'unknown';
}

/** POST an override to /api/overrides */
async function postOverride(body: {
  table_name: string;
  row_id: string;
  field: string;
  corrected: string;
  reason: string;
}): Promise<void> {
  const res = await fetch('/api/overrides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

function AnomalyFixButton({
  anomaly,
  onFixed,
}: {
  anomaly: DataAnomaly;
  onFixed: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anomalyType = getAnomalyType(anomaly.issue);

  const handleFix = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      switch (anomalyType) {
        case 'showed_no_demo':
          await postOverride({
            table_name: 'leads',
            row_id: anomaly.leadId,
            field: 'demoBooked',
            corrected: 'true',
            reason: 'Marked via anomaly fix',
          });
          break;

        case 'test_transaction':
          await postOverride({
            table_name: 'leads',
            row_id: anomaly.leadId,
            field: 'stage',
            corrected: 'Closed Lost',
            reason: 'Flagged as test transaction',
          });
          break;

        case 'negative_cash':
          await postOverride({
            table_name: 'leads',
            row_id: anomaly.leadId,
            field: 'cashCollected',
            corrected: '0',
            reason: 'Negative cash corrected to $0',
          });
          break;

        case 'future_date':
          await postOverride({
            table_name: 'leads',
            row_id: anomaly.leadId,
            field: 'date',
            corrected: new Date().toISOString().split('T')[0],
            reason: 'Future date corrected to today',
          });
          break;

        case 'duplicate':
          await postOverride({
            table_name: 'leads',
            row_id: anomaly.leadId,
            field: 'stage',
            corrected: 'Duplicate',
            reason: `Duplicate lead: ${anomaly.email}`,
          });
          break;

        default:
          return;
      }

      onFixed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setTimeout(() => setError(null), 3000);
    } finally {
      setLoading(false);
    }
  }, [anomalyType, anomaly, onFixed]);

  if (anomalyType === 'unknown') return null;

  const config: Record<string, { label: string; className: string }> = {
    showed_no_demo: {
      label: 'Mark as Booked',
      className: 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300 hover:bg-emerald-800/50',
    },
    test_transaction: {
      label: 'Flag as Test',
      className: 'bg-red-900/40 border-red-700/50 text-red-300 hover:bg-red-800/50',
    },
    negative_cash: {
      label: 'Set to $0',
      className: 'bg-yellow-900/40 border-yellow-700/50 text-yellow-300 hover:bg-yellow-800/50',
    },
    future_date: {
      label: 'Set to Today',
      className: 'bg-yellow-900/40 border-yellow-700/50 text-yellow-300 hover:bg-yellow-800/50',
    },
    duplicate: {
      label: 'Remove Duplicate',
      className: 'bg-red-900/40 border-red-700/50 text-red-300 hover:bg-red-800/50',
    },
  };

  const btn = config[anomalyType];

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleFix}
        disabled={loading}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium transition-colors disabled:opacity-50 ${btn.className}`}
      >
        {loading && <Loader2 size={10} className="animate-spin" />}
        {btn.label}
      </button>
      {error && <span className="text-[10px] text-red-400 max-w-[120px] truncate" title={error}>{error}</span>}
    </div>
  );
}

function AnomalyRow({
  anomaly,
  onDismiss,
}: {
  anomaly: DataAnomaly;
  onDismiss: () => void;
}) {
  const ghlUrl = anomaly.ghlContactUrl || `https://app.gohighlevel.com/v2/location/${process.env.NEXT_PUBLIC_GHL_LOCATION_ID || ''}/contacts/detail/${anomaly.ghlContactId}`;

  return (
    <tr className="border-b border-amber-900/20 hover:bg-black/20 transition-colors">
      <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{anomaly.date}</td>
      <td className="py-2 px-4">
        <div className="text-white font-medium">{anomaly.leadName}</div>
        <div className="text-[10px] text-gray-500 truncate max-w-[180px]">{anomaly.email}</div>
      </td>
      <td className="py-2 px-4">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-950/40 border border-red-800/30 text-[11px] text-red-300">
          <AlertTriangle size={10} className="text-red-400 shrink-0" />
          {anomaly.issue}
        </span>
      </td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-center gap-2">
          <AnomalyFixButton anomaly={anomaly} onFixed={onDismiss} />
          <a
            href={ghlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400"
            title="Open in GHL"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </td>
    </tr>
  );
}

function RevenueFlagRow({
  flag,
  onDismiss,
}: {
  flag: RevenueFlag;
  onDismiss: () => void;
}) {
  const ghlUrl = flag.ghlContactUrl || `https://app.gohighlevel.com/v2/location/${process.env.NEXT_PUBLIC_GHL_LOCATION_ID || ''}/contacts/detail/${flag.ghlContactId}`;

  const issueColor: Record<RevenueFlag['issueType'], string> = {
    zero_cash_close: 'bg-orange-950/40 border-orange-800/30 text-orange-300',
    cash_no_close: 'bg-yellow-950/40 border-yellow-800/30 text-yellow-300',
    unverified_cash: 'bg-blue-950/40 border-blue-800/30 text-blue-300',
  };

  return (
    <tr className="border-b border-amber-900/20 hover:bg-black/20 transition-colors">
      <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{flag.date}</td>
      <td className="py-2 px-4">
        <div className="text-white font-medium">{flag.leadName}</div>
        <div className="text-[10px] text-gray-500 truncate max-w-[180px]">{flag.email}</div>
      </td>
      <td className="py-2 px-4 text-right font-mono text-gray-300">
        ${flag.cashCollected.toLocaleString()}
      </td>
      <td className="py-2 px-4 text-right font-mono text-gray-300">
        ${flag.contractedRevenue.toLocaleString()}
      </td>
      <td className="py-2 px-4">
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] ${issueColor[flag.issueType]}`}>
          <AlertTriangle size={10} className="shrink-0" />
          {flag.issue}
        </span>
      </td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-center gap-2">
          <a
            href={ghlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400"
            title="Open in GHL"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </td>
    </tr>
  );
}

function ReviewRow({
  lead,
  tab,
  onUpdateLead,
  onDismiss,
}: {
  lead: Lead;
  tab: TabId;
  onUpdateLead: (leadId: string, updates: Partial<Lead>) => void;
  onDismiss: () => void;
}) {
  const [source, setSource] = useState<Channel | ''>(lead.source === 'Unknown' ? '' : lead.source);
  const [outcome, setOutcome] = useState(lead.callOutcome || '');
  const [quality, setQuality] = useState(lead.qualityScore || 5);
  const [saved, setSaved] = useState(false);

  const ghlUrl = lead.ghlContactUrl || `https://app.gohighlevel.com/v2/location/${process.env.NEXT_PUBLIC_GHL_LOCATION_ID || ''}/contacts/detail/${lead.ghlContactId}`;

  const handleSave = () => {
    const updates: Partial<Lead> = {};
    if (tab === 'unknownSource' && source) updates.source = source as Channel;
    if (Object.keys(updates).length > 0) {
      onUpdateLead(lead.id, updates);
      setSaved(true);
      setTimeout(() => onDismiss(), 400);
    }
  };

  return (
    <tr className="border-b border-amber-900/20 hover:bg-black/20 transition-colors">
      <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{lead.date}</td>
      <td className="py-2 px-4">
        <div className="text-white font-medium">{lead.name}</div>
        <div className="text-[10px] text-gray-500 truncate max-w-[180px]">{lead.email}</div>
      </td>
      <td className="py-2 px-4">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-[10px] text-gray-400">
          <ChannelIcon channel={lead.source} size={10} />
          {lead.source}
        </span>
      </td>
      <td className="py-2 px-4 text-gray-500 text-[11px] max-w-[220px] truncate" title={lead.campaignHint || lead.campaignName || '—'}>
        {lead.campaignHint || lead.campaignName || lead.adName || '—'}
      </td>

      {tab === 'unknownSource' && (
        <td className="py-2 px-4">
          <Select
            size="xs"
            value={source}
            onChange={(v) => setSource(v as Channel)}
            placeholder="Select source..."
            options={SOURCE_OPTIONS.map((s) => ({
              value: s,
              label: s,
              icon: <ChannelIcon channel={s} size={11} />,
            }))}
          />
        </td>
      )}


      <td className="py-2 px-4">
        <div className="flex items-center justify-center gap-1">
          <a
            href={ghlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400"
            title="Open in GHL"
          >
            <ExternalLink size={12} />
          </a>
          <button
            onClick={handleSave}
            disabled={saved}
            className={`p-1 rounded transition-colors ${
              saved
                ? 'bg-emerald-600/30 text-emerald-400'
                : 'hover:bg-emerald-900/40 text-gray-500 hover:text-emerald-400'
            }`}
            title="Save"
          >
            <Check size={12} />
          </button>
          {/* Persistent "Remove" — soft-deletes the lead via t16_overrides.
              Only shown on the Unknown Source tab where fake/junk leads land. */}
          {tab === 'unknownSource' && (
            <RemoveLeadButton
              leadId={lead.id}
              leadName={lead.name}
              onRemoved={onDismiss}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

/** Persistent "Mark Excused" for missing EOD rows. Inserts into t05a_eod_excused
 *  so the missing-EOD detector skips this (closer, date) pair going forward.
 *  Used when a closer genuinely didn't work that day (PTO, sick, etc). */
function ExcuseEodButton({
  closer,
  date,
  onExcused,
}: {
  closer: string;
  date: string;
  onExcused: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const handle = useCallback(async () => {
    // No prompt — one click = done. the operator explicitly asked to drop it.
    setBusy(true);
    try {
      const res = await fetch('/api/eod/excuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closer, date, reason: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        alert(`Excuse failed: ${data?.error ?? res.status}`);
        return;
      }
      onExcused();
    } finally {
      setBusy(false);
    }
  }, [closer, date, onExcused]);
  return (
    <button
      onClick={handle}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium transition-colors bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 disabled:opacity-50"
      title="Remove this issue — mark closer/date as not-a-problem (persists)"
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
      Remove Issue
    </button>
  );
}

/** Persistent "Remove Issue" for EOD anomaly rows. Inserts into
 *  t05b_eod_anomaly_excused so the anomaly detector skips this
 *  (eod_id, field) pair going forward. Used when an anomalous-looking
 *  value is actually legitimate. */
function ExcuseEodAnomalyButton({
  anomalyId,
  field,
  onExcused,
}: {
  anomalyId: string;
  field: string;
  onExcused: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const handle = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/eod/excuse-anomaly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: anomalyId, field, reason: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        alert(`Excuse failed: ${data?.error ?? res.status}`);
        return;
      }
      onExcused();
    } finally {
      setBusy(false);
    }
  }, [anomalyId, field, onExcused]);
  return (
    <button
      onClick={handle}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-medium transition-colors bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 disabled:opacity-50"
      title="Remove this issue — mark this anomaly as not-a-problem (persists)"
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
      Remove Issue
    </button>
  );
}

/** Inline row for the Unlogged Calls (Needs Review bookings) tab.
 *  Renders the booking with a status dropdown — clicking a status POSTs to
 *  /api/booking/update-status which sets t03_bookings.status. Row drops out. */
/** "Copy missing EODs" — exports the missing-EOD list with a fill-in
 *  template so the sales manager can complete it offline, then the operator
 *  pastes back via BulkPasteEodsButton for one-shot apply. */
function CopyEodsToSheetButton({ rows }: { rows: MissingEod[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const header = [
      'Date', 'Closer',
      'Calls Booked', 'Calls Shown', 'Calls Closed',
      'Cash Collected', 'Revenue Generated',
      'No Shows', 'Calls Cancelled', 'Offers Given', 'Deposits',
      'Feedback / Notes',
    ];
    const lines = [header.join('\t')];
    for (const r of rows) {
      lines.push([r.date, r.closer, '', '', '', '', '', '', '', '', '', '']
        .map((c) => String(c).replace(/\t/g, ' ').replace(/\n/g, ' '))
        .join('\t'));
    }
    const tsv = lines.join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this manually:', tsv);
    }
  }, [rows]);

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-medium transition-colors ${
        copied
          ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-200'
          : 'bg-purple-900/40 border-purple-700/50 text-purple-200 hover:bg-purple-800/50'
      }`}
      title={`Copy ${rows.length} missing EODs as TSV with fill-in columns. Paste into Google Sheets, share with sales manager.`}
    >
      {copied ? <Check size={12} /> : <ExternalLink size={12} />}
      {copied ? `Copied ${rows.length} rows!` : `Copy ${rows.length} for Sheet`}
    </button>
  );
}

/** "Paste filled EODs" — modal opens with a textarea. User pastes the
 *  filled-in TSV back from sales manager, click Apply → POSTs each row
 *  to /api/data/closer-eods → t05_eod_reports populated → queue clears. */
function BulkPasteEodsButton({ onApplied }: { onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null);

  const apply = useCallback(async () => {
    setBusy(true);
    setResult(null);
    const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setResult({ ok: 0, fail: 0, errors: ['No data rows — paste the header + at least one filled row.'] });
      setBusy(false);
      return;
    }
    // Skip header. Expected columns (in this order):
    // Date | Closer | Calls Booked | Calls Shown | Calls Closed | Cash Collected | Revenue Generated | No Shows | Calls Cancelled | Offers Given | Deposits | Feedback
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 2) continue;
      const [date, closer, callsBooked, callsShown, callsClosed, cashCollected, revenueGenerated,
             noShows, callsCancelled, offersGiven, deposits, feedback] = cols;
      const dateClean = (date ?? '').trim();
      const closerClean = (closer ?? '').trim();
      if (!dateClean || !closerClean) {
        errors.push(`Row ${i}: missing date or closer — skipped`);
        continue;
      }
      // Normalise date — accept YYYY-MM-DD, M/D/YYYY, MM-DD-YYYY
      let isoDate = dateClean;
      const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateClean);
      const dash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(dateClean);
      if (slash) isoDate = `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
      else if (dash && !/^\d{4}-/.test(dateClean)) {
        isoDate = `${dash[3]}-${dash[1].padStart(2, '0')}-${dash[2].padStart(2, '0')}`;
      }
      const num = (s: string | undefined) => {
        if (!s) return 0;
        const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
        return isNaN(n) ? 0 : n;
      };
      try {
        const res = await fetch('/api/data/closer-eods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: isoDate,
            closer_name: closerClean,
            calls_booked: num(callsBooked),
            calls_shown: num(callsShown),
            calls_closed: num(callsClosed),
            cash_collected: num(cashCollected),
            revenue_generated: num(revenueGenerated),
            no_shows: num(noShows),
            calls_cancelled: num(callsCancelled),
            offers_given: num(offersGiven),
            deposits: num(deposits),
            feedback: (feedback ?? '').trim() || null,
          }),
        });
        if (res.ok) ok += 1;
        else {
          fail += 1;
          const data = await res.json().catch(() => ({} as any));
          errors.push(`Row ${i} (${closerClean} ${isoDate}): ${data?.error ?? `HTTP ${res.status}`}`);
        }
      } catch (e: any) {
        fail += 1;
        errors.push(`Row ${i}: ${e?.message ?? 'network failed'}`);
      }
    }
    setResult({ ok, fail, errors });
    setBusy(false);
    if (ok > 0) onApplied();
  }, [text, onApplied]);

  return (
    <>
      <button
        onClick={() => { setOpen(true); setText(''); setResult(null); }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-medium bg-emerald-900/40 border-emerald-700/50 text-emerald-200 hover:bg-emerald-800/50"
        title="Paste back the filled-in TSV from your sales manager — bulk applies to all rows"
      >
        <Plus size={12} /> Paste Filled EODs
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => !busy && setOpen(false)}>
          <div className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <div>
                <h3 className="text-white font-semibold text-sm">Paste Filled EODs</h3>
                <p className="text-xs text-gray-400 mt-0.5">Paste the entire filled-in sheet (including the header row). Each row will be saved to t05_eod_reports.</p>
              </div>
              <button onClick={() => !busy && setOpen(false)} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                placeholder={`Date\tCloser\tCalls Booked\tCalls Shown\tCalls Closed\tCash Collected\tRevenue Generated\tNo Shows\tCalls Cancelled\tOffers Given\tDeposits\tFeedback\n2026-04-27\tCloser Three\t8\t6\t2\t5000\t10000\t1\t1\t3\t0\t...`}
                disabled={busy}
              />
              {result && (
                <div className={`rounded-lg px-3 py-2 text-xs ${result.fail === 0 ? 'bg-emerald-950/40 border border-emerald-800/40 text-emerald-300' : 'bg-amber-950/40 border border-amber-800/40 text-amber-300'}`}>
                  <div className="font-semibold">{result.ok} saved · {result.fail} failed</div>
                  {result.errors.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {result.errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
                      {result.errors.length > 6 && <li>+{result.errors.length - 6} more…</li>}
                    </ul>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => !busy && setOpen(false)} disabled={busy} className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors">
                  Close
                </button>
                <button onClick={apply} disabled={busy || !text.trim()} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 transition-colors">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {busy ? 'Saving…' : 'Apply All'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** "Copy to Sheet" button — exports all needs-review bookings as TSV
 *  to the clipboard. Pastes cleanly into Google Sheets. the operator uses this
 *  to share the list with his sales manager (no dashboard access needed). */
function CopyToSheetButton({ rows }: { rows: NeedsReviewBookingRow[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const header = ['Booking Date', 'Lead Name', 'Email', 'Closer', 'Offer', 'GHL Link', 'Status (fill in)'];
    const lines = [header.join('\t')];
    for (const r of rows) {
      // Format date as "YYYY-MM-DD HH:mm UTC" for readability in Sheets
      let date = r.dateBookedFor || '';
      try {
        const d = new Date(r.dateBookedFor);
        if (!isNaN(d.getTime())) {
          date = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
        }
      } catch {}
      lines.push([
        date,
        r.name ?? '',
        r.email ?? '',
        r.closer ?? '',
        r.offer ?? '',
        r.contactLink ?? '',
        '',
      ].map((c) => String(c).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'));
    }
    const tsv = lines.join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // Fallback if clipboard API blocked: open prompt with the text
      window.prompt('Copy this manually:', tsv);
    }
  }, [rows]);

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-medium transition-colors ${
        copied
          ? 'bg-emerald-900/40 border-emerald-700/60 text-emerald-200'
          : 'bg-amber-900/40 border-amber-700/50 text-amber-200 hover:bg-amber-800/50'
      }`}
      title={`Copy all ${rows.length} bookings to clipboard as tab-separated rows (paste into Google Sheets)`}
    >
      {copied ? <Check size={12} /> : <ExternalLink size={12} />}
      {copied ? `Copied ${rows.length} rows!` : `Copy ${rows.length} rows for Sheet`}
    </button>
  );
}

function NeedsReviewRow({
  row,
  onResolved,
}: {
  row: NeedsReviewBookingRow;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStatus = useCallback(async (status: string) => {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch('/api/booking/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setTimeout(() => setError(null), 3000);
    } finally {
      setBusy(null);
    }
  }, [row.id, onResolved]);

  const STATUSES: Array<{ value: string; label: string; cls: string }> = [
    { value: 'Showed',      label: 'Showed',     cls: 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300 hover:bg-emerald-800/50' },
    { value: 'No Showed',   label: 'No Show',    cls: 'bg-red-900/40 border-red-700/50 text-red-300 hover:bg-red-800/50' },
    { value: 'Rescheduled', label: 'Resched',    cls: 'bg-amber-900/40 border-amber-700/50 text-amber-300 hover:bg-amber-800/50' },
    { value: 'Cancelled',   label: 'Cancelled',  cls: 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700' },
  ];

  return (
    <tr className="border-b border-amber-900/20 hover:bg-black/20">
      <td className="py-2 px-4 text-gray-400 whitespace-nowrap">{row.dateBookedFor}</td>
      <td className="py-2 px-4">
        <div className="text-white font-medium">{row.name ?? '—'}</div>
        <div className="text-[10px] text-gray-500 truncate max-w-[180px]">{row.email ?? ''}</div>
      </td>
      <td className="py-2 px-4 text-gray-300">{row.closer ?? '—'}</td>
      <td className="py-2 px-4 text-gray-400 truncate max-w-[200px]" title={row.offer ?? '—'}>{row.offer ?? '—'}</td>
      <td className="py-2 px-4">
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              disabled={busy !== null}
              className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors disabled:opacity-50 ${s.cls}`}
              title={`Set to ${s.value}`}
            >
              {busy === s.value ? <Loader2 size={10} className="animate-spin inline" /> : s.label}
            </button>
          ))}
          {row.contactLink && (
            <a
              href={row.contactLink}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400"
              title="Open in GHL"
            >
              <ExternalLink size={12} />
            </a>
          )}
          {error && <span className="text-[9px] text-red-400" title={error}>!</span>}
        </div>
      </td>
    </tr>
  );
}

/** Persistent soft-delete button for the Unknown Source tab. Confirms before
 *  hitting /api/leads/remove which writes a t16_overrides row marking the
 *  lead as removed. Lead disappears from CRM, leaderboards, anomalies. */
function RemoveLeadButton({
  leadId,
  leadName,
  onRemoved,
}: {
  leadId: string;
  leadName: string;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const handle = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/leads/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, reason: 'Marked as fake/junk lead via Daily Review Queue' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        alert(`Remove failed: ${data?.error ?? res.status}`);
        return;
      }
      onRemoved();
    } finally {
      setBusy(false);
    }
  }, [leadId, leadName, onRemoved]);
  return (
    <button
      onClick={handle}
      disabled={busy}
      className="p-1 rounded bg-red-900/30 border border-red-700/40 text-red-300 hover:bg-red-800/50 disabled:opacity-50"
      title="Remove (mark as fake/junk lead — persists)"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <FileX2 size={12} />}
    </button>
  );
}

/**
 * InlineEodModal — pops up from the Review Queue Banner when a team member clicks "Fill In"
 * on a missing EOD row. Pre-populates closer + date. POSTs to /api/data/closer-eods.
 */
function InlineEodModal({
  closer,
  date,
  onClose,
  onSaved,
}: {
  closer: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [callsBooked, setCallsBooked] = useState(0);
  const [callsShown, setCallsShown] = useState(0);
  const [callsClosed, setCallsClosed] = useState(0);
  const [cashCollected, setCashCollected] = useState(0);
  const [revenueGenerated, setRevenueGenerated] = useState(0);
  const [noShows, setNoShows] = useState(0);
  const [callsCancelled, setCallsCancelled] = useState(0);
  const [offersGiven, setOffersGiven] = useState(0);
  const [deposits, setDeposits] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/data/closer-eods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          closer_name: closer,
          calls_booked: callsBooked,
          calls_shown: callsShown,
          calls_closed: callsClosed,
          cash_collected: cashCollected,
          revenue_generated: revenueGenerated,
          no_shows: noShows,
          calls_cancelled: callsCancelled,
          offers_given: offersGiven,
          deposits,
          feedback: feedback || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Save failed' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save EOD report');
      setSaving(false);
    }
  };

  const inputCls =
    'w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold text-sm">Fill In Missing EOD</h3>
            <p className="text-xs text-purple-300 mt-0.5">
              {closer} — {formattedDate}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Calls Booked</label>
              <input type="number" value={callsBooked} onChange={(e) => setCallsBooked(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Shows</label>
              <input type="number" value={callsShown} onChange={(e) => setCallsShown(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Closed</label>
              <input type="number" value={callsClosed} onChange={(e) => setCallsClosed(Number(e.target.value))} className={inputCls} min={0} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Cash Collected ($)</label>
              <input type="number" value={cashCollected} onChange={(e) => setCashCollected(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Revenue Generated ($)</label>
              <input type="number" value={revenueGenerated} onChange={(e) => setRevenueGenerated(Number(e.target.value))} className={inputCls} min={0} />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">No Shows</label>
              <input type="number" value={noShows} onChange={(e) => setNoShows(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Cancelled</label>
              <input type="number" value={callsCancelled} onChange={(e) => setCallsCancelled(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Offers</label>
              <input type="number" value={offersGiven} onChange={(e) => setOffersGiven(Number(e.target.value))} className={inputCls} min={0} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1">Deposits</label>
              <input type="number" value={deposits} onChange={(e) => setDeposits(Number(e.target.value))} className={inputCls} min={0} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Notes / Feedback</label>
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} className={inputCls} placeholder="Optional notes from the closer..." />
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors" disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {saving ? 'Saving…' : 'Save EOD'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
