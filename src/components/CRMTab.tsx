'use client';

/**
 * CRM — a direct mirror of the Supabase source tables.
 *
 * Three subtabs, each self-fetching from its own API endpoint:
 *   Sales  → GET /api/data/sales         (t06_deals_closed)
 *   Leads  → GET /api/data/t01-leads     (t01_leads)
 *   Calls  → GET /api/data/bookings      (t03_bookings)
 *
 * Zero shared Lead[] array. Zero GHL live calls. Zero mock fallback.
 * If a row exists in a Supabase table, it shows here. If not, empty state.
 *
 * the operator rule (2026-04-23): "Dashboard = mirror of Supabase."
 */

import { useState, useEffect, useMemo } from 'react';
import { DollarSign, Phone, Users, ExternalLink } from 'lucide-react';
import PillSelect, { PillSelectOption } from './PillSelect';
import TimeframeSelector from './TimeframeSelector';

type CRMView = 'sales' | 'leads' | 'calls';

function money(n: number | null | undefined): string {
  if (!n) return '—';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function moneyPrecise(n: number | null | undefined): string {
  if (!n) return '$0';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
// the operator 2026-05-01: build YYYY-MM-DD from local time so the picker's
// "today"/"first of month" don't roll a day at evening ET.
function firstOfMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function rangeLabel(s: string, e: string): string {
  if (s === e) return s;
  return `${s} → ${e}`;
}

export default function CRMTab() {
  const [view, setView] = useState<CRMView>('leads');
  const [start, setStart] = useState<string>(firstOfMonth());
  const [end, setEnd] = useState<string>(today());

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">CRM</h2>
            <p className="text-sm text-gray-500 mt-1">Live mirror of Supabase — t06 deals · t01 leads · t03 bookings</p>
          </div>
          {/* the operator 2026-05-01: replaced raw From/To date inputs with
              the shared modal-based TimeframeSelector that matches the
              main dashboard. Same component, same UX, no more two-input
              popup-calendar mess. */}
          <TimeframeSelector
            value={{ start, end, label: rangeLabel(start, end) }}
            onChange={(r) => { setStart(r.start); setEnd(r.end); }}
          />
        </div>

        {/* Subtab switcher */}
        <div className="flex items-center gap-1 mt-5 border-b border-gray-700">
          <TabButton active={view === 'leads'} onClick={() => setView('leads')} icon={<Users size={14} />} label="Leads" color="purple" />
          <TabButton active={view === 'calls'} onClick={() => setView('calls')} icon={<Phone size={14} />} label="Calls" color="amber" />
          <TabButton active={view === 'sales'} onClick={() => setView('sales')} icon={<DollarSign size={14} />} label="Sales" color="emerald" />
        </div>
      </div>

      {view === 'sales' && <SalesView start={start} end={end} />}
      {view === 'leads' && <LeadsView start={start} end={end} />}
      {view === 'calls' && <CallsView start={start} end={end} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, color }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color: 'emerald' | 'purple' | 'amber' }) {
  const colors = {
    emerald: { fg: '#34d399', border: '#10b981' },
    purple: { fg: '#a78bfa', border: '#8b5cf6' },
    amber: { fg: '#fbbf24', border: '#f59e0b' },
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active ? '' : 'text-gray-400 border-transparent hover:text-white'
      }`}
      style={active ? { color: colors[color].fg, borderColor: colors[color].border } : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sales view — reads t06_deals_closed
// ═══════════════════════════════════════════════════════════════════════════

interface Deal {
  id: string;
  date_closed: string;
  name: string | null;
  email: string | null;
  offer: string | null;
  cash_collected: number;
  contracted_revenue: number;
  source: string | null;
  closer: string | null;
  deal_type: 'new' | 'upsell' | 'renewal' | null;
  close_path: string | null;
  payment_plan: string | null;
  sales_call_recording: string | null;
  why_they_bought: string | null;
  lead_source: string | null;
  contact_link: string | null;
}
interface SalesResp { deals: Deal[]; summary: { deal_count: number; total_cash: number; total_contracted: number; new_count: number; upsell_count: number; renewal_count: number } }

function SalesView({ start, end }: { start: string; end: string }) {
  const [resp, setResp] = useState<SalesResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch(`/api/data/sales?start=${start}&end=${end}&limit=1000`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setResp(d);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [start, end]);

  const s = resp?.summary;
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Deals" value={s?.deal_count ?? 0} />
        <Card label="Cash Collected" value={money(s?.total_cash)} color="emerald" />
        <Card label="Contracted" value={money(s?.total_contracted)} />
        <Card label="New" value={s?.new_count ?? 0} />
        <Card label="Upsell + Renewal" value={(s?.upsell_count ?? 0) + (s?.renewal_count ?? 0)} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 border-b border-neutral-800">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Closer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Cash</th>
                <th className="px-4 py-3 text-right">Contracted</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {(resp?.deals ?? []).map((d) => {
                const isOpen = expandedId === d.id;
                return (
                  <>
                    <tr key={d.id} onClick={() => setExpandedId(isOpen ? null : d.id)} className="cursor-pointer hover:bg-neutral-800/50">
                      <td className="px-4 py-3 text-neutral-500">{isOpen ? '▾' : '▸'}</td>
                      <td className="px-4 py-3 text-neutral-400">{d.date_closed}</td>
                      <td className="px-4 py-3">
                        <div className="text-white font-medium">{d.name ?? '—'}</div>
                        {d.email && <div className="text-xs text-neutral-500">{d.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-neutral-300 truncate max-w-[200px]">{d.offer ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-neutral-400">{d.lead_source ?? d.source ?? '—'}</td>
                      <td className="px-4 py-3 text-neutral-300">{d.closer ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                          d.deal_type === 'upsell' ? 'bg-blue-900/40 text-blue-300' :
                          d.deal_type === 'renewal' ? 'bg-purple-900/40 text-purple-300' :
                          'bg-neutral-800 text-neutral-400'
                        }`}>{d.deal_type ?? 'new'}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-300 font-medium">{moneyPrecise(d.cash_collected)}</td>
                      <td className="px-4 py-3 text-right text-neutral-400">{moneyPrecise(d.contracted_revenue)}</td>
                      <td className="px-4 py-3">
                        {d.contact_link && (
                          <a href={d.contact_link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-blue-400 hover:text-blue-300">
                            GHL ↗
                          </a>
                        )}
                      </td>
                    </tr>
                    {isOpen && <SalesDetail deal={d} />}
                  </>
                );
              })}
              {!loading && (resp?.deals ?? []).length === 0 && (
                <tr><td colSpan={10} className="text-center text-neutral-500 italic py-8">No deals in this period.</td></tr>
              )}
              {loading && <tr><td colSpan={10} className="text-center text-neutral-500 py-8">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SalesDetail({ deal }: { deal: Deal }) {
  return (
    <tr>
      <td colSpan={10} className="p-0 bg-neutral-950">
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <InfoBlock label="Payment Plan">{deal.payment_plan ?? '—'}</InfoBlock>
            <InfoBlock label="Close Path">{deal.close_path === 'funnel' ? 'Booking → call → close (funnel)' : deal.close_path === 'direct' ? 'Direct close (no booking)' : '—'}</InfoBlock>
            <InfoBlock label="Sales Call Recording">
              {deal.sales_call_recording ? (
                <a href={deal.sales_call_recording} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                  Open Grain recording <ExternalLink size={12} />
                </a>
              ) : '—'}
            </InfoBlock>
            <InfoBlock label="GHL Contact">
              {deal.contact_link ? (
                <a href={deal.contact_link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
                  Open contact <ExternalLink size={12} />
                </a>
              ) : '—'}
            </InfoBlock>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Why They Bought (Claude analysis)</div>
            <div className="bg-neutral-900 border border-neutral-800 rounded p-3 text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
              {deal.why_they_bought ?? <em className="text-neutral-500">Not yet analyzed.</em>}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Leads view — reads t01_leads
// ═══════════════════════════════════════════════════════════════════════════

interface LeadRow {
  id: string; date: string; name: string | null; email: string | null; phone: string | null;
  source: string | null; offer: string | null; campaign_name: string | null;
  ad_set_name: string | null; ad_name: string | null; contact_link: string | null;
}
interface LeadsResp { leads: LeadRow[]; summary: { total: number; by_source: Record<string, number>; by_offer: Record<string, number> } }

function LeadsView({ start, end }: { start: string; end: string }) {
  const [resp, setResp] = useState<LeadsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch(`/api/data/t01-leads?start=${start}&end=${end}&limit=3000`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setResp(d);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [start, end]);

  const filtered = useMemo(() => {
    let rows = resp?.leads ?? [];
    if (sourceFilter !== 'all') rows = rows.filter(r => r.source === sourceFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => `${r.name ?? ''} ${r.email ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(q));
    }
    return rows;
  }, [resp, search, sourceFilter]);

  const sources = Object.keys(resp?.summary.by_source ?? {}).sort();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Total leads" value={resp?.summary.total ?? 0} color="purple" />
        {sources.slice(0, 3).map(s => (
          <Card key={s} label={s} value={resp?.summary.by_source[s] ?? 0} />
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        <input type="text" placeholder="Search name / email / phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-neutral-900 text-white border border-neutral-700 rounded px-3 py-1.5 text-sm flex-1" />
        <PillSelect
          value={sourceFilter}
          options={[
            { value: 'all', label: 'All sources', color: 'gray' },
            ...sources.map<PillSelectOption>((s) => ({
              value: s,
              label: `${s} (${resp?.summary.by_source[s] ?? 0})`,
              color: 'blue',
            })),
          ]}
          onChange={setSourceFilter}
          maxLabelWidth={200}
        />
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 border-b border-neutral-800">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map(l => (
                <tr key={l.id} className="hover:bg-neutral-800/30">
                  <td className="px-4 py-3 text-neutral-400">{l.date}</td>
                  <td className="px-4 py-3 text-white">{l.name ?? '—'}</td>
                  <td className="px-4 py-3 text-neutral-400 truncate max-w-[200px]">{l.email ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">{l.source ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-neutral-300">{l.offer ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-neutral-400 truncate max-w-[180px]">{l.campaign_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {l.contact_link && <a href={l.contact_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">GHL ↗</a>}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center text-neutral-500 italic py-8">No leads match these filters.</td></tr>}
              {loading && <tr><td colSpan={7} className="text-center text-neutral-500 py-8">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Calls view — reads t03_bookings
// ═══════════════════════════════════════════════════════════════════════════

interface Booking {
  id: string;
  date_booked_for: string;
  name: string | null;
  email: string | null;
  offer: string | null;
  calendar: string | null;
  status: string | null;
  call_outcome_explanation: string | null;
  call_outcome_details: string | null;
  closer_assigned: string | null;
  contact_link: string | null;
  lead_source: string | null;
}
interface BookingsResp { bookings: Booking[]; summary: { total: number; showed: number; no_showed: number; cancelled: number; rescheduled: number; pending: number; needs_review: number } }

function CallsView({ start, end }: { start: string; end: string }) {
  const [resp, setResp] = useState<BookingsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch(`/api/data/bookings?start=${start}&end=${end}&limit=1000`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled) setResp(d);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [start, end]);

  const filtered = useMemo(() => {
    let rows = resp?.bookings ?? [];
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r => `${r.name ?? ''} ${r.email ?? ''}`.toLowerCase().includes(q));
    }
    return rows;
  }, [resp, search, statusFilter]);

  const statusColor = (s: string | null) => {
    if (!s) return 'bg-neutral-800 text-neutral-500';
    if (s === 'Showed') return 'bg-emerald-900/40 text-emerald-300';
    if (s === 'No Showed') return 'bg-red-900/40 text-red-300';
    if (s === 'Cancelled') return 'bg-neutral-700 text-neutral-400';
    if (s === 'Rescheduled') return 'bg-amber-900/40 text-amber-300';
    if (s === 'PENDING') return 'bg-blue-900/40 text-blue-300';
    if (s === 'Needs Review') return 'bg-purple-900/40 text-purple-300';
    return 'bg-neutral-800 text-neutral-400';
  };

  const s = resp?.summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card label="Total" value={s?.total ?? 0} color="amber" />
        <Card label="Showed" value={s?.showed ?? 0} color="emerald" />
        <Card label="No Show" value={s?.no_showed ?? 0} color="red" />
        <Card label="Cancelled" value={s?.cancelled ?? 0} />
        <Card label="Rescheduled" value={s?.rescheduled ?? 0} />
        <Card label="Pending / NR" value={(s?.pending ?? 0) + (s?.needs_review ?? 0)} />
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        <input type="text" placeholder="Search name / email…" value={search} onChange={(e) => setSearch(e.target.value)} className="bg-neutral-900 text-white border border-neutral-700 rounded px-3 py-1.5 text-sm flex-1" />
        <PillSelect
          value={statusFilter}
          options={[
            { value: 'all',           label: 'All statuses',  color: 'gray' },
            { value: 'Showed',        label: 'Showed',        color: 'emerald' },
            { value: 'No Showed',     label: 'No Showed',     color: 'red' },
            { value: 'Cancelled',     label: 'Cancelled',     color: 'gray' },
            { value: 'Rescheduled',   label: 'Rescheduled',   color: 'amber' },
            { value: 'PENDING',       label: 'Pending',       color: 'blue' },
            { value: 'Needs Review',  label: 'Needs Review',  color: 'purple' },
          ]}
          onChange={setStatusFilter}
          maxLabelWidth={200}
        />
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 border-b border-neutral-800">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3">Booked For</th>
                <th className="px-4 py-3">Prospect</th>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Calendar</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Closer</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map(b => (
                <tr key={b.id} className="hover:bg-neutral-800/30">
                  <td className="px-4 py-3 text-neutral-400">{b.date_booked_for?.slice(0, 10)}</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{b.name ?? '—'}</div>
                    {b.email && <div className="text-xs text-neutral-500">{b.email}</div>}
                  </td>
                  <td className="px-4 py-3 text-neutral-300 text-xs">{b.offer ?? '—'}</td>
                  <td className="px-4 py-3 text-neutral-400 text-xs truncate max-w-[180px]">{b.calendar ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs ${statusColor(b.status)}`}>{b.status ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-neutral-300 text-xs">{b.closer_assigned?.split('@')[0] ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-neutral-400">{b.lead_source ?? '—'}</td>
                  <td className="px-4 py-3">
                    {b.contact_link && <a href={b.contact_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">GHL ↗</a>}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center text-neutral-500 italic py-8">No bookings match these filters.</td></tr>}
              {loading && <tr><td colSpan={8} className="text-center text-neutral-500 py-8">Loading…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

function Card({ label, value, color }: { label: string; value: number | string; color?: 'emerald' | 'purple' | 'amber' | 'red' }) {
  const colorClass =
    color === 'emerald' ? 'text-emerald-300' :
    color === 'purple' ? 'text-purple-300' :
    color === 'amber' ? 'text-amber-300' :
    color === 'red' ? 'text-red-300' : 'text-white';
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
      <div className="text-xs text-neutral-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</div>
    </div>
  );
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-neutral-400 mb-1">{label}</div>
      <div className="text-sm text-neutral-200">{children}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-950/60 border border-red-700 text-red-300 px-4 py-3 rounded text-sm">
      Error: {message}
    </div>
  );
}
