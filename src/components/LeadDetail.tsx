'use client';

import { Lead } from '@/lib/types';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import EditableValue from './EditableValue';

interface LeadDetailProps {
  leads: Lead[];
  title: string;
  onOpenLead?: (lead: Lead) => void;
  onSaved?: () => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function QualityBadge({ score }: { score: number }) {
  if (!score || score <= 0) return <span className="text-gray-600">—</span>;
  const cls =
    score >= 8 ? 'bg-emerald-900/50 text-emerald-300' :
    score >= 6 ? 'bg-blue-900/50 text-blue-300' :
    score >= 4 ? 'bg-amber-900/50 text-amber-300' :
    'bg-red-900/50 text-red-300';
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${cls}`}>{score.toFixed(1)}</span>;
}

export default function LeadDetail({ leads, title, onOpenLead, onSaved }: LeadDetailProps) {
  const totalValue = leads.reduce((s, l) => s + l.cashCollected, 0);
  const closedLeads = leads.filter(l => l.callOutcome === 'Closed Won');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removalReason, setRemovalReason] = useState('');

  const handleRemovalSubmit = (leadId: string) => {
    console.log('[LeadDetail] Removal flagged:', { leadId, reason: removalReason });
    setRemovingId(null);
    setRemovalReason('');
  };

  return (
    <div>
      <div className="mb-4">
        <p className="text-xs text-gray-500">
          Total: {leads.length} leads | {closedLeads.length} closed | ${totalValue.toLocaleString()} revenue
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-gray-300">
          <thead>
            <tr className="border-b border-gray-700 text-[11px] text-gray-500 uppercase">
              <th className="text-left py-2 px-3">Date</th>
              <th className="text-left py-2 px-3">Contact</th>
              <th className="text-left py-2 px-3">Quality</th>
              <th className="text-left py-2 px-3">Email</th>
              <th className="text-left py-2 px-3">Source</th>
              <th className="text-left py-2 px-3">Program</th>
              <th className="text-left py-2 px-3">Stage</th>
              <th className="text-left py-2 px-3">Show</th>
              <th className="text-left py-2 px-3">Outcome</th>
              <th className="text-left py-2 px-3">Closer</th>
              <th className="text-right py-2 px-3">Cash</th>
              <th className="text-right py-2 px-3">Revenue</th>
              <th className="text-center py-2 px-3">Rec.</th>
              <th className="text-center py-2 px-3">GHL</th>
              <th className="text-center py-2 px-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {leads.map(lead => (
              <tr key={lead.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                <td className="py-2 px-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(lead.date)}</td>
                <td className="py-2 px-3 font-medium text-white whitespace-nowrap">
                  {onOpenLead ? (
                    <button
                      onClick={() => onOpenLead(lead)}
                      className="text-white font-medium hover:text-blue-400 transition-colors underline decoration-dotted underline-offset-2"
                    >
                      {lead.name}
                    </button>
                  ) : lead.ghlContactUrl ? (
                    <a
                      href={lead.ghlContactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-300 hover:underline"
                    >
                      {lead.name}
                    </a>
                  ) : lead.name}
                </td>
                <td className="py-2 px-3"><QualityBadge score={lead.qualityScore} /></td>
                <td className="py-2 px-3 text-blue-400 text-xs">{lead.email}</td>
                <td className="py-2 px-3">
                  <EditableValue
                    value={lead.source}
                    tableName="leads"
                    rowId={lead.ghlContactId || lead.id}
                    field="source"
                    format="text"
                    onSaved={onSaved}
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      lead.source === 'Facebook Ads' ? 'bg-blue-900/50 text-blue-300' :
                      lead.source === 'YouTube' ? 'bg-red-900/50 text-red-300' :
                      lead.source === 'Instagram' ? 'bg-pink-900/50 text-pink-300' :
                      lead.source === 'LinkedIn' ? 'bg-sky-900/50 text-sky-300' :
                      'bg-gray-700 text-gray-300'
                    }`}
                  />
                </td>
                <td className="py-2 px-3 text-xs text-gray-400">
                  <EditableValue
                    value={lead.program || ''}
                    tableName="leads"
                    rowId={lead.ghlContactId || lead.id}
                    field="program"
                    format="text"
                    onSaved={onSaved}
                  />
                </td>
                <td className="py-2 px-3">
                  <EditableValue
                    value={lead.stage}
                    tableName="leads"
                    rowId={lead.ghlContactId || lead.id}
                    field="stage"
                    format="text"
                    onSaved={onSaved}
                    className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                      lead.stage === 'Closed Won' ? 'bg-emerald-900/50 text-emerald-300' :
                      lead.stage === 'Closed Lost' ? 'bg-red-900/50 text-red-300' :
                      lead.stage === 'Qualified' ? 'bg-amber-900/50 text-amber-300' :
                      'bg-gray-700 text-gray-400'
                    }`}
                  />
                </td>
                <td className="py-2 px-3 text-xs">
                  {lead.showStatus ? (
                    <span className={lead.showStatus === 'Showed' ? 'text-emerald-400' : 'text-red-400'}>{lead.showStatus}</span>
                  ) : <span className="text-gray-600">—</span>}
                </td>
                <td className="py-2 px-3 text-xs text-gray-400">{lead.callOutcome || '—'}</td>
                <td className="py-2 px-3 text-xs text-gray-400">
                  <EditableValue
                    value={lead.assignedCloser || ''}
                    tableName="leads"
                    rowId={lead.ghlContactId || lead.id}
                    field="assigned_closer"
                    format="text"
                    onSaved={onSaved}
                  />
                </td>
                <td className="text-right py-2 px-3 text-xs font-medium">
                  <EditableValue
                    value={lead.cashCollected}
                    tableName="leads"
                    rowId={lead.ghlContactId || lead.id}
                    field="cash_collected"
                    format="currency"
                    onSaved={onSaved}
                    className={lead.cashCollected > 0 ? 'text-emerald-400' : 'text-gray-600'}
                  />
                </td>
                <td className="text-right py-2 px-3 font-medium">
                  <EditableValue
                    value={lead.contractedRevenue > 0 ? lead.contractedRevenue : lead.cashCollected}
                    tableName="leads"
                    rowId={lead.ghlContactId || lead.id}
                    field="contracted_revenue"
                    format="currency"
                    onSaved={onSaved}
                    className={lead.contractedRevenue > 0 ? 'text-emerald-300' : lead.cashCollected > 0 ? 'text-emerald-400' : 'text-gray-600'}
                  />
                </td>
                <td className="text-center py-2 px-3">
                  {lead.callRecordingUrl && (
                    <a href={lead.callRecordingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </td>
                <td className="text-center py-2 px-3">
                  {lead.ghlContactUrl && (
                    <a
                      href={lead.ghlContactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex"
                      title="Open in GoHighLevel"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </td>
                <td className="text-center py-2 px-3">
                  {removingId === lead.id ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={removalReason}
                        onChange={(e) => setRemovalReason(e.target.value)}
                        placeholder="Reason?"
                        className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-red-500 w-28"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && removalReason.trim()) handleRemovalSubmit(lead.id);
                          if (e.key === 'Escape') { setRemovingId(null); setRemovalReason(''); }
                        }}
                      />
                      <button
                        onClick={() => { if (removalReason.trim()) handleRemovalSubmit(lead.id); }}
                        className="text-xs text-red-400 hover:text-red-300 font-medium px-1"
                        title="Submit removal"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => { setRemovingId(null); setRemovalReason(''); }}
                        className="text-xs text-gray-500 hover:text-gray-300 px-1"
                        title="Cancel"
                      >
                        esc
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRemovingId(lead.id); setRemovalReason(''); }}
                      className="text-red-500/60 hover:text-red-400 transition-colors text-sm font-bold leading-none"
                      title="Flag for removal"
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
