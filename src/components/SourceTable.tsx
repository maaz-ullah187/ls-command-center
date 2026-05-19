'use client';

import { Lead, Ad, Channel } from '@/lib/types';
import { isWithinKPI } from '@/lib/kpi-config';
import { X, ChevronRight } from 'lucide-react';
import { useState, useMemo, useRef, useCallback } from 'react';
import ChannelIcon from './ChannelIcon';

type DrillLevel = 'source' | 'adAccount' | 'campaign' | 'adSet' | 'ad';
const LEVELS: DrillLevel[] = ['source', 'adAccount', 'campaign', 'adSet', 'ad'];
const LEVEL_LABELS: Record<DrillLevel, string> = {
  source: 'Traffic Source',
  adAccount: 'Ad Account',
  campaign: 'Campaign',
  adSet: 'Ad Set',
  ad: 'Ad',
};

// Column mode: paid sources use the full ad-metrics column set; non-paid
// (LinkedIn, Instagram, X, YouTube, Webinar, Organic, Referral, Unknown)
// use a trimmed set focused on booked/shown/closed + revenue.
type ColMode = 'paid' | 'organic';

// the operator 2026-04-28: Webinar is now its own first-class traffic source, not
// rolled up under Facebook Ads. Display source = real source, no remap.
function displaySource(l: Lead): string {
  return l.source;
}

// For organic drill: at Campaign level we bucket by bio/dm (DM channels) or
// bio/video (YouTube). At Ad Set level we show the slug (linkedin_dm, csmexitcall, etc).
function organicCampaignBucket(l: Lead): string {
  const blob = `${l.campaignName} ${l.adSetName} ${l.adName}`.toLowerCase();
  if (l.source === 'YouTube') {
    if (blob.includes('bio')) return 'bio';
    return 'video';
  }
  if (l.source === 'LinkedIn' || l.source === 'Instagram' || l.source === 'X') {
    if (blob.includes('dm')) return 'dm';
    if (blob.includes('bio')) return 'bio';
    return 'other';
  }
  // Organic / Referral / Unknown → fall back to real campaign name
  return l.campaignName || '(unattributed)';
}

// Ad Set level key for organic sources. YouTube leads have their actual video
// identifier in `campaignName` (freecourse-googledoc, theointerview, etc),
// NOT in `adSetName` — so we group by campaignName for YouTube. For DM
// channels and everything else, fall back to adSetName.
function organicAdSetKey(l: Lead): string {
  if (l.source === 'YouTube') {
    return l.campaignName || l.adSetName || '(unattributed)';
  }
  return l.adSetName || l.campaignName || '(unattributed)';
}

interface BreadcrumbFilter {
  level: DrillLevel;
  // Array supports multi-select drill (e.g. check 2 campaigns, drill into ad
  // sets for both). Single-click drill produces an array of length 1.
  values: string[];
}

// Campaign/ad set status derived from underlying ads
type CampaignStatus = 'active' | 'paused' | 'mixed' | undefined;

interface RowStats {
  name: string;
  cost: number;
  leads: number;
  qualifiedLeads: number;
  callsBooked: number;
  callsShown: number;
  qualifiedCalls: number;
  callsClosed: number;
  cashCollected: number;
  cashPerCall: number;
  contractedRevenue: number;
  clicks: number;
  thumbnailUrl?: string;
  adId?: string;
  active?: boolean;
  campaignStatus?: CampaignStatus;
}

function computeStats(leads: Lead[], ads: Ad[], groupKey: (l: Lead) => string, adGroupKey?: (a: Ad) => string, metaGetter?: (name: string) => { thumbnailUrl?: string; adId?: string; active?: boolean } | undefined): RowStats[] {
  const groups = new Map<string, { leads: Lead[]; ads: Ad[] }>();
  for (const l of leads) {
    const key = groupKey(l);
    if (!groups.has(key)) groups.set(key, { leads: [], ads: [] });
    groups.get(key)!.leads.push(l);
  }
  if (adGroupKey) {
    for (const a of ads) {
      const key = adGroupKey(a);
      if (!groups.has(key)) groups.set(key, { leads: [], ads: [] });
      groups.get(key)!.ads.push(a);
    }
  }

  return Array.from(groups.entries()).map(([name, { leads: gl, ads: ga }]) => {
    const cost = ga.reduce((s, a) => s + a.spend, 0);
    const qualifiedLeads = gl.filter(l => l.qualityScore >= 6).length;
    const callsBooked = gl.filter(l => l.demoBooked).length;
    const callsShown = gl.filter(l => l.showStatus === 'Showed').length;
    const qualifiedCalls = gl.filter(l => l.showStatus === 'Showed' && l.qualityScore >= 6).length;
    const isWon = (l: Lead) => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1;
    const callsClosed = gl.filter(isWon).length;
    const cashCollected = gl.filter(isWon).reduce((s, l) => s + l.cashCollected, 0);
    const contractedRevenue = gl.filter(isWon).reduce((s, l) => s + l.contractedRevenue, 0);
    const clicks = ga.reduce((s, a) => s + a.clicks, 0);

    const cashPerCall = callsShown > 0 ? cashCollected / callsShown : 0;
    const extra = metaGetter?.(name);

    // Derive campaign/adset status from the ads in this group
    let campaignStatus: CampaignStatus = undefined;
    if (ga.length > 0 && !extra?.adId) {
      const activeCount = ga.filter(a => a.active).length;
      if (activeCount === ga.length) campaignStatus = 'active';
      else if (activeCount === 0) campaignStatus = 'paused';
      else campaignStatus = 'mixed'; // some active, some paused
    }

    return { name, cost, leads: gl.length, qualifiedLeads, callsBooked, callsShown, qualifiedCalls, callsClosed, cashCollected, cashPerCall, contractedRevenue, clicks, thumbnailUrl: extra?.thumbnailUrl, adId: extra?.adId, active: extra?.active, campaignStatus };
  }).sort((a, b) => b.cashCollected - a.cashCollected);
}

interface SourceTableProps {
  leads: Lead[];
  ads: Ad[];
  onViewLeads?: (leads: Lead[], title: string) => void;
}

export default function SourceTable({ leads, ads, onViewLeads }: SourceTableProps) {
  const [filters, setFilters] = useState<BreadcrumbFilter[]>([]);
  const [sortKey, setSortKey] = useState<keyof RowStats>('cashCollected');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Optimistic status overrides keyed by ad_id so clicking a toggle updates
  // the UI immediately while the Meta API call is in flight.
  const [statusOverrides, setStatusOverrides] = useState<Record<string, boolean>>({});
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  // Row-level multi-select at the current drill level. Cleared on drill.
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Manual row ordering per drill level, persisted to localStorage. If a row's
  // name exists in the order array, it's placed in that position; new rows
  // (not yet in the order) fall to the bottom in default sort order.
  const ORDER_STORAGE_KEY = 'sourceTable.manualOrder.v1';
  const [manualOrder, setManualOrder] = useState<Record<DrillLevel, string[]>>(() => {
    if (typeof window === 'undefined') return { source: [], adAccount: [], campaign: [], adSet: [], ad: [] };
    try {
      const raw = localStorage.getItem(ORDER_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { source: [], adAccount: [], campaign: [], adSet: [], ad: [] };
  });
  const [dragRow, setDragRow] = useState<string | null>(null);

  const persistOrder = (next: Record<DrillLevel, string[]>) => {
    setManualOrder(next);
    try { localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  const handleDragStart = (e: React.DragEvent, name: string) => {
    setDragRow(name);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (e: React.DragEvent, targetName: string) => {
    e.preventDefault();
    if (!dragRow || dragRow === targetName) { setDragRow(null); return; }
    const current = manualOrder[currentLevel] ?? [];
    // Seed with the currently visible rows so every row has a position, even
    // ones the user hasn't touched yet.
    const seeded = current.length
      ? [...current, ...rows.map(r => r.name).filter(n => !current.includes(n))]
      : rows.map(r => r.name);
    const from = seeded.indexOf(dragRow);
    const to = seeded.indexOf(targetName);
    if (from < 0 || to < 0) { setDragRow(null); return; }
    const next = [...seeded];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persistOrder({ ...manualOrder, [currentLevel]: next });
    setDragRow(null);
  };

  // Resizable columns — keyed by column id. Defaults chosen to match previous layout.
  const DEFAULT_WIDTHS: Record<string, number> = {
    name: 420, cost: 100, leads: 80, cpl: 90, qualifiedLeads: 100, cpql: 90,
    callsBooked: 80, cpcCall: 100, callsShown: 80, showRate: 100, costPerShow: 110,
    qualifiedCalls: 100, cpqc: 90, callsClosed: 80, closeRate: 100, cpa: 90,
    cashCollected: 130, cashPerCall: 100, contractedRevenue: 130, upfrontPct: 100, roas: 90, roi: 90,
  };
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const resizingRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { col, startX: e.clientX, startW: colWidths[col] ?? 100 };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const { col: c, startX, startW } = resizingRef.current;
      const next = Math.max(50, startW + (ev.clientX - startX));
      setColWidths(prev => ({ ...prev, [c]: next }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [colWidths]);

  const toggleAdStatus = async (adId: string, currentActive: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextActive = !currentActive;
    setStatusOverrides(prev => ({ ...prev, [adId]: nextActive }));
    setTogglingIds(prev => new Set(prev).add(adId));
    try {
      const res = await fetch(`/api/meta/ads/${adId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextActive ? 'ACTIVE' : 'PAUSED' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.error('[toggleAdStatus] failed:', j);
        // Revert on failure
        setStatusOverrides(prev => ({ ...prev, [adId]: currentActive }));
        alert('Failed to update ad status: ' + (j.error ?? res.status));
      }
    } catch (err) {
      console.error('[toggleAdStatus] threw:', err);
      setStatusOverrides(prev => ({ ...prev, [adId]: currentActive }));
      alert('Failed to update ad status');
    } finally {
      setTogglingIds(prev => {
        const next = new Set(prev);
        next.delete(adId);
        return next;
      });
    }
  };

  const currentLevel: DrillLevel = filters.length === 0 ? 'source' : LEVELS[Math.min(filters.length, LEVELS.length - 1)];

  // Determine whether the current view should render Paid columns or the
  // trimmed Organic column set. Rule: if the source filter is absent OR
  // includes only 'Facebook Ads' → paid mode; if it includes any non-Facebook Ads source → organic.
  const colMode: ColMode = useMemo(() => {
    const sourceFilter = filters.find(f => f.level === 'source');
    if (!sourceFilter) return 'paid';
    const vs = sourceFilter.values;
    if (vs.length === 1 && (vs[0] === 'Facebook Ads' || vs[0] === 'meta')) return 'paid';
    return 'organic';
  }, [filters]);

  // GHL stores some Ad Name / Ad Set Name / Campaign Name custom fields as the
  // raw Meta numeric IDs instead of human-readable names (depends on how the
  // Zapier webhook was set up). Build lookup maps from the Meta ads so we can
  // rewrite those IDs back to their real names before filtering/grouping.
  // This makes GHL leads and Meta ads join correctly at every drill level.
  const metaAdByIdOrName = useMemo(() => {
    const byId = new Map<string, Ad>();
    for (const a of ads) byId.set(a.id, a);
    return byId;
  }, [ads]);

  const normalizedLeads = useMemo(() => {
    if (metaAdByIdOrName.size === 0) return leads;
    return leads.map(l => {
      // Try to match the lead's adName (or adSetName, or campaignName) against
      // a Meta ad ID. If found, rewrite all three fields to the Meta ad's
      // canonical campaign / ad set / ad names.
      const maybeAd = metaAdByIdOrName.get(l.adName);
      if (maybeAd) {
        return {
          ...l,
          adName: maybeAd.adName,
          adSetName: maybeAd.adSetName || l.adSetName,
          campaignName: maybeAd.campaignName || l.campaignName,
          adAccountName: maybeAd.adAccountName || l.adAccountName,
        };
      }
      return l;
    });
  }, [leads, metaAdByIdOrName]);

  const filteredLeads = useMemo(() => {
    let result = normalizedLeads;
    for (const f of filters) {
      const vs = new Set(f.values);
      if (f.level === 'source') result = result.filter(l => vs.has(displaySource(l)) || (vs.has('meta') && displaySource(l) === 'Facebook Ads'));
      else if (f.level === 'adAccount') {
        // Organic: adAccount level is a single synthetic row per source. Match source.
        if (colMode === 'organic') result = result.filter(l => vs.has(l.source));
        else result = result.filter(l => vs.has(l.adAccountName || 'Unknown'));
      }
      else if (f.level === 'campaign') {
        // Organic: match the bio/dm/video bucket. Paid: match raw campaign name.
        if (colMode === 'organic') result = result.filter(l => vs.has(organicCampaignBucket(l)));
        else result = result.filter(l => vs.has(l.campaignName || 'Unknown'));
      }
      else if (f.level === 'adSet') {
        if (colMode === 'organic') result = result.filter(l => vs.has(organicAdSetKey(l)));
        else result = result.filter(l => vs.has(l.adSetName || 'Default'));
      }
    }
    return result;
  }, [normalizedLeads, filters, colMode]);

  const filteredAds = useMemo(() => {
    let result = ads;
    for (const f of filters) {
      const vs = new Set(f.values);
      if (f.level === 'source') result = result.filter(a => a.channel === 'Facebook Ads');
      else if (f.level === 'adAccount') result = result.filter(a => vs.has(a.adAccountName || 'Unknown'));
      else if (f.level === 'campaign') result = result.filter(a => vs.has(a.campaignName || 'Unknown'));
      else if (f.level === 'adSet') result = result.filter(a => vs.has(a.adSetName || 'Default'));
    }
    return result;
  }, [ads, filters]);

  const rows = useMemo(() => {
    let groupKey: (l: Lead) => string;
    let adGroupKey: ((a: Ad) => string) | undefined;

    switch (currentLevel) {
      case 'source':
        groupKey = l => displaySource(l); adGroupKey = a => a.channel; break;
      case 'adAccount':
        if (colMode === 'organic') {
          // Single synthetic row per source so the hierarchy stays 5-deep.
          groupKey = l => l.source;
          adGroupKey = undefined; // no ads in organic
        } else {
          groupKey = l => l.adAccountName || 'Unknown';
          adGroupKey = a => a.adAccountName || 'Unknown';
        }
        break;
      case 'campaign':
        if (colMode === 'organic') {
          groupKey = l => organicCampaignBucket(l);
          adGroupKey = undefined;
        } else {
          groupKey = l => l.campaignName || 'Unknown';
          adGroupKey = a => a.campaignName || 'Unknown';
        }
        break;
      case 'adSet':
        if (colMode === 'organic') {
          groupKey = l => organicAdSetKey(l);
          adGroupKey = undefined;
        } else {
          groupKey = l => l.adSetName || 'Default';
          adGroupKey = a => a.adSetName;
        }
        break;
      case 'ad':
        groupKey = l => l.adName || l.name || 'Unknown';
        adGroupKey = colMode === 'organic' ? undefined : (a => a.adName);
        break;
    }

    const metaGetter = currentLevel === 'ad'
      ? (name: string) => {
          const match = filteredAds.find(a => a.adName === name);
          return match ? { thumbnailUrl: match.thumbnailUrl, adId: match.id, active: match.active } : undefined;
        }
      : undefined;
    const stats = computeStats(filteredLeads, filteredAds, groupKey, adGroupKey, metaGetter);
    const q = search.trim().toLowerCase();
    const searched = q ? stats.filter(s => s.name.toLowerCase().includes(q)) : stats;
    const sorted = searched.sort((a, b) => {
      const aVal = a[sortKey] as number;
      const bVal = b[sortKey] as number;
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });
    // Apply manual drag-drop ordering on top: any row whose name is in
    // manualOrder[currentLevel] wins over the column sort. Rows not in the
    // order list fall to the bottom in their original sort position.
    const orderList = manualOrder[currentLevel] ?? [];
    if (orderList.length === 0) return sorted;
    const byName = new Map(sorted.map(r => [r.name, r]));
    const ordered: typeof sorted = [];
    for (const n of orderList) {
      const r = byName.get(n);
      if (r) { ordered.push(r); byName.delete(n); }
    }
    // Append any rows not in the manual order
    for (const r of sorted) if (byName.has(r.name)) ordered.push(r);
    return ordered;
  }, [filteredLeads, filteredAds, currentLevel, sortKey, sortDir, search, manualOrder]);

  const totals = useMemo(() => {
    return rows.reduce(
      (t, r) => ({
        cost: t.cost + r.cost, leads: t.leads + r.leads, qualifiedLeads: t.qualifiedLeads + r.qualifiedLeads,
        callsBooked: t.callsBooked + r.callsBooked, callsShown: t.callsShown + r.callsShown,
        qualifiedCalls: t.qualifiedCalls + r.qualifiedCalls, callsClosed: t.callsClosed + r.callsClosed,
        cashCollected: t.cashCollected + r.cashCollected, contractedRevenue: t.contractedRevenue + r.contractedRevenue,
        clicks: t.clicks + r.clicks,
      }),
      { cost: 0, leads: 0, qualifiedLeads: 0, callsBooked: 0, callsShown: 0, qualifiedCalls: 0, callsClosed: 0, cashCollected: 0, contractedRevenue: 0, clicks: 0 }
    );
  }, [rows]);

  // Lookup leads that belong to a row at the current drill level.
  const leadsForRow = (row: RowStats): Lead[] => {
    switch (currentLevel) {
      case 'source': return filteredLeads.filter(l => displaySource(l) === row.name);
      case 'adAccount': return filteredLeads.filter(l => (l.adAccountName || 'Unknown') === row.name);
      case 'campaign':
        if (colMode === 'organic') return filteredLeads.filter(l => organicCampaignBucket(l) === row.name);
        return filteredLeads.filter(l => (l.campaignName || 'Unknown') === row.name);
      case 'adSet':
        if (colMode === 'organic') return filteredLeads.filter(l => organicAdSetKey(l) === row.name);
        return filteredLeads.filter(l => (l.adSetName || 'Default') === row.name);
      case 'ad': return filteredLeads.filter(l => (l.adName || l.name || 'Unknown') === row.name);
    }
  };

  const handleRowClick = (row: RowStats) => {
    // Ad level: show the actual lead list for this ad. Do NOT open Facebook
    // Ad Library — Meta's public Ad Library URL doesn't map to Graph API ad
    // IDs, so those links were dead-ending. Clicking the thumbnail still
    // opens Ads Manager (see thumbnail button below).
    if (currentLevel === 'ad') {
      if (onViewLeads) onViewLeads(leadsForRow(row), `Leads from: ${row.name}`);
      return;
    }
    // Organic Ad Set level: the next drill (ad) doesn't exist for organic
    // sources, so open the lead list here instead of trying to drill further.
    // leadsForRow already handles YouTube's campaignName-based grouping.
    if (colMode === 'organic' && currentLevel === 'adSet' && onViewLeads) {
      onViewLeads(leadsForRow(row), `Leads from: ${row.name}`);
      return;
    }
    setFilters([...filters, { level: currentLevel, values: [row.name] }]);
    setChecked(new Set());
  };

  // Click handlers for the Leads / Calls / Shown numbers — open LeadDetail
  // filtered by the relevant lifecycle stage.
  const handleLeadsClick = (e: React.MouseEvent, row: RowStats) => {
    e.stopPropagation();
    if (onViewLeads && row.leads > 0) onViewLeads(leadsForRow(row), `Leads from: ${row.name}`);
  };
  const handleCallsClick = (e: React.MouseEvent, row: RowStats) => {
    e.stopPropagation();
    if (onViewLeads && row.callsBooked > 0) {
      onViewLeads(leadsForRow(row).filter(l => l.demoBooked), `Calls booked: ${row.name}`);
    }
  };
  const handleShownClick = (e: React.MouseEvent, row: RowStats) => {
    e.stopPropagation();
    if (onViewLeads && row.callsShown > 0) {
      onViewLeads(leadsForRow(row).filter(l => l.showStatus === 'Showed'), `Calls shown: ${row.name}`);
    }
  };

  // Thumbnail click at Ad level → open Meta Ads Manager with this ad selected.
  // Ads Manager reliably deep-links via `selected_ad_ids` param when the user
  // is logged into Facebook Business. Ad Library URL was broken (ID mismatch).
  const openAdInMetaManager = (e: React.MouseEvent, adId: string) => {
    e.stopPropagation();
    const acct = process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID ?? '';
    window.open(
      `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acct}&selected_ad_ids=${adId}`,
      '_blank',
      'noopener',
    );
  };

  const drillIntoChecked = () => {
    if (checked.size === 0 || currentLevel === 'ad') return;
    setFilters([...filters, { level: currentLevel, values: Array.from(checked) }]);
    setChecked(new Set());
  };

  const toggleChecked = (name: string, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleClosedClick = (e: React.MouseEvent, row: RowStats) => {
    e.stopPropagation();
    if (onViewLeads && row.callsClosed > 0) {
      // Reuse leadsForRow which already handles organic/paid grouping correctly
      // at every drill level. Previously this had inline matching that didn't
      // account for organic sources (e.g. Unknown) where groupKey uses l.source
      // instead of l.adAccountName.
      const closedLeads = leadsForRow(row).filter(l =>
        l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1
      );
      onViewLeads(closedLeads, `Closes from: ${row.name}`);
    }
  };

  const removeFilter = (index: number) => setFilters(filters.slice(0, index));

  const toggleSort = (key: keyof RowStats) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const pct = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—';
  const money = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyShort = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const perUnit = (cost: number, units: number) => units > 0 ? money(cost / units) : '—';

  const sourceIcon = (name: string) => {
    const icons: Record<string, string> = {
      'Facebook Ads': '🔵', 'YouTube': '🔴', 'Instagram': '🟣', 'LinkedIn': '🔷', 'X': '⬛',
    };
    return icons[name] || '⚪';
  };

  // Column order — must match <colgroup> and header cells below.
  const PAID_COLS = [
    'name', 'cost', 'leads', 'cpl', 'qualifiedLeads', 'cpql',
    'callsBooked', 'cpcCall', 'callsShown', 'showRate', 'costPerShow',
    'qualifiedCalls', 'cpqc', 'callsClosed', 'closeRate', 'cpa',
    'cashCollected', 'contractedRevenue', 'upfrontPct', 'roas', 'roi',
  ];
  // Organic column set (per the spec 2026-04-08): no cost-based metrics since
  // organic sources have $0 spend. Focus: booked/shown/closed + revenue.
  const ORGANIC_COLS = [
    'name', 'leads', 'callsBooked', 'callsShown', 'showRate',
    'callsClosed', 'closeRate', 'cashCollected', 'contractedRevenue', 'upfrontPct',
  ];
  const COL_ORDER = colMode === 'organic' ? ORGANIC_COLS : PAID_COLS;

  const ResizeHandle = ({ col }: { col: string }) => (
    <span
      onMouseDown={(e) => onResizeStart(col, e)}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-500/50"
      style={{ userSelect: 'none' }}
    />
  );

  const SH = ({ label, field, col, left }: { label: string; field: keyof RowStats; col: string; left?: boolean }) => (
    <th
      className={`${left ? 'text-left' : 'text-right'} py-3 px-2 cursor-pointer hover:text-gray-300 select-none whitespace-nowrap relative sticky top-0 bg-[#1a1d23] z-20`}
      onClick={() => toggleSort(field)}
    >
      {label} {sortKey === field ? (sortDir === 'desc' ? '↓' : '↑') : ''}
      <ResizeHandle col={col} />
    </th>
  );

  const PH = ({ label, col }: { label: string; col: string }) => (
    <th className="text-right py-3 px-2 whitespace-nowrap relative sticky top-0 bg-[#1a1d23] z-20">
      {label}
      <ResizeHandle col={col} />
    </th>
  );

  const renderValue = (val: number | string, kpiKey?: string, isGreen?: boolean) => {
    const str = typeof val === 'string' ? val : '';
    if (typeof val === 'string' && val === '—') return <span className="text-gray-600">—</span>;
    const numVal = typeof val === 'number' ? val : parseFloat(val);
    const bad = kpiKey && !isNaN(numVal) && numVal > 0 ? !isWithinKPI(kpiKey, numVal) : false;
    return <span className={bad ? 'text-red-400' : isGreen ? 'text-emerald-400' : ''}>{str || val}</span>;
  };

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
      {/* Tab Bar — clickable breadcrumb levels (click any level to jump there) */}
      <div className="flex items-center border-b border-gray-700 overflow-x-auto px-2">
        {LEVELS.filter(l => !(colMode === 'organic' && l === 'ad')).map((level) => {
          const levelIdx = LEVELS.indexOf(level);
          const currentIdx = LEVELS.indexOf(currentLevel);
          const filter = filters.find(f => f.level === level);
          const isActive = currentLevel === level;
          const isPast = levelIdx < currentIdx;
          // Every level up to and including the current level is clickable.
          // Clicking a past or current level jumps back to it by truncating
          // filters. Future levels are shown but not clickable (need to drill
          // via row click to get there).
          const isClickable = levelIdx <= currentIdx;

          return (
            <div key={level} className="flex items-center shrink-0">
              <button
                className={`px-2.5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                  isActive ? 'text-white border-blue-500'
                  : isPast ? 'text-gray-300 border-transparent hover:text-white cursor-pointer'
                  : 'text-gray-500 border-transparent'
                } ${isClickable && !isActive ? 'hover:text-white' : ''}`}
                onClick={() => {
                  if (!isClickable) return;
                  // Jump to this level: keep only filters for levels BEFORE it.
                  // E.g. clicking "Campaign" keeps source + adAccount filters,
                  // dropping campaign/adSet/ad filters.
                  const newFilters = filters.filter(f => LEVELS.indexOf(f.level) < levelIdx);
                  setFilters(newFilters);
                  setChecked(new Set());
                }}
                disabled={!isClickable}
                title={
                  isActive ? 'Current level'
                  : isPast ? `Jump back to ${LEVEL_LABELS[level]}`
                  : ''
                }
              >
                {LEVEL_LABELS[level]}
              </button>
              {isPast && filter && (
                <button
                  className="flex items-center gap-1 px-2 py-1 bg-gray-700 text-gray-300 text-[11px] font-medium rounded ml-1 my-1.5 hover:bg-gray-600"
                  onClick={() => {
                    // Clicking the filter chip also jumps to this level
                    const newFilters = filters.filter(f => LEVELS.indexOf(f.level) < levelIdx);
                    setFilters(newFilters);
                    setChecked(new Set());
                  }}
                >
                  {filter.values.length > 1
                    ? `${filter.values.length} selected`
                    : (filter.values[0].length > 20 ? filter.values[0].slice(0, 20) + '…' : filter.values[0])}
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Search + multi-select action bar */}
      <div className="px-3 py-2 border-b border-gray-700/50 bg-[#15181d] flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${LEVEL_LABELS[currentLevel].toLowerCase()}...`}
          className="flex-1 bg-gray-800 text-gray-200 text-xs placeholder-gray-500 rounded px-3 py-2 border border-gray-700 focus:border-blue-500 focus:outline-none"
        />
        {checked.size > 0 && currentLevel !== 'ad' && (
          <>
            <button
              onClick={drillIntoChecked}
              className="text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded whitespace-nowrap"
            >
              Drill into {checked.size} →
            </button>
            <button
              onClick={() => setChecked(new Set())}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-2"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="text-[13px] text-gray-300" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            {COL_ORDER.map(c => (
              <col key={c} style={{ width: `${colWidths[c] ?? 100}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase border-b border-gray-700/50">
              <th className="text-left py-3 px-3 sticky left-0 top-0 bg-[#1a1d23] z-30 relative">
                <div className="flex items-center gap-2">
                  {currentLevel !== 'ad' && rows.length > 0 && (
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every(r => checked.has(r.name))}
                      ref={(el) => {
                        if (el) el.indeterminate = checked.size > 0 && !rows.every(r => checked.has(r.name));
                      }}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (rows.every(r => checked.has(r.name))) {
                          setChecked(new Set());
                        } else {
                          setChecked(new Set(rows.map(r => r.name)));
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 cursor-pointer accent-blue-500"
                    />
                  )}
                  <span>{LEVEL_LABELS[currentLevel]}</span>
                </div>
                <ResizeHandle col="name" />
              </th>
              {colMode === 'paid' ? (
                <>
                  <SH label="Cost" field="cost" col="cost" />
                  <SH label="Leads" field="leads" col="leads" />
                  <PH label="CPL" col="cpl" />
                  <SH label="Qual. Leads" field="qualifiedLeads" col="qualifiedLeads" />
                  <PH label="CPQL" col="cpql" />
                  <SH label="Calls" field="callsBooked" col="callsBooked" />
                  <PH label="CPC (Call)" col="cpcCall" />
                  <SH label="Shown" field="callsShown" col="callsShown" />
                  <PH label="Show Rate" col="showRate" />
                  <PH label="Cost/Show" col="costPerShow" />
                  <SH label="Qual. Calls" field="qualifiedCalls" col="qualifiedCalls" />
                  <PH label="CPQC" col="cpqc" />
                  <SH label="Closed" field="callsClosed" col="callsClosed" />
                  <PH label="Close Rate" col="closeRate" />
                  <PH label="CPA" col="cpa" />
                  <SH label="Cash Collected" field="cashCollected" col="cashCollected" />
                  <SH label="Cash/Call" field="cashPerCall" col="cashPerCall" />
                  <SH label="Contracted Rev" field="contractedRevenue" col="contractedRevenue" />
                  <PH label="Upfront %" col="upfrontPct" />
                  <PH label="ROAS" col="roas" />
                  <PH label="ROI" col="roi" />
                </>
              ) : (
                <>
                  <SH label="Leads" field="leads" col="leads" />
                  <SH label="Booked Calls" field="callsBooked" col="callsBooked" />
                  <SH label="Shown" field="callsShown" col="callsShown" />
                  <PH label="Show Rate" col="showRate" />
                  <SH label="Closed" field="callsClosed" col="callsClosed" />
                  <PH label="Close Rate" col="closeRate" />
                  <SH label="Cash Collected" field="cashCollected" col="cashCollected" />
                  <SH label="Cash/Call" field="cashPerCall" col="cashPerCall" />
                  <SH label="Contracted Rev" field="contractedRevenue" col="contractedRevenue" />
                  <PH label="Up Front Cash" col="upfrontPct" />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {/* Totals — pinned directly below the header row so they stay
                visible while scrolling through many rows. */}
            <tr className="border-b-2 border-blue-500/40 bg-[#1c2430] font-semibold text-white text-[13px] [&>td]:sticky [&>td]:top-[44px] [&>td]:bg-[#1c2430]">
              <td className="py-2.5 px-3 !sticky !left-0 !top-[44px] !bg-[#1c2430] z-20">Total</td>
              {colMode === 'paid' ? (
                <>
                  <td className="text-right py-2.5 px-2">{money(totals.cost)}</td>
                  <td className="text-right py-2.5 px-2">{totals.leads}</td>
                  <td className="text-right py-2.5 px-2">{perUnit(totals.cost, totals.leads)}</td>
                  <td className="text-right py-2.5 px-2">{totals.qualifiedLeads}</td>
                  <td className="text-right py-2.5 px-2">{perUnit(totals.cost, totals.qualifiedLeads)}</td>
                  <td className="text-right py-2.5 px-2">{totals.callsBooked}</td>
                  <td className="text-right py-2.5 px-2">{perUnit(totals.cost, totals.callsBooked)}</td>
                  <td className="text-right py-2.5 px-2">{totals.callsShown}</td>
                  <td className="text-right py-2.5 px-2">{pct(totals.callsShown, totals.callsBooked)}</td>
                  <td className="text-right py-2.5 px-2">{perUnit(totals.cost, totals.callsShown)}</td>
                  <td className="text-right py-2.5 px-2">{totals.qualifiedCalls}</td>
                  <td className="text-right py-2.5 px-2">{perUnit(totals.cost, totals.qualifiedCalls)}</td>
                  <td className="text-right py-2.5 px-2">{totals.callsClosed}</td>
                  <td className="text-right py-2.5 px-2">{pct(totals.callsClosed, totals.callsShown)}</td>
                  <td className="text-right py-2.5 px-2">{perUnit(totals.cost, totals.callsClosed)}</td>
                  <td className="text-right py-2.5 px-2 text-emerald-400">{moneyShort(totals.cashCollected)}</td>
                  <td className="text-right py-2.5 px-2 text-yellow-400">{totals.callsShown > 0 ? moneyShort(totals.cashCollected / totals.callsShown) : '—'}</td>
                  <td className="text-right py-2.5 px-2 text-emerald-400">{moneyShort(totals.contractedRevenue)}</td>
                  <td className="text-right py-2.5 px-2">{totals.contractedRevenue > 0 ? pct(totals.cashCollected, totals.contractedRevenue) : '—'}</td>
                  <td className="text-right py-2.5 px-2">{totals.cost > 0 ? (totals.cashCollected / totals.cost).toFixed(2) : '—'}</td>
                  <td className="text-right py-2.5 px-2 text-emerald-400">{totals.cost > 0 ? (((totals.cashCollected - totals.cost) / totals.cost) * 100).toFixed(1) + '%' : '—'}</td>
                </>
              ) : (
                <>
                  <td className="text-right py-2.5 px-2">{totals.leads}</td>
                  <td className="text-right py-2.5 px-2">{totals.callsBooked}</td>
                  <td className="text-right py-2.5 px-2">{totals.callsShown}</td>
                  <td className="text-right py-2.5 px-2">{pct(totals.callsShown, totals.callsBooked)}</td>
                  <td className="text-right py-2.5 px-2">{totals.callsClosed}</td>
                  <td className="text-right py-2.5 px-2">{pct(totals.callsClosed, totals.callsShown)}</td>
                  <td className="text-right py-2.5 px-2 text-emerald-400">{moneyShort(totals.cashCollected)}</td>
                  <td className="text-right py-2.5 px-2 text-yellow-400">{totals.callsShown > 0 ? moneyShort(totals.cashCollected / totals.callsShown) : '—'}</td>
                  <td className="text-right py-2.5 px-2 text-emerald-400">{moneyShort(totals.contractedRevenue)}</td>
                  <td className="text-right py-2.5 px-2 text-emerald-400">{totals.contractedRevenue > 0 ? moneyShort(totals.cashCollected) : '—'}</td>
                </>
              )}
            </tr>

            {/* Rows */}
            {rows.map(row => {
              const showRate = row.callsBooked > 0 ? (row.callsShown / row.callsBooked) * 100 : 0;
              const closeRate = row.callsShown > 0 ? (row.callsClosed / row.callsShown) * 100 : 0;
              const roas = row.cost > 0 ? row.cashCollected / row.cost : 0;
              const roi = row.cost > 0 ? ((row.cashCollected - row.cost) / row.cost) * 100 : 0;
              const cpa = row.callsClosed > 0 ? row.cost / row.callsClosed : 0;
              const cpqc = row.qualifiedCalls > 0 ? row.cost / row.qualifiedCalls : 0;
              const cpql = row.qualifiedLeads > 0 ? row.cost / row.qualifiedLeads : 0;
              const cpl = row.leads > 0 ? row.cost / row.leads : 0;
              const costPerCall = row.callsBooked > 0 ? row.cost / row.callsBooked : 0;
              const costPerShow = row.callsShown > 0 ? row.cost / row.callsShown : 0;
              const upfrontPct = row.contractedRevenue > 0 ? (row.cashCollected / row.contractedRevenue) * 100 : 0;

              return (
                <tr
                  key={row.name}
                  draggable
                  onDragStart={(e) => handleDragStart(e, row.name)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, row.name)}
                  className={`border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors ${
                    dragRow === row.name ? 'opacity-40' : ''
                  }`}
                  onClick={() => handleRowClick(row)}
                >
                  <td className="py-2.5 px-3 font-medium text-white sticky left-0 bg-[#1a1d23] z-10">
                    <div className="flex items-center gap-2 truncate max-w-[400px]">
                      {currentLevel !== 'ad' && (
                        <input
                          type="checkbox"
                          checked={checked.has(row.name)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => toggleChecked(row.name, e)}
                          className="shrink-0 w-4 h-4 cursor-pointer accent-blue-500"
                        />
                      )}
                      {currentLevel === 'source' && <ChannelIcon channel={row.name} size={14} className="shrink-0" />}
                      {currentLevel === 'ad' && row.adId && (() => {
                        const effectiveActive = statusOverrides[row.adId] ?? row.active ?? false;
                        const busy = togglingIds.has(row.adId);
                        return (
                          <button
                            onClick={(e) => toggleAdStatus(row.adId!, effectiveActive, e)}
                            disabled={busy}
                            title={effectiveActive ? 'Pause ad' : 'Activate ad'}
                            className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                              effectiveActive ? 'bg-emerald-500' : 'bg-gray-600'
                            } ${busy ? 'opacity-50' : ''}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${effectiveActive ? 'translate-x-4' : ''}`} />
                          </button>
                        );
                      })()}
                      {row.thumbnailUrl && (
                        row.adId ? (
                          <button
                            onClick={(e) => openAdInMetaManager(e, row.adId!)}
                            className="shrink-0 hover:opacity-80 transition-opacity"
                            title="Open in Meta Ads Manager"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={row.thumbnailUrl}
                              alt=""
                              className="w-10 h-10 rounded object-cover border border-gray-700"
                            />
                          </button>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.thumbnailUrl}
                            alt=""
                            className="w-10 h-10 rounded object-cover shrink-0 border border-gray-700"
                          />
                        )
                      )}
                      {/* Campaign/adSet status dot — derived from underlying ad statuses */}
                      {row.campaignStatus && (currentLevel === 'campaign' || currentLevel === 'adSet') && (
                        <span
                          className={`shrink-0 w-2 h-2 rounded-full ${
                            row.campaignStatus === 'active' ? 'bg-emerald-400' :
                            row.campaignStatus === 'mixed' ? 'bg-yellow-400' :
                            'bg-gray-500'
                          }`}
                          title={
                            row.campaignStatus === 'active' ? 'Active' :
                            row.campaignStatus === 'mixed' ? 'Partially active' :
                            'Paused'
                          }
                        />
                      )}
                      <button
                        className="truncate text-left text-blue-300 hover:text-blue-100 hover:underline decoration-dotted underline-offset-2 transition-colors"
                        title={currentLevel === 'ad' ? `View leads: ${row.name}` : `Drill into: ${row.name}`}
                        onClick={(e) => { e.stopPropagation(); handleRowClick(row); }}
                      >
                        {row.name}
                      </button>
                      {/* Drill chevron — hidden at terminal levels */}
                      {!(currentLevel === 'ad' || (colMode === 'organic' && currentLevel === 'adSet')) && (
                        <ChevronRight size={14} className="shrink-0 text-gray-500 ml-auto" />
                      )}
                    </div>
                  </td>
                  {colMode === 'paid' ? (
                    <>
                      <td className="text-right py-2.5 px-2">{money(row.cost)}</td>
                      <td className="text-right py-2.5 px-2">
                        {row.leads > 0 ? (
                          <button onClick={(e) => handleLeadsClick(e, row)} className="text-blue-300 hover:text-blue-200 underline decoration-dotted underline-offset-2">
                            {row.leads}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        <span className={cpl > 0 && !isWithinKPI('cpl', cpl) ? 'text-red-400' : ''}>{perUnit(row.cost, row.leads)}</span>
                      </td>
                      <td className="text-right py-2.5 px-2">{row.qualifiedLeads}</td>
                      <td className="text-right py-2.5 px-2">{perUnit(row.cost, row.qualifiedLeads)}</td>
                      <td className="text-right py-2.5 px-2">
                        {row.callsBooked > 0 ? (
                          <button onClick={(e) => handleCallsClick(e, row)} className="text-blue-300 hover:text-blue-200 underline decoration-dotted underline-offset-2">
                            {row.callsBooked}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">{perUnit(row.cost, row.callsBooked)}</td>
                      <td className="text-right py-2.5 px-2">
                        {row.callsShown > 0 ? (
                          <button onClick={(e) => handleShownClick(e, row)} className="text-blue-300 hover:text-blue-200 underline decoration-dotted underline-offset-2">
                            {row.callsShown}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        <span className={showRate > 0 && !isWithinKPI('showRate', showRate) ? 'text-red-400' : showRate >= 70 ? 'text-emerald-400' : ''}>
                          {pct(row.callsShown, row.callsBooked)}
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-2">{perUnit(row.cost, row.callsShown)}</td>
                      <td className="text-right py-2.5 px-2">{row.qualifiedCalls}</td>
                      <td className="text-right py-2.5 px-2">
                        <span className={cpqc > 0 && !isWithinKPI('cpqc', cpqc) ? 'text-red-400' : ''}>{perUnit(row.cost, row.qualifiedCalls)}</span>
                      </td>
                      <td className="text-right py-2.5 px-2">
                        {row.callsClosed > 0 ? (
                          <button
                            onClick={(e) => handleClosedClick(e, row)}
                            className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted underline-offset-2 font-medium"
                          >
                            {row.callsClosed}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        <span className={closeRate > 0 && !isWithinKPI('closeRate', closeRate) ? 'text-red-400' : closeRate >= 30 ? 'text-emerald-400' : ''}>
                          {pct(row.callsClosed, row.callsShown)}
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-2">
                        <span className={cpa > 0 && !isWithinKPI('costPerPurchase', cpa) ? 'text-red-400' : ''}>{perUnit(row.cost, row.callsClosed)}</span>
                      </td>
                      <td className="text-right py-2.5 px-2 font-medium text-emerald-400">{moneyShort(row.cashCollected)}</td>
                      <td className="text-right py-2.5 px-2 text-yellow-400">{row.cashPerCall > 0 ? moneyShort(row.cashPerCall) : '—'}</td>
                      <td className="text-right py-2.5 px-2 text-emerald-300">{moneyShort(row.contractedRevenue)}</td>
                      <td className="text-right py-2.5 px-2">{row.contractedRevenue > 0 ? pct(row.cashCollected, row.contractedRevenue) : '—'}</td>
                      <td className="text-right py-2.5 px-2">
                        <span className={roas > 0 && !isWithinKPI('roas', roas) ? 'text-red-400' : roas >= 2 ? 'text-emerald-400' : ''}>
                          {row.cost > 0 ? roas.toFixed(2) : '—'}
                        </span>
                      </td>
                      <td className={`text-right py-2.5 px-2 font-medium ${roi > 0 ? 'text-emerald-400' : roi < 0 ? 'text-red-400' : ''}`}>
                        {row.cost > 0 ? roi.toFixed(1) + '%' : '—'}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-right py-2.5 px-2">
                        {row.leads > 0 ? (
                          <button onClick={(e) => handleLeadsClick(e, row)} className="text-blue-300 hover:text-blue-200 underline decoration-dotted underline-offset-2">
                            {row.leads}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        {row.callsBooked > 0 ? (
                          <button onClick={(e) => handleCallsClick(e, row)} className="text-blue-300 hover:text-blue-200 underline decoration-dotted underline-offset-2">
                            {row.callsBooked}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        {row.callsShown > 0 ? (
                          <button onClick={(e) => handleShownClick(e, row)} className="text-blue-300 hover:text-blue-200 underline decoration-dotted underline-offset-2">
                            {row.callsShown}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        <span className={showRate >= 70 ? 'text-emerald-400' : ''}>
                          {pct(row.callsShown, row.callsBooked)}
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-2">
                        {row.callsClosed > 0 ? (
                          <button
                            onClick={(e) => handleClosedClick(e, row)}
                            className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted underline-offset-2 font-medium"
                          >
                            {row.callsClosed}
                          </button>
                        ) : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="text-right py-2.5 px-2">
                        <span className={closeRate >= 30 ? 'text-emerald-400' : ''}>
                          {pct(row.callsClosed, row.callsShown)}
                        </span>
                      </td>
                      <td className="text-right py-2.5 px-2 font-medium text-emerald-400">{moneyShort(row.cashCollected)}</td>
                      <td className="text-right py-2.5 px-2 text-yellow-400">{row.cashPerCall > 0 ? moneyShort(row.cashPerCall) : '—'}</td>
                      <td className="text-right py-2.5 px-2 text-emerald-300">{moneyShort(row.contractedRevenue)}</td>
                      <td className="text-right py-2.5 px-2 text-emerald-400">
                        {row.contractedRevenue > 0 ? moneyShort(row.cashCollected) : '—'}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
