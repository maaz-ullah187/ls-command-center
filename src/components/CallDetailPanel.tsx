'use client';

import { useState, useEffect } from 'react';
import {
  X, Pencil, CalendarX, Ban, ClipboardEdit, ExternalLink,
  Mail, Phone, User, Clock, Calendar as CalendarIcon,
  Link as LinkIcon, ChevronRight, RotateCcw, FileText
} from 'lucide-react';
import { Lead } from '@/lib/types';
import CallOutcomeForm from './CallOutcomeForm';

interface CallDetailPanelProps {
  lead: Lead | null;
  onClose: () => void;
  onUpdateLead: (leadId: string, updates: Partial<Lead>) => void;
  onOpenJourney: (lead: Lead) => void;
}

interface ToastState {
  message: string;
  undoFn: () => void;
}

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDateTime(dateStr: string | null | undefined): { date: string; time: string } {
  if (!dateStr) return { date: '—', time: '' };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { date: dateStr, time: '' };
  return {
    date: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

export default function CallDetailPanel({ lead, onClose, onUpdateLead, onOpenJourney }: CallDetailPanelProps) {
  const [outcomeFormOpen, setOutcomeFormOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);

  // Auto-dismiss toast after 5s
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Close panel on ESC
  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !outcomeFormOpen) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lead, outcomeFormOpen, onClose]);

  if (!lead) return null;

  const { date: meetDate, time: meetTime } = formatDateTime(lead.demoDate);

  const initials = lead.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // ---------- Quick action handlers ----------
  const snapshotBefore = () => ({
    showStatus: lead.showStatus,
    callOutcome: lead.callOutcome,
    demoDate: lead.demoDate,
    outcomeLoggedAt: lead.outcomeLoggedAt,
  });

  const handleMarkNoShow = () => {
    const before = snapshotBefore();
    onUpdateLead(lead.id, {
      showStatus: 'No Show',
      callOutcome: null,
      outcomeLoggedAt: new Date().toISOString(),
    });
    setToast({
      message: `${lead.name} marked as No Show`,
      undoFn: () => onUpdateLead(lead.id, before),
    });
  };

  const handleCancel = () => {
    const before = snapshotBefore();
    onUpdateLead(lead.id, {
      showStatus: 'Cancelled',
      callOutcome: null,
      outcomeLoggedAt: new Date().toISOString(),
    });
    setToast({
      message: `${lead.name}'s call cancelled`,
      undoFn: () => onUpdateLead(lead.id, before),
    });
  };

  const handleReschedule = () => {
    if (!rescheduleDate) return;
    const before = snapshotBefore();
    onUpdateLead(lead.id, {
      demoDate: rescheduleDate,
      showStatus: 'Rescheduled',
      outcomeLoggedAt: new Date().toISOString(),
    });
    setToast({
      message: `${lead.name} rescheduled to ${new Date(rescheduleDate).toLocaleDateString()}`,
      undoFn: () => onUpdateLead(lead.id, before),
    });
    setRescheduleOpen(false);
    setRescheduleDate('');
  };

  const handleJoinMeeting = () => {
    if (lead.meetingUrl) {
      window.open(lead.meetingUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // ---------- Pill color helpers ----------
  const showStatusPill = () => {
    if (!lead.showStatus) return null;
    const s = lead.showStatus;
    const cls =
      s === 'Showed' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
      s === 'No Show' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
      s === 'Cancelled' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
      'bg-blue-500/20 text-blue-400 border-blue-500/40';
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{s}</span>;
  };

  const callOutcomePill = () => {
    if (!lead.callOutcome) {
      return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-gray-500/20 text-gray-400 border-gray-500/40">Call Booked</span>;
    }
    const o = lead.callOutcome;
    const cls =
      o === 'Closed Won' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
      o === 'Closed Lost' ? 'bg-red-500/20 text-red-400 border-red-500/40' :
      'bg-blue-500/20 text-blue-400 border-blue-500/40';
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{o}</span>;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => !outcomeFormOpen && onClose()}
      />

      {/* Side panel */}
      <aside className="fixed right-0 top-0 bottom-0 w-[440px] max-w-[92vw] bg-[#1a1d23] border-l border-gray-700 shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-base truncate">{lead.name}</h3>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {showStatusPill()}
                {callOutcomePill()}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scroll area */}
        <div className="flex-1 overflow-y-auto">
          {/* Quick actions */}
          <div className="px-5 py-4 border-b border-gray-700">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOutcomeFormOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-xs font-medium text-gray-200 transition-colors"
              >
                <Pencil size={12} />
                Edit
              </button>
              <button
                onClick={() => setRescheduleOpen(!rescheduleOpen)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-xs font-medium text-gray-200 transition-colors"
              >
                <CalendarIcon size={12} />
                Reschedule
              </button>
              <button
                onClick={handleMarkNoShow}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600/15 hover:bg-red-600/25 border border-red-500/40 rounded-lg text-xs font-medium text-red-300 transition-colors"
              >
                <CalendarX size={12} />
                Mark No-Show
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600/15 hover:bg-amber-600/25 border border-amber-500/40 rounded-lg text-xs font-medium text-amber-300 transition-colors"
              >
                <Ban size={12} />
                Cancel
              </button>
              <button
                onClick={() => setOutcomeFormOpen(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition-colors"
              >
                <ClipboardEdit size={12} />
                Log Outcome
              </button>
              <button
                onClick={handleJoinMeeting}
                disabled={!lead.meetingUrl}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/40 rounded-lg text-xs font-medium text-purple-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ExternalLink size={12} />
                Join Meeting
              </button>
            </div>

            {/* Inline reschedule picker */}
            {rescheduleOpen && (
              <div className="mt-3 p-3 bg-gray-800/60 border border-gray-600 rounded-lg flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-gray-400 font-semibold uppercase mb-1">New Date</label>
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={e => setRescheduleDate(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={handleReschedule}
                  disabled={!rescheduleDate}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Apply
                </button>
                <button
                  onClick={() => { setRescheduleOpen(false); setRescheduleDate(''); }}
                  className="px-2 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Lead Information */}
          <Section title="Lead Information">
            <InfoRow icon={<Mail size={13} />} label={<a href={`mailto:${lead.email}`} className="text-blue-400 hover:underline truncate">{lead.email}</a>} />
            <InfoRow icon={<Phone size={13} />} label={<a href={`tel:${lead.phone}`} className="text-gray-300 hover:text-white">{lead.phone}</a>} />
            <button
              onClick={() => onOpenJourney(lead)}
              className="flex items-center gap-2 text-xs text-purple-400 hover:text-purple-300 font-medium mt-2 group"
            >
              <User size={13} />
              Go to Lead Profile
              <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </Section>

          {/* Meeting Information */}
          <Section title="Meeting Information">
            <InfoRow icon={<CalendarIcon size={13} />} label={<span className="text-gray-200">{meetDate}</span>} />
            {meetTime && <InfoRow icon={<Clock size={13} />} label={<span className="text-gray-200">{meetTime}</span>} />}
            <InfoRow icon={<User size={13} />} label={<span className="text-gray-300"><span className="text-gray-500">Host:</span> {lead.assignedCloser || 'Unassigned'}</span>} />
            <InfoRow icon={<User size={13} />} label={<span className="text-gray-300"><span className="text-gray-500">Setter:</span> {lead.assignedSetter || 'Unassigned'}</span>} />
            {lead.meetingUrl && (
              <InfoRow
                icon={<LinkIcon size={13} />}
                label={
                  <a
                    href={lead.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline text-[11px] truncate block max-w-[280px]"
                    title={lead.meetingUrl}
                  >
                    {lead.meetingUrl.replace('https://', '')}
                  </a>
                }
              />
            )}
            {lead.callType && (
              <InfoRow icon={<FileText size={13} />} label={<span className="text-gray-300"><span className="text-gray-500">Type:</span> {lead.callType}</span>} />
            )}
          </Section>

          {/* Call Outcome */}
          <Section title="Call Outcome">
            {lead.callOutcome || lead.showStatus ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {lead.callOutcome && callOutcomePill()}
                  {!lead.callOutcome && lead.showStatus && showStatusPill()}
                </div>
                {lead.outcomeLoggedAt && (
                  <p className="text-[11px] text-gray-500">
                    Logged {formatTimeAgo(lead.outcomeLoggedAt)}
                  </p>
                )}
                {lead.callOutcome === 'Closed Won' && lead.cashCollected > 0 && (
                  <p className="text-xs text-emerald-400 font-semibold">
                    ${lead.cashCollected.toLocaleString()} cash collected · ${lead.contractedRevenue.toLocaleString()} contracted
                  </p>
                )}
                {lead.callOutcome === 'Follow Up Booked' && lead.followUpType && (
                  <p className="text-xs text-blue-300">
                    {lead.followUpType}
                    {lead.followUpDate && <> · {new Date(lead.followUpDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-gray-500 italic">No outcome logged yet. Use Log Outcome above.</p>
            )}
          </Section>
        </div>
      </aside>

      {/* Undo Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-gray-900 border border-gray-600 rounded-full shadow-2xl px-4 py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
          <span className="text-xs text-gray-200 font-medium">{toast.message}</span>
          <button
            onClick={() => { toast.undoFn(); setToast(null); }}
            className="flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            <RotateCcw size={11} />
            Undo
          </button>
        </div>
      )}

      {/* CallOutcomeForm modal layered over panel */}
      {outcomeFormOpen && (
        <CallOutcomeForm
          lead={lead}
          onSave={(id, updates) => {
            onUpdateLead(id, updates);
            setToast({
              message: `Outcome logged for ${lead.name}`,
              undoFn: () => onUpdateLead(lead.id, {
                showStatus: lead.showStatus,
                callOutcome: lead.callOutcome,
                qualityScore: lead.qualityScore,
                cashCollected: lead.cashCollected,
                contractedRevenue: lead.contractedRevenue,
                stage: lead.stage,
                followUpType: lead.followUpType,
                followUpDate: lead.followUpDate,
                outcomeLoggedAt: lead.outcomeLoggedAt,
              }),
            });
          }}
          onClose={() => setOutcomeFormOpen(false)}
        />
      )}
    </>
  );
}

/* ---------- Section wrapper ---------- */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-gray-700">
      <h4 className="text-[10px] font-bold tracking-wider text-gray-500 uppercase mb-3">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/* ---------- InfoRow ---------- */
function InfoRow({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{label}</div>
    </div>
  );
}
