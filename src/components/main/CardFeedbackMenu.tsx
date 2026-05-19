'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Send, Check, MessageSquare } from 'lucide-react';

interface Props {
  /** Stable identifier for the card. e.g. "main:revenue-composition". */
  cardId: string;
}

/**
 * Three-dot kebab on every CardShell. Clicking opens a popover with a
 * "Describe the issue or suggestion" textarea + "Send to Claude" button.
 * POSTs to /api/feedback (Supabase `card_feedback` table). the operator's
 * comments queue up there for me to review and act on.
 */
export default function CardFeedbackMenu({ cardId }: Props) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const submit = async () => {
    if (!comment.trim() || status === 'sending') return;
    setStatus('sending');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId,
          comment: comment.trim(),
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(body);
          if (j.error) msg = j.error;
        } catch {
          if (body) msg = body.slice(0, 200);
        }
        throw new Error(msg);
      }
      setStatus('sent');
      setComment('');
      setTimeout(() => {
        setOpen(false);
        setStatus('idle');
      }, 900);
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message ?? 'Request failed');
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className={`p-1 rounded-md transition-colors ${
          open
            ? 'bg-blue-500/15 text-blue-400'
            : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/60 opacity-0 group-hover:opacity-100'
        }`}
        title="Comment / suggest a fix"
        aria-label="Card actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          ref={popRef}
          className="absolute right-0 top-7 z-50 w-80 bg-[#0f1218] border border-gray-700 rounded-xl shadow-2xl shadow-black/60 p-3"
        >
          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-semibold mb-2">
            <MessageSquare size={11} className="text-blue-400" />
            Send to Claude
          </div>
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="Describe the issue, discrepancy, or fix you'd like…"
            className="w-full h-24 bg-[#1a1d23] border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-100 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            maxLength={4000}
          />
          {status === 'error' && errorMsg && (
            <div className="mt-2 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 leading-snug">
              <div className="font-semibold">Couldn&apos;t save:</div>
              <div className="font-mono break-words">{errorMsg}</div>
              {errorMsg.toLowerCase().includes('card_feedback') && (
                <div className="mt-1 text-red-200/80">
                  Apply migration <span className="font-mono">0021_card_feedback.sql</span> in Supabase SQL editor.
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="text-[10px] text-gray-600 font-mono truncate">{cardId}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setOpen(false); setComment(''); setStatus('idle'); }}
                className="px-2.5 py-1 text-[11px] text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!comment.trim() || status === 'sending'}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  status === 'sent'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : status === 'error'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : !comment.trim() || status === 'sending'
                    ? 'bg-blue-500/10 text-blue-400/50 border border-blue-500/20 cursor-not-allowed'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30'
                }`}
              >
                {status === 'sent' ? (
                  <>
                    <Check size={11} /> Sent
                  </>
                ) : status === 'sending' ? (
                  'Sending…'
                ) : status === 'error' ? (
                  'Retry'
                ) : (
                  <>
                    <Send size={11} /> Send to Claude
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
