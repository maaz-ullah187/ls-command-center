'use client';

import { useState } from 'react';
import { Send, Check, Loader2 } from 'lucide-react';

interface PingPayload {
  bucket:
    | 'unknown_source'
    | 'unlogged_calls'
    | 'missing_quality'
    | 'missing_eod'
    | 'data_anomaly'
    | 'revenue_flag'
    | 'missing_billing_type'
    | 'missing_expense_type';
  ownerName?: string;
  leadId?: string;
  leadName?: string;
  summary: string;
  deepLink?: string;
}

interface PingButtonProps {
  payload: PingPayload;
  size?: 'sm' | 'xs';
}

/**
 * Per-row Ping button used by ReviewQueueBanner.
 * POSTs to /api/review-queue/ping which DMs the row owner via Slack
 * (or falls back to #ops if no slack_user_id is found in t90_team_roster).
 */
export default function PingButton({ payload, size = 'xs' }: PingButtonProps) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state === 'sending' || state === 'sent') return;
    setState('sending');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/review-queue/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setState('error');
        setErrorMsg(data?.error || `HTTP ${res.status}`);
        return;
      }
      setState('sent');
      // After 3s allow re-ping
      setTimeout(() => setState('idle'), 3000);
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'unknown');
    }
  };

  const sz = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]';
  const iconSz = size === 'sm' ? 12 : 10;

  if (state === 'sent') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded ${sz} bg-emerald-900/40 text-emerald-300 border border-emerald-800/50`}
        title="Ping delivered"
      >
        <Check size={iconSz} /> Pinged
      </span>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={state === 'sending'}
      title={errorMsg ? `Failed: ${errorMsg}` : 'Send a Slack DM to the row owner'}
      className={`inline-flex items-center gap-1 rounded ${sz} border transition-colors ${
        state === 'error'
          ? 'bg-red-900/30 text-red-300 border-red-800/50 hover:bg-red-900/40'
          : 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40'
      } disabled:opacity-50 disabled:cursor-wait`}
    >
      {state === 'sending' ? <Loader2 size={iconSz} className="animate-spin" /> : <Send size={iconSz} />}
      {state === 'error' ? 'Retry' : 'Ping'}
    </button>
  );
}
