'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Search, ChevronDown, ChevronUp, ArrowUpDown, Plus, X,
  Users, AlertTriangle, Pause, XCircle, Clock, TrendingUp,
} from 'lucide-react';
import { STORAGE_KEYS, loadJSON, saveJSON } from '@/lib/storage/localStore';
import type { MondayClient } from '@/lib/mappers/monday';
import { getMondayCSMSummaries, getAverageClientDuration } from '@/lib/mappers/monday';
import PillSelect, { PillSelectOption } from './PillSelect';

// ---------------------------------------------------------------------------
// Types for action logging (persisted to localStorage)
// ---------------------------------------------------------------------------

interface ActionLog {
  id: string;
  type: 'upsell' | 'renewal' | 'offboarding';
  clientName: string;
  csm: string;
  date: string;
  amount?: number;
  reason?: string;
  notes?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold text-white mb-3">{children}</h2>;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color = 'text-white',
  subValue,
}: {
  label: string;
  value: string | number;
  icon?: React.ElementType;
  color?: string;
  subValue?: string;
}) {
  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-4 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-gray-500" />}
        <span className="text-xs text-gray-400 whitespace-nowrap">{label}</span>
      </div>
      <span className={`text-xl font-bold truncate ${color}`}>{value}</span>
      {subValue && <span className="text-[10px] text-gray-500">{subValue}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    'Due for Renewal': 'bg-amber-400/10 text-amber-400 border-amber-400/20',
    Paused: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
    Cancelled: 'bg-red-400/10 text-red-400 border-red-400/20',
    'Off-boarded': 'bg-red-400/10 text-red-400 border-red-400/20',
  };
  const cls = map[status] || 'bg-gray-400/10 text-gray-400 border-gray-400/20';
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

type SortDir = 'asc' | 'desc';

function SortHeader({
  label,
  field,
  sortKey,
  sortDir,
  onToggle,
  align = 'left',
}: {
  label: string;
  field: string;
  sortKey: string;
  sortDir: SortDir;
  onToggle: (k: string) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === field;
  return (
    <th
      className={`py-3 px-3 whitespace-nowrap cursor-pointer hover:text-gray-300 transition-colors select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onToggle(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
        ) : (
          <ArrowUpDown size={10} className="opacity-30" />
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Action Log Modal
// ---------------------------------------------------------------------------

function ActionLogModal({
  type,
  clients,
  onSave,
  onClose,
}: {
  type: 'upsell' | 'renewal' | 'offboarding';
  clients: MondayClient[];
  onSave: (log: ActionLog) => void;
  onClose: () => void;
}) {
  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  const titles = {
    upsell: 'Log Upsell',
    renewal: 'Log Renewal',
    offboarding: 'Log Off-boarding',
  };

  const activeClients = clients.filter(c => c.status === 'Active' || c.status === 'Due for Renewal');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName) return;

    const client = clients.find(c => c.name === clientName);
    onSave({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      clientName,
      csm: client?.csm ?? '',
      date,
      amount: amount ? parseFloat(amount) : undefined,
      reason: reason || undefined,
      notes: notes || undefined,
      createdAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">{titles[type]}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Client dropdown */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Client</label>
            <PillSelect
              value={clientName}
              options={(type === 'offboarding' ? activeClients : activeClients).map<PillSelectOption>(c => ({
                value: c.name,
                label: `${c.name} (${c.program} - ${c.csm})`,
                color: 'blue',
              }))}
              onChange={setClientName}
              placeholder="Select client..."
              allowClear
              clearLabel="None"
              maxLabelWidth={300}
              minMenuWidth={320}
            />
          </div>

          {/* Amount (upsell/renewal) */}
          {type !== 'offboarding' && (
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">
                {type === 'upsell' ? 'Upsell Amount' : 'Renewal Amount'} ($)
              </label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Reason (offboarding only) */}
          {type === 'offboarding' && (
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Reason</label>
              <PillSelect
                value={reason}
                options={[
                  { value: 'pricing', label: 'Pricing', color: 'amber' },
                  { value: 'results', label: 'Results', color: 'red' },
                  { value: 'capacity', label: 'Capacity', color: 'blue' },
                  { value: 'other', label: 'Other', color: 'gray' },
                ]}
                onChange={setReason}
                placeholder="Select reason..."
                allowClear
                clearLabel="None"
                maxLabelWidth={220}
              />
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!clientName}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={13} />
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client Detail Panel
// ---------------------------------------------------------------------------

function ClientDetailPanel({
  client,
  logs,
  onClose,
}: {
  client: MondayClient;
  logs: ActionLog[];
  onClose: () => void;
}) {
  const clientLogs = logs.filter(l => l.clientName === client.name);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-lg mx-4 shadow-2xl max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 sticky top-0 bg-[#1a1d23] z-10">
          <div>
            <h3 className="text-white font-semibold text-sm">{client.name}</h3>
            <p className="text-xs text-gray-500">{client.agencyName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Status</span>
              <div className="mt-1"><StatusBadge status={client.status} /></div>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Program</span>
              <p className="text-sm text-white mt-1">{client.program}</p>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">CSM</span>
              <p className="text-sm text-white mt-1">{client.csm}</p>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Board</span>
              <p className="text-sm text-white mt-1">{client.boardName}</p>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Start Date</span>
              <p className="text-sm text-white mt-1">{client.startDate || 'N/A'}</p>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Renewal Date</span>
              <p className="text-sm text-white mt-1">{client.renewalDate || 'N/A'}</p>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Email</span>
              <p className="text-sm text-blue-400 mt-1 truncate">{client.email || 'N/A'}</p>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 uppercase">Phone</span>
              <p className="text-sm text-white mt-1">{client.phone || 'N/A'}</p>
            </div>
          </div>

          {/* Action logs for this client */}
          {clientLogs.length > 0 && (
            <div>
              <h4 className="text-xs text-gray-400 font-medium mb-2 uppercase">Action History</h4>
              <div className="space-y-2">
                {clientLogs.map(log => (
                  <div key={log.id} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                        log.type === 'upsell'
                          ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                          : log.type === 'renewal'
                          ? 'bg-blue-400/10 text-blue-400 border-blue-400/20'
                          : 'bg-red-400/10 text-red-400 border-red-400/20'
                      }`}>
                        {log.type}
                      </span>
                      <span className="text-[10px] text-gray-500">{log.date}</span>
                    </div>
                    {log.amount && (
                      <p className="text-sm text-emerald-400 font-medium mt-1">
                        ${log.amount.toLocaleString()}
                      </p>
                    )}
                    {log.reason && (
                      <p className="text-xs text-gray-400 mt-1">Reason: {log.reason}</p>
                    )}
                    {log.notes && (
                      <p className="text-xs text-gray-500 mt-1">{log.notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface BackEndTabProps {
  mondayClients: MondayClient[];
}

export default function BackEndTab({ mondayClients }: BackEndTabProps) {
  // Action log state (localStorage)
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [logsHydrated, setLogsHydrated] = useState(false);

  useEffect(() => {
    const persisted = loadJSON<ActionLog[]>(STORAGE_KEYS.csmActionLogs, []);
    setActionLogs(persisted);
    setLogsHydrated(true);
  }, []);

  useEffect(() => {
    if (!logsHydrated) return;
    saveJSON(STORAGE_KEYS.csmActionLogs, actionLogs);
  }, [actionLogs, logsHydrated]);

  const handleSaveLog = (log: ActionLog) => {
    setActionLogs(prev => [log, ...prev]);
  };

  // Modal state
  const [actionModal, setActionModal] = useState<'upsell' | 'renewal' | 'offboarding' | null>(null);
  const [selectedClient, setSelectedClient] = useState<MondayClient | null>(null);

  // Search & sort for client table
  const [clientSearch, setClientSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [clientPage, setClientPage] = useState(0);
  const clientPerPage = 20;

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  // Expanded CSM
  const [expandedCSM, setExpandedCSM] = useState<string | null>(null);

  // Derived data
  const clients = mondayClients;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      Active: 0,
      'Due for Renewal': 0,
      Paused: 0,
      Cancelled: 0,
      'Off-boarded': 0,
    };
    for (const c of clients) {
      if (counts[c.status] !== undefined) counts[c.status]++;
      else counts[c.status] = (counts[c.status] || 0) + 1;
    }
    return counts;
  }, [clients]);

  const dueForRenewalClients = useMemo(
    () => clients.filter(c => c.status === 'Due for Renewal'),
    [clients]
  );

  const csmSummaries = useMemo(() => getMondayCSMSummaries(clients), [clients]);
  const avgDuration = useMemo(() => getAverageClientDuration(clients.filter(c => c.status === 'Active')), [clients]);

  // Action log counts per CSM
  const logCountsByCSM = useMemo(() => {
    const map: Record<string, { upsells: number; renewals: number; offboarded: number }> = {};
    for (const log of actionLogs) {
      if (!map[log.csm]) map[log.csm] = { upsells: 0, renewals: 0, offboarded: 0 };
      if (log.type === 'upsell') map[log.csm].upsells++;
      else if (log.type === 'renewal') map[log.csm].renewals++;
      else if (log.type === 'offboarding') map[log.csm].offboarded++;
    }
    return map;
  }, [actionLogs]);

  // Filtered + sorted client list
  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients;
    const q = clientSearch.toLowerCase();
    return clients.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.agencyName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.program.toLowerCase().includes(q) ||
        c.csm.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const sortedClients = useMemo(() => {
    return [...filteredClients].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] ?? '';
      const bv = (b as Record<string, unknown>)[sortKey] ?? '';
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
  }, [filteredClients, sortKey, sortDir]);

  const clientPageItems = sortedClients.slice(
    clientPage * clientPerPage,
    (clientPage + 1) * clientPerPage
  );
  const clientTotalPages = Math.ceil(sortedClients.length / clientPerPage);

  // CSM clients for expanded view
  const csmClients = useMemo(() => {
    if (!expandedCSM) return [];
    return clients.filter(c => c.csm === expandedCSM);
  }, [clients, expandedCSM]);

  // Loading / empty state
  if (clients.length === 0) {
    return (
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-12 text-center">
        <p className="text-gray-500 text-sm">
          Monday.com client data not connected yet. Add MONDAY_API_KEY to .env.local.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ===== SECTION 1: OVERVIEW CARDS ===== */}
      <section>
        <SectionTitle>Client Overview</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            label="Total Active Clients"
            value={statusCounts.Active}
            icon={Users}
            color="text-emerald-400"
          />
          <StatCard
            label="Due for Renewal"
            value={statusCounts['Due for Renewal']}
            icon={AlertTriangle}
            color={statusCounts['Due for Renewal'] > 0 ? 'text-amber-400' : 'text-white'}
            subValue={dueForRenewalClients.length > 0 ? dueForRenewalClients.slice(0, 3).map(c => c.name).join(', ') + (dueForRenewalClients.length > 3 ? ` +${dueForRenewalClients.length - 3}` : '') : undefined}
          />
          <StatCard
            label="Paused"
            value={statusCounts.Paused}
            icon={Pause}
            color="text-yellow-400"
          />
          <StatCard
            label="Cancelled / Off-boarded"
            value={statusCounts.Cancelled + statusCounts['Off-boarded']}
            icon={XCircle}
            color="text-red-400"
          />
          <StatCard
            label="AR %"
            value="--"
            icon={TrendingUp}
            color="text-gray-500"
            subValue="Coming soon"
          />
          <StatCard
            label="Avg Client Duration"
            value={avgDuration}
            icon={Clock}
            color="text-white"
          />
        </div>
      </section>

      {/* ===== SECTION 2: CSM PERFORMANCE ===== */}
      <section>
        <SectionTitle>CSM Performance</SectionTitle>
        <div className="space-y-3">
          {csmSummaries.map(csm => {
            const isExpanded = expandedCSM === csm.name;
            const logCounts = logCountsByCSM[csm.name] || { upsells: 0, renewals: 0, offboarded: 0 };

            return (
              <div key={csm.name} className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
                {/* CSM header */}
                <div
                  className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-800/40 transition-colors cursor-pointer"
                  onClick={() => setExpandedCSM(isExpanded ? null : csm.name)}
                >
                  <div className="flex items-center gap-4 flex-wrap min-w-0">
                    <div>
                      <span className="text-white font-semibold text-sm">{csm.name}</span>
                      <span className="text-[10px] text-gray-500 ml-2">{csm.offer}</span>
                    </div>
                    <span className="text-[11px] text-gray-400">
                      Active: <strong className="text-emerald-400">{csm.activeClients}</strong>
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Due: <strong className={csm.dueForRenewal.length > 0 ? 'text-amber-400' : 'text-white'}>{csm.dueForRenewal.length}</strong>
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Paused: <strong className="text-yellow-400">{csm.paused}</strong>
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Cancelled: <strong className="text-red-400">{csm.cancelled}</strong>
                    </span>
                    {/* Logged action counts */}
                    <span className="text-[11px] text-gray-400">
                      Upsells: <strong className="text-emerald-400">{logCounts.upsells}</strong>
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Renewals: <strong className="text-blue-400">{logCounts.renewals}</strong>
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Off-boarded: <strong className="text-red-400">{logCounts.offboarded}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {isExpanded ? (
                      <ChevronUp size={16} className="text-gray-400" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Expanded: action buttons + client list */}
                {isExpanded && (
                  <div className="border-t border-gray-700">
                    {/* Action buttons */}
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700/50">
                      <button
                        onClick={() => setActionModal('upsell')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-600/30 transition-colors border border-emerald-500/30"
                      >
                        <Plus size={13} />
                        Log Upsell
                      </button>
                      <button
                        onClick={() => setActionModal('renewal')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-600/30 transition-colors border border-blue-500/30"
                      >
                        <Plus size={13} />
                        Log Renewal
                      </button>
                      <button
                        onClick={() => setActionModal('offboarding')}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/20 text-red-400 rounded-lg text-xs font-medium hover:bg-red-600/30 transition-colors border border-red-500/30"
                      >
                        <Plus size={13} />
                        Log Off-boarding
                      </button>
                    </div>

                    {/* Due for renewal list */}
                    {csm.dueForRenewal.length > 0 && (
                      <div className="px-4 py-3 border-b border-gray-700/50">
                        <p className="text-[10px] text-amber-400 uppercase font-semibold mb-2">
                          Due for Renewal ({csm.dueForRenewal.length})
                        </p>
                        <div className="space-y-1">
                          {csm.dueForRenewal.map(c => (
                            <div key={c.id} className="flex items-center justify-between text-xs">
                              <span className="text-white">{c.name}</span>
                              <span className="text-gray-500">{c.renewalDate || 'No date'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* CSM's client table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-gray-300">
                        <thead>
                          <tr className="text-[10px] text-gray-500 uppercase border-b border-gray-700/50">
                            <th className="text-left py-2 px-3">Client</th>
                            <th className="text-left py-2 px-3">Agency</th>
                            <th className="text-left py-2 px-3">Status</th>
                            <th className="text-left py-2 px-3">Start Date</th>
                            <th className="text-left py-2 px-3">Renewal Date</th>
                            <th className="text-left py-2 px-3">Email</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csmClients.map(c => (
                            <tr
                              key={c.id}
                              className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer"
                              onClick={() => setSelectedClient(c)}
                            >
                              <td className="py-2 px-3 text-white font-medium text-xs">{c.name}</td>
                              <td className="py-2 px-3 text-xs text-gray-300">{c.agencyName || '-'}</td>
                              <td className="py-2 px-3"><StatusBadge status={c.status} /></td>
                              <td className="py-2 px-3 text-xs text-gray-400">{c.startDate || '-'}</td>
                              <td className="py-2 px-3 text-xs text-gray-400">{c.renewalDate || '-'}</td>
                              <td className="py-2 px-3 text-xs text-blue-400 truncate max-w-[160px]">{c.email || '-'}</td>
                            </tr>
                          ))}
                          {csmClients.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-6 text-center text-gray-500 text-xs">No clients</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== SECTION 3: FULL CLIENT LIST ===== */}
      <section>
        <SectionTitle>Client List</SectionTitle>
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
          {/* Search bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <span className="text-xs text-gray-400">
              Showing <strong className="text-white">{sortedClients.length}</strong> clients
            </span>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search name, agency, program, CSM..."
                value={clientSearch}
                onChange={e => {
                  setClientSearch(e.target.value);
                  setClientPage(0);
                }}
                className="bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-72"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-gray-300">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase border-b border-gray-700/50">
                  <SortHeader label="Name" field="name" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Agency" field="agencyName" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Program" field="program" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="CSM" field="csm" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Status" field="status" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Renewal Date" field="renewalDate" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Start Date" field="startDate" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                  <th className="text-left py-3 px-3 whitespace-nowrap">Email</th>
                </tr>
              </thead>
              <tbody>
                {clientPageItems.map(c => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedClient(c)}
                  >
                    <td className="py-2 px-3 text-white font-medium text-xs whitespace-nowrap">{c.name}</td>
                    <td className="py-2 px-3 text-xs text-gray-300">{c.agencyName || '-'}</td>
                    <td className="py-2 px-3 text-xs text-gray-300">{c.program}</td>
                    <td className="py-2 px-3 text-xs text-gray-300 whitespace-nowrap">{c.csm}</td>
                    <td className="py-2 px-3"><StatusBadge status={c.status} /></td>
                    <td className="py-2 px-3 text-xs text-gray-400">{c.renewalDate || '-'}</td>
                    <td className="py-2 px-3 text-xs text-gray-400">{c.startDate || '-'}</td>
                    <td className="py-2 px-3 text-xs text-blue-400 truncate max-w-[160px]">{c.email || '-'}</td>
                  </tr>
                ))}
                {clientPageItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-gray-500 text-xs">No clients match your search</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
            <span>{clientPerPage} items per page</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setClientPage(Math.max(0, clientPage - 1))}
                disabled={clientPage === 0}
                className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30"
              >
                Prev
              </button>
              {Array.from({ length: Math.min(clientTotalPages, 5) }, (_, i) => {
                const p = clientPage < 3 ? i : clientPage - 2 + i;
                if (p >= clientTotalPages) return null;
                return (
                  <button
                    key={p}
                    onClick={() => setClientPage(p)}
                    className={`px-2 py-1 rounded ${
                      p === clientPage ? 'bg-blue-600 text-white' : 'bg-gray-800 hover:bg-gray-700'
                    }`}
                  >
                    {p + 1}
                  </button>
                );
              })}
              {clientTotalPages > 5 && <span>... {clientTotalPages}</span>}
              <button
                onClick={() => setClientPage(Math.min(clientTotalPages - 1, clientPage + 1))}
                disabled={clientPage >= clientTotalPages - 1}
                className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 4: RECENT ACTION LOGS ===== */}
      {actionLogs.length > 0 && (
        <section>
          <SectionTitle>Recent CSM Actions</SectionTitle>
          <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-gray-300">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase border-b border-gray-700/50">
                    <th className="text-left py-2 px-3">Type</th>
                    <th className="text-left py-2 px-3">Client</th>
                    <th className="text-left py-2 px-3">CSM</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-right py-2 px-3">Amount</th>
                    <th className="text-left py-2 px-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {actionLogs.slice(0, 20).map(log => (
                    <tr key={log.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="py-2 px-3">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                          log.type === 'upsell'
                            ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20'
                            : log.type === 'renewal'
                            ? 'bg-blue-400/10 text-blue-400 border-blue-400/20'
                            : 'bg-red-400/10 text-red-400 border-red-400/20'
                        }`}>
                          {log.type}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-white font-medium">{log.clientName}</td>
                      <td className="py-2 px-3 text-xs text-gray-300">{log.csm}</td>
                      <td className="py-2 px-3 text-xs text-gray-400">{log.date}</td>
                      <td className="py-2 px-3 text-xs text-right text-emerald-400">
                        {log.amount ? `$${log.amount.toLocaleString()}` : '-'}
                      </td>
                      <td className="py-2 px-3 text-xs text-gray-500 truncate max-w-[200px]">
                        {log.reason ? `[${log.reason}] ` : ''}{log.notes || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ===== MODALS ===== */}
      {actionModal && (
        <ActionLogModal
          type={actionModal}
          clients={clients}
          onSave={handleSaveLog}
          onClose={() => setActionModal(null)}
        />
      )}

      {selectedClient && (
        <ClientDetailPanel
          client={selectedClient}
          logs={actionLogs}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}
