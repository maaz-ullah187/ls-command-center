'use client';

import { Lead } from '@/lib/types';
import {
  X,
  User,
  Mail,
  Phone,
  Calendar,
  Target,
  DollarSign,
  ExternalLink,
  Link as LinkIcon,
  CheckCircle2,
  XCircle,
  Clock,
  Circle,
  TrendingUp,
  Brain,
  AlertTriangle,
  ThumbsUp,
  Mic,
  FileText,
  ClipboardList,
} from 'lucide-react';
import ChannelIcon from './ChannelIcon';
import EditableValue from './EditableValue';

interface LeadJourneyModalProps {
  lead: Lead | null;
  onClose: () => void;
}

interface TimelineEvent {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  date: string;
  color: 'blue' | 'amber' | 'emerald' | 'red' | 'gray' | 'purple';
  status: 'done' | 'current' | 'upcoming' | 'skipped';
}

function buildTimeline(lead: Lead): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 1. Opted in
  events.push({
    icon: <Target size={14} />,
    title: 'Lead Opted In',
    detail: `${lead.source} · ${lead.campaignName || 'Untagged'}`,
    date: lead.date,
    color: 'blue',
    status: 'done',
  });

  // 2. Demo booked
  if (lead.demoBooked && lead.demoDate) {
    events.push({
      icon: <Calendar size={14} />,
      title: 'Demo Booked',
      detail: lead.assignedCloser ? `Assigned to ${lead.assignedCloser}` : 'Unassigned',
      date: lead.demoDate,
      color: 'purple',
      status: 'done',
    });
  } else if (!lead.demoBooked) {
    events.push({
      icon: <Clock size={14} />,
      title: 'Waiting for Demo Book',
      detail: 'Lead has not booked a call yet',
      date: '—',
      color: 'gray',
      status: 'upcoming',
    });
  }

  // 3. Call happened / show status
  if (lead.showStatus) {
    if (lead.showStatus === 'Showed') {
      events.push({
        icon: <CheckCircle2 size={14} />,
        title: 'Call Showed',
        detail: lead.assignedCloser ? `${lead.assignedCloser} took the call` : undefined,
        date: lead.demoDate || lead.date,
        color: 'emerald',
        status: 'done',
      });
    } else if (lead.showStatus === 'No Show') {
      events.push({
        icon: <XCircle size={14} />,
        title: 'No Show',
        detail: 'Lead did not attend the scheduled call',
        date: lead.demoDate || lead.date,
        color: 'red',
        status: 'done',
      });
    } else if (lead.showStatus === 'Cancelled') {
      events.push({
        icon: <XCircle size={14} />,
        title: 'Call Cancelled',
        date: lead.demoDate || lead.date,
        color: 'amber',
        status: 'skipped',
      });
    } else if (lead.showStatus === 'Rescheduled') {
      events.push({
        icon: <Clock size={14} />,
        title: 'Rescheduled',
        date: lead.demoDate || lead.date,
        color: 'amber',
        status: 'done',
      });
    }
  } else if (lead.demoBooked) {
    events.push({
      icon: <Clock size={14} />,
      title: 'Waiting for Call Outcome',
      detail: 'Closer has not logged this call yet',
      date: '—',
      color: 'amber',
      status: 'current',
    });
  }

  // 4. Call outcome
  if (lead.callOutcome) {
    if (lead.callOutcome === 'Closed Won') {
      events.push({
        icon: <DollarSign size={14} />,
        title: 'Closed Won',
        detail: `$${lead.cashCollected.toLocaleString()} cash · $${lead.contractedRevenue.toLocaleString()} contracted`,
        date: lead.demoDate || lead.date,
        color: 'emerald',
        status: 'done',
      });
    } else if (lead.callOutcome === 'Follow Up Booked') {
      events.push({
        icon: <Calendar size={14} />,
        title: 'Follow-up Booked',
        date: lead.demoDate || lead.date,
        color: 'blue',
        status: 'current',
      });
    } else if (lead.callOutcome === 'Closed Lost') {
      events.push({
        icon: <XCircle size={14} />,
        title: 'Closed Lost',
        date: lead.demoDate || lead.date,
        color: 'red',
        status: 'done',
      });
    } else {
      events.push({
        icon: <Circle size={14} />,
        title: lead.callOutcome,
        date: lead.demoDate || lead.date,
        color: 'gray',
        status: 'done',
      });
    }
  }

  return events;
}

function formatDate(dateStr: string): string {
  if (dateStr === '—') return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const COLOR_MAP = {
  blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/40', ring: 'ring-blue-500/30' },
  amber: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/40', ring: 'ring-amber-500/30' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/40', ring: 'ring-emerald-500/30' },
  red: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40', ring: 'ring-red-500/30' },
  gray: { bg: 'bg-gray-700/40', text: 'text-gray-500', border: 'border-gray-700', ring: 'ring-gray-700' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/40', ring: 'ring-purple-500/30' },
};

export default function LeadJourneyModal({ lead, onClose }: LeadJourneyModalProps) {
  if (!lead) return null;

  const timeline = buildTimeline(lead);
  const ghlUrl = `https://app.gohighlevel.com/contacts/detail/${lead.ghlContactId}`;
  const grainUrl = lead.grainRecordingId
    ? `https://grain.com/recordings/${lead.grainRecordingId}`
    : null;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#1a1d23] border-b border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-white font-bold text-lg">{lead.name}</h3>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  lead.stage === 'Closed Won'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : lead.stage === 'Closed Lost'
                    ? 'bg-red-500/20 text-red-400'
                    : lead.stage === 'Qualified'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-gray-700 text-gray-400'
                }`}
              >
                {lead.stage}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Mail size={11} /> {lead.email}
              </span>
              <span className="flex items-center gap-1">
                <Phone size={11} /> {lead.phone}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Top quick stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <QuickStat
              label="Source"
              value={
                <span className="flex items-center gap-1.5 text-white">
                  <ChannelIcon channel={lead.source} size={12} />
                  {lead.source}
                </span>
              }
            />
            <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Program</p>
              <EditableValue tableName="leads" rowId={lead.ghlContactId || lead.id} field="program" value={lead.program} format="text" />
            </div>
            <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Cash Collected</p>
              <EditableValue tableName="leads" rowId={lead.ghlContactId || lead.id} field="cash_collected" value={lead.cashCollected} format="currency" />
            </div>
            <QuickStat
              label="Quality Score"
              value={
                lead.qualityScore ? (
                  <span className="flex items-center gap-1">
                    <span className="text-white">{lead.qualityScore}/10</span>
                    <div className="w-12 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500"
                        style={{ width: `${lead.qualityScore * 10}%` }}
                      />
                    </div>
                  </span>
                ) : (
                  '—'
                )
              }
            />
          </div>

          {/* Attribution Section */}
          <Section title="Attribution">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="flex items-start justify-between gap-2 py-1 border-b border-gray-800/50">
                <span className="text-gray-500">Source</span>
                <EditableValue
                  value={lead.source}
                  tableName="leads"
                  rowId={lead.ghlContactId || lead.id}
                  field="source"
                  originalValue={lead.source}
                  format="text"
                  className="text-gray-200 text-right"
                />
              </div>
              <AttrRow label="Campaign" value={lead.campaignName || '—'} />
              <AttrRow label="Ad Account" value={lead.adAccountName || '—'} />
              <AttrRow label="Ad Set" value={lead.adSetName || '—'} />
              <AttrRow label="Ad Name" value={lead.adName || '—'} />
              <AttrRow label="First Touch" value={formatDate(lead.date)} />
            </div>
          </Section>

          {/* AI Lead Score */}
          {lead.qualityScore > 0 && (
            <Section title="AI Lead Score">
              <div className="space-y-3">
                {/* Score badge */}
                <div className="flex items-center gap-3">
                  <div
                    className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center font-bold ${
                      lead.qualityScore >= 8
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : lead.qualityScore >= 6
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                        : lead.qualityScore >= 4
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        : 'bg-red-500/20 text-red-400 border border-red-500/40'
                    }`}
                  >
                    <span className="text-lg leading-none">{lead.qualityScore}</span>
                    <span className="text-[8px] opacity-60">/10</span>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          lead.qualityScore >= 6
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {lead.qualityScore >= 6 ? 'Qualified' : 'Unqualified'}
                      </span>
                    </div>
                    {lead.qualityScoreSummary && (
                      <p className="text-xs text-gray-400 leading-relaxed">
                        {lead.qualityScoreSummary}
                      </p>
                    )}
                  </div>
                </div>

                {/* Green + Red flags */}
                <div className="grid grid-cols-2 gap-3">
                  {lead.qualityGreenFlags && lead.qualityGreenFlags.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-emerald-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                        <ThumbsUp size={10} /> Green Flags
                      </p>
                      {lead.qualityGreenFlags.map((flag, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                          <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
                          <span>{flag}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {lead.qualityRedFlags && lead.qualityRedFlags.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] text-red-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                        <AlertTriangle size={10} /> Red Flags
                      </p>
                      {lead.qualityRedFlags.map((flag, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                          <span className="text-red-500 mt-0.5 shrink-0">✗</span>
                          <span>{flag}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}

          {/* Call Intelligence (Grain) */}
          {lead.grainCallSummary && (
            <Section title="Call Intelligence">
              <div className="space-y-3">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  {lead.grainCallType && (
                    <span className="flex items-center gap-1">
                      <Mic size={11} /> {lead.grainCallType} call
                    </span>
                  )}
                  {lead.grainDurationMin != null && (
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {lead.grainDurationMin} min
                    </span>
                  )}
                  {lead.grainOwnerEmail && (
                    <span className="flex items-center gap-1">
                      <User size={11} /> {lead.grainOwnerEmail}
                    </span>
                  )}
                </div>
                <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Brain size={10} /> AI Summary
                  </p>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {lead.grainCallSummary}
                  </p>
                </div>
                {lead.grainTranscriptUrl && (
                  <a
                    href={lead.grainTranscriptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <FileText size={11} /> View Full Transcript <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </Section>
          )}

          {/* Qualification Answers */}
          {lead.qualification && Object.values(lead.qualification).some(v => v) && (
            <Section title="Application Answers">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {lead.qualification.businessType && (
                  <AttrRow label="Business Type" value={lead.qualification.businessType} />
                )}
                {lead.qualification.monthlyRevenue && (
                  <AttrRow label="Monthly Revenue" value={lead.qualification.monthlyRevenue} />
                )}
                {lead.qualification.coreBusiness && (
                  <AttrRow label="Core Business" value={lead.qualification.coreBusiness} />
                )}
                {lead.qualification.biggestStruggle && (
                  <AttrRow label="Biggest Struggle" value={lead.qualification.biggestStruggle} />
                )}
                {lead.qualification.currentIncome && (
                  <AttrRow label="Current Income" value={lead.qualification.currentIncome} />
                )}
                {lead.qualification.investmentCapacity && (
                  <AttrRow label="Investment Capacity" value={lead.qualification.investmentCapacity} />
                )}
                {lead.qualification.teamSize && (
                  <AttrRow label="Team Size" value={lead.qualification.teamSize} />
                )}
                {lead.qualification.monthlyPayroll && (
                  <AttrRow label="Monthly Payroll" value={lead.qualification.monthlyPayroll} />
                )}
                {lead.qualification.triedAiBefore && (
                  <AttrRow label="Tried AI Before" value={lead.qualification.triedAiBefore} />
                )}
                {lead.qualification.speedToImplement && (
                  <AttrRow label="Speed to Implement" value={lead.qualification.speedToImplement} />
                )}
              </div>
            </Section>
          )}

          {/* Attribution Journey Timeline */}
          <Section title="Attribution Journey">
            <div className="relative">
              {timeline.map((event, idx) => {
                const colors = COLOR_MAP[event.color];
                const isLast = idx === timeline.length - 1;
                return (
                  <div key={idx} className="relative flex gap-4 pb-5">
                    {/* Vertical line */}
                    {!isLast && (
                      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-700" />
                    )}
                    {/* Icon bubble */}
                    <div
                      className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${colors.bg} ${colors.text} border ${colors.border} shrink-0 ${
                        event.status === 'current' ? `ring-2 ${colors.ring} animate-pulse` : ''
                      }`}
                    >
                      {event.icon}
                    </div>
                    {/* Content */}
                    <div className="flex-1 pt-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-white font-semibold text-sm">{event.title}</p>
                          {event.detail && (
                            <p className="text-xs text-gray-500 mt-0.5">{event.detail}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-600 whitespace-nowrap uppercase tracking-wider">
                          {formatDate(event.date)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Instagram / ManyChat Context */}
          {lead.source === 'Instagram' && (
            <Section title="Instagram / ManyChat">
              <div className="bg-gradient-to-r from-pink-900/20 to-purple-900/20 border border-pink-500/20 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                  <AttrRow label="Channel" value="Instagram DM" />
                  <AttrRow label="Setter" value="James" />
                </div>
                <p className="text-[10px] text-gray-500">
                  View full DM conversation and ManyChat data in the Instagram → DM Funnel tab.
                </p>
              </div>
            </Section>
          )}

          {/* Assignments */}
          <Section title="Assignments">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-black/20 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Closer</p>
                <EditableValue tableName="leads" rowId={lead.ghlContactId || lead.id} field="assigned_closer" value={lead.assignedCloser || 'Unassigned'} format="text" />
              </div>
              <div className="bg-black/20 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Stage</p>
                <EditableValue tableName="leads" rowId={lead.ghlContactId || lead.id} field="stage" value={lead.stage} format="text" />
              </div>
              <div className="bg-black/20 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Setter</p>
                <p className="text-white text-sm font-medium">
                  <span className="text-gray-600">Unassigned</span>
                </p>
              </div>
            </div>
          </Section>

          {/* External Links */}
          <Section title="External Links">
            <div className="flex flex-wrap gap-2">
              <a
                href={ghlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-400 text-xs font-medium rounded-lg px-3 py-2 transition-colors"
              >
                <LinkIcon size={12} />
                Open in GHL
                <ExternalLink size={10} />
              </a>
              {grainUrl && (
                <a
                  href={grainUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-400 text-xs font-medium rounded-lg px-3 py-2 transition-colors"
                >
                  <TrendingUp size={12} />
                  Call Recording (Grain)
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold mb-3">
        {title}
      </h4>
      {children}
    </div>
  );
}

function QuickStat({
  label,
  value,
  color,
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-black/20 rounded-lg p-3 border border-gray-800">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className={`text-sm font-semibold ${color || 'text-white'}`}>{value}</div>
    </div>
  );
}

function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-gray-800/50">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-200 text-right truncate max-w-[60%]" title={value}>
        {value}
      </span>
    </div>
  );
}
