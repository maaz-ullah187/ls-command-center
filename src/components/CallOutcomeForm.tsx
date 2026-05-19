'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Lead, ShowStatus, CallOutcome } from '@/lib/types';
import PillSelect, { PillSelectOption } from './PillSelect';

interface CallOutcomeFormProps {
  lead: Lead;
  onSave: (leadId: string, updates: Partial<Lead>) => void;
  onClose: () => void;
}

const SHOW_STATUSES: ShowStatus[] = ['Showed', 'No Show', 'Cancelled', 'Rescheduled'];
const CALL_OUTCOMES: CallOutcome[] = ['Closed Won', 'Follow Up Booked', 'Not Qualified', 'No Decision', 'Closed Lost'];
const FOLLOW_UP_TYPES = ['Qualification Call', 'Sales Call', 'Technical Review', 'Contract Review', 'Other'];

// Parse existing ISO follow-up datetime to date+time parts for form init
function parseFollowUp(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => n.toString().padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export default function CallOutcomeForm({ lead, onSave, onClose }: CallOutcomeFormProps) {
  const [showStatus, setShowStatus] = useState<ShowStatus | ''>(lead.showStatus || '');
  const [callOutcome, setCallOutcome] = useState<CallOutcome | ''>(lead.callOutcome || '');
  const [qualityScore, setQualityScore] = useState(lead.qualityScore || 5);
  const [cashCollected, setCashCollected] = useState(lead.cashCollected || 0);
  const [contractedRevenue, setContractedRevenue] = useState(lead.contractedRevenue || 0);
  const [notes, setNotes] = useState('');

  const initialFollowUp = parseFollowUp(lead.followUpDate);
  const [followUpType, setFollowUpType] = useState<string>(lead.followUpType || '');
  const [followUpDate, setFollowUpDate] = useState(initialFollowUp.date);
  const [followUpTime, setFollowUpTime] = useState(initialFollowUp.time || '09:00');

  const handleSave = () => {
    let followUpIso: string | null = null;
    if (callOutcome === 'Follow Up Booked' && followUpDate) {
      // Combine date + time into ISO string (local timezone)
      const [y, m, d] = followUpDate.split('-').map(Number);
      const [hh, mm] = followUpTime.split(':').map(Number);
      followUpIso = new Date(y, (m || 1) - 1, d || 1, hh || 9, mm || 0).toISOString();
    }

    const updates: Partial<Lead> = {
      showStatus: showStatus || null,
      callOutcome: callOutcome || null,
      qualityScore,
      cashCollected: callOutcome === 'Closed Won' ? cashCollected : 0,
      contractedRevenue: callOutcome === 'Closed Won' ? contractedRevenue : 0,
      stage: callOutcome === 'Closed Won' ? 'Closed Won' :
             callOutcome === 'Closed Lost' ? 'Closed Lost' :
             callOutcome ? 'Qualified' : lead.stage,
      followUpType: callOutcome === 'Follow Up Booked' ? (followUpType || null) : null,
      followUpDate: followUpIso,
      outcomeLoggedAt: new Date().toISOString(),
    };
    onSave(lead.id, updates);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-lg mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold text-sm">Log Call Outcome</h3>
            <p className="text-xs text-gray-500 mt-0.5">{lead.name} ({lead.email})</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Show Status */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-2">Show Status</label>
            <div className="flex flex-wrap gap-2">
              {SHOW_STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => setShowStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    showStatus === s
                      ? s === 'Showed'
                        ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/50'
                        : s === 'No Show'
                        ? 'bg-red-600/20 text-red-400 border-red-500/50'
                        : 'bg-amber-600/20 text-amber-400 border-amber-500/50'
                      : 'bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-500'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Call Outcome (only if Showed) */}
          {showStatus === 'Showed' && (
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-2">Call Outcome</label>
              <div className="flex flex-wrap gap-2">
                {CALL_OUTCOMES.map(o => (
                  <button
                    key={o}
                    onClick={() => setCallOutcome(o)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      callOutcome === o
                        ? o === 'Closed Won'
                          ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/50'
                          : o === 'Closed Lost'
                          ? 'bg-red-600/20 text-red-400 border-red-500/50'
                          : 'bg-blue-600/20 text-blue-400 border-blue-500/50'
                        : 'bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quality Score */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-2">
              Lead Quality Score: <span className="text-white font-bold">{qualityScore}/10</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={qualityScore}
              onChange={e => setQualityScore(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-1">
              <span>Low Quality</span>
              <span>High Quality</span>
            </div>
          </div>

          {/* Cash & Contracted (only if Closed Won) */}
          {callOutcome === 'Closed Won' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Cash Collected ($)</label>
                <input
                  type="number"
                  value={cashCollected || ''}
                  onChange={e => setCashCollected(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Contracted Revenue ($)</label>
                <input
                  type="number"
                  value={contractedRevenue || ''}
                  onChange={e => setContractedRevenue(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          {/* Next Follow-Up Information (if Follow Up Booked) */}
          {callOutcome === 'Follow Up Booked' && (
            <div className="bg-blue-950/20 border border-blue-900/40 rounded-lg p-3 space-y-3">
              <h4 className="text-xs font-semibold text-blue-300 uppercase tracking-wide">Next Follow-Up Information</h4>

              <div>
                <label className="block text-[11px] text-gray-400 font-medium mb-1">Follow-Up Type</label>
                <PillSelect
                  value={followUpType}
                  options={FOLLOW_UP_TYPES.map<PillSelectOption>((t) => ({ value: t, label: t, color: 'blue' }))}
                  onChange={setFollowUpType}
                  placeholder="Select follow-up type..."
                  allowClear
                  clearLabel="None"
                  maxLabelWidth={220}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 font-medium mb-1">Date</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 font-medium mb-1">Time</label>
                  <input
                    type="time"
                    value={followUpTime}
                    onChange={e => setFollowUpTime(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this call..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!showStatus}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Save Outcome
          </button>
        </div>
      </div>
    </div>
  );
}
