'use client';

import { useState, useEffect, useMemo } from 'react';
import PillSelect, { PillSelectOption } from './PillSelect';

interface SalesCall {
  id: string;
  call_date: string;
  call_title: string;
  duration_min: number | null;
  closer_email: string | null;
  grain_url: string | null;
  transcript_txt_url: string | null;
  prospect_name: string | null;
  ghl_contact_id: string | null;
  booking_id: string | null;

  // Quality analysis (Claude-generated)
  qual_score: number | null;
  qual_summary: string | null;
  why_didnt_close: string | null;
  objections: string[] | null;
  motivation_to_show: string | null;
  pain_points: string | null;
  desires_goals: string | null;
  pitch_summary: string | null;
  buying_questions: string[] | null;
  ai_use_cases: string | null;
  prospect_context: string | null;
  offer: string | null;

  // Enrichment
  lead_email: string | null;
  lead_name: string | null;
  lead_source: string | null;
  contact_link: string | null;
  booking_status: string | null;
  booking_date: string | null;
  closed: boolean;
  close_cash: number | null;
  close_contracted: number | null;
  close_offer: string | null;
  close_date: string | null;
}

function money(n: number | null): string {
  if (!n) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function scoreColor(score: number | null): string {
  if (score == null) return 'bg-neutral-800 text-neutral-500';
  if (score >= 8) return 'bg-emerald-900/60 text-emerald-300 border-emerald-700';
  if (score >= 6) return 'bg-amber-900/60 text-amber-300 border-amber-700';
  if (score >= 3) return 'bg-orange-900/60 text-orange-300 border-orange-700';
  return 'bg-red-900/60 text-red-300 border-red-700';
}

function closerShort(email: string | null): string {
  if (!email) return '—';
  const name = email.split('@')[0].replace('.', ' ');
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SalesCallsTab() {
  const [calls, setCalls] = useState<SalesCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [closerFilter, setCloserFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'closed' | 'not_closed' | 'no_show'>('all');
  const [minScore, setMinScore] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch('/api/data/calls?limit=500');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setCalls(data.calls ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const closerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of calls) if (c.closer_email) s.add(c.closer_email);
    return ['all', ...Array.from(s).sort()];
  }, [calls]);

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      if (closerFilter !== 'all' && c.closer_email !== closerFilter) return false;
      if (minScore !== null && (c.qual_score ?? 0) < minScore) return false;
      if (outcomeFilter === 'closed' && !c.closed) return false;
      if (outcomeFilter === 'not_closed' && c.closed) return false;
      if (outcomeFilter === 'no_show' && (c.duration_min ?? 0) >= 5) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${c.prospect_name ?? ''} ${c.lead_email ?? ''} ${c.call_title ?? ''} ${c.offer ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [calls, closerFilter, minScore, search, outcomeFilter]);

  const summary = useMemo(() => {
    return {
      total: filtered.length,
      avgScore: (() => {
        const scored = filtered.filter(c => c.qual_score != null);
        if (scored.length === 0) return null;
        return scored.reduce((s, c) => s + (c.qual_score ?? 0), 0) / scored.length;
      })(),
      closedCount: filtered.filter(c => c.closed).length,
      totalCash: filtered.filter(c => c.closed).reduce((s, c) => s + (c.close_cash ?? 0), 0),
    };
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Sales Calls</h2>
        <p className="text-sm text-neutral-400 mt-1">
          Every call from Grain with Claude-generated quality analysis. Click any row to see
          the full breakdown — why they didn&apos;t close, objections, pain points, pitch summary.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Search prospect / email / title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-neutral-900 text-white border border-neutral-700 rounded px-3 py-1.5 text-sm w-64"
        />
        <PillSelect
          value={closerFilter}
          options={closerOptions.map<PillSelectOption>((c) => ({
            value: c,
            label: c === 'all' ? 'All closers' : closerShort(c),
            color: c === 'all' ? 'gray' : 'blue',
          }))}
          onChange={setCloserFilter}
          maxLabelWidth={160}
        />
        <PillSelect
          value={outcomeFilter}
          options={[
            { value: 'all', label: 'All outcomes', color: 'gray' },
            { value: 'closed', label: 'Closed only', color: 'emerald' },
            { value: 'not_closed', label: 'Not closed', color: 'amber' },
            { value: 'no_show', label: 'No-shows (< 5 min)', color: 'red' },
          ]}
          onChange={(v) => setOutcomeFilter(v as 'all' | 'closed' | 'not_closed' | 'no_show')}
          maxLabelWidth={160}
        />
        <PillSelect
          value={minScore == null ? '' : String(minScore)}
          options={[
            { value: '', label: 'Any score', color: 'gray' },
            { value: '8', label: 'Score ≥ 8', color: 'emerald' },
            { value: '6', label: 'Score ≥ 6', color: 'amber' },
            { value: '3', label: 'Score ≥ 3', color: 'red' },
          ]}
          onChange={(v) => setMinScore(v ? Number(v) : null)}
          maxLabelWidth={140}
        />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wide">Calls shown</div>
          <div className="text-2xl font-bold text-white mt-1">{summary.total}</div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wide">Avg Quality Score</div>
          <div className="text-2xl font-bold text-white mt-1">
            {summary.avgScore != null ? summary.avgScore.toFixed(1) : '—'}
          </div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wide">Closed</div>
          <div className="text-2xl font-bold text-emerald-300 mt-1">
            {summary.closedCount} / {summary.total}
          </div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-xs text-neutral-400 uppercase tracking-wide">Cash from closes</div>
          <div className="text-2xl font-bold text-white mt-1">{money(summary.totalCash)}</div>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-700 text-red-300 px-4 py-3 rounded">
          Error loading calls: {error}
        </div>
      )}

      {/* Calls table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 border-b border-neutral-800">
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Prospect</th>
                <th className="px-4 py-3">Closer</th>
                <th className="px-4 py-3 text-right">Min</th>
                <th className="px-4 py-3 text-center">Score</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3 text-right">Cash</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered.map((c) => {
                const isOpen = expandedId === c.id;
                return (
                  <CallRow
                    key={c.id}
                    call={c}
                    isOpen={isOpen}
                    onToggle={() => setExpandedId(isOpen ? null : c.id)}
                  />
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="text-center text-neutral-500 italic py-8">
                    No calls match these filters.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={10} className="text-center text-neutral-500 py-8">Loading…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Row + expanded detail ────────────────────────────────────────────────────

function CallRow({ call, isOpen, onToggle }: { call: SalesCall; isOpen: boolean; onToggle: () => void }) {
  const likelyNoShow = (call.duration_min ?? 0) < 5;

  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-neutral-800/50">
        <td className="px-4 py-3 text-neutral-500">{isOpen ? '▾' : '▸'}</td>
        <td className="px-4 py-3 text-neutral-400">{call.call_date}</td>
        <td className="px-4 py-3">
          <div className="text-white font-medium">{call.prospect_name || call.lead_name || '—'}</div>
          {call.lead_email && <div className="text-xs text-neutral-500">{call.lead_email}</div>}
        </td>
        <td className="px-4 py-3 text-neutral-300">{closerShort(call.closer_email)}</td>
        <td className="px-4 py-3 text-right text-neutral-400">
          {call.duration_min != null ? Math.round(call.duration_min) : '—'}
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`inline-block px-2 py-0.5 rounded text-xs border ${scoreColor(call.qual_score)}`}>
            {call.qual_score != null ? call.qual_score.toFixed(1) : '—'}
          </span>
        </td>
        <td className="px-4 py-3">
          {call.closed ? (
            <span className="text-emerald-300 text-xs font-semibold">✓ CLOSED</span>
          ) : likelyNoShow ? (
            <span className="text-neutral-500 text-xs italic">No-show</span>
          ) : (
            <span className="text-neutral-400 text-xs">Showed / no close</span>
          )}
        </td>
        <td className="px-4 py-3 text-neutral-400 truncate max-w-[180px]">
          {call.close_offer ?? call.offer ?? '—'}
        </td>
        <td className="px-4 py-3 text-right text-neutral-200">{money(call.close_cash)}</td>
        <td className="px-4 py-3">
          {call.grain_url && (
            <a
              href={call.grain_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Grain ↗
            </a>
          )}
        </td>
      </tr>
      {isOpen && <CallDetail call={call} />}
    </>
  );
}

function CallDetail({ call }: { call: SalesCall }) {
  return (
    <tr>
      <td colSpan={10} className="p-0 bg-neutral-950">
        <div className="p-6 space-y-5">
          {/* Top row: meta + quick links */}
          <div className="flex flex-wrap gap-3 items-center text-xs text-neutral-400">
            <span>Call title: <span className="text-neutral-200">{call.call_title}</span></span>
            {call.closer_email && <span>• Closer: <span className="text-neutral-200">{call.closer_email}</span></span>}
            {call.booking_status && <span>• Booking: <span className="text-neutral-200">{call.booking_status}</span></span>}
            {call.lead_source && <span>• Source: <span className="text-neutral-200">{call.lead_source}</span></span>}
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-3 text-xs">
            {call.grain_url && (
              <a href={call.grain_url} target="_blank" rel="noopener noreferrer" className="bg-blue-900/40 border border-blue-700 text-blue-300 px-3 py-1.5 rounded hover:bg-blue-900/60">
                Grain recording ↗
              </a>
            )}
            {call.transcript_txt_url && (
              <a href={call.transcript_txt_url} target="_blank" rel="noopener noreferrer" className="bg-neutral-800 border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded hover:bg-neutral-700">
                Transcript ↗
              </a>
            )}
            {call.contact_link && (
              <a href={call.contact_link} target="_blank" rel="noopener noreferrer" className="bg-neutral-800 border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded hover:bg-neutral-700">
                GHL contact ↗
              </a>
            )}
          </div>

          {/* Close summary (if closed) */}
          {call.closed && (
            <div className="bg-emerald-950/40 border border-emerald-800 rounded p-3 text-sm">
              <span className="text-emerald-300 font-semibold">✓ CLOSED DEAL</span>
              <span className="text-neutral-300 ml-3">
                {call.close_offer} · Cash {money(call.close_cash)} · Contracted {money(call.close_contracted)} · {call.close_date}
              </span>
            </div>
          )}

          {/* Quality analysis grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title="Quality Summary" emoji="📊" colorClass={scoreColor(call.qual_score)}>
              {call.qual_summary ?? <em className="text-neutral-500">Not scored yet.</em>}
            </Section>

            <Section title="Why didn't close" emoji="❓">
              {call.why_didnt_close ?? <em className="text-neutral-500">Not analyzed.</em>}
            </Section>

            <Section title="Motivation to show" emoji="🔥">
              {call.motivation_to_show ?? <em className="text-neutral-500">Not analyzed.</em>}
            </Section>

            <Section title="Pitch summary" emoji="💡">
              {call.pitch_summary ?? <em className="text-neutral-500">Not analyzed.</em>}
            </Section>

            <Section title="Pain points" emoji="💢">
              <PreformattedList text={call.pain_points} />
            </Section>

            <Section title="Desires / goals" emoji="🎯">
              <PreformattedList text={call.desires_goals} />
            </Section>

            <Section title="Objections" emoji="🛑">
              {call.objections && call.objections.length > 0 ? (
                <ul className="list-disc ml-4 space-y-1">
                  {call.objections.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              ) : <em className="text-neutral-500">None recorded.</em>}
            </Section>

            <Section title="Buying questions" emoji="💬">
              {call.buying_questions && call.buying_questions.length > 0 ? (
                <ul className="list-disc ml-4 space-y-1">
                  {call.buying_questions.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              ) : <em className="text-neutral-500">None recorded.</em>}
            </Section>

            <Section title="AI use cases" emoji="🤖">
              <PreformattedList text={call.ai_use_cases} />
            </Section>

            <Section title="Prospect context" emoji="🧑‍💼">
              {call.prospect_context ?? <em className="text-neutral-500">Not analyzed.</em>}
            </Section>
          </div>
        </div>
      </td>
    </tr>
  );
}

function Section({ title, emoji, colorClass, children }: { title: string; emoji: string; colorClass?: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded p-3">
      <div className={`inline-block text-xs uppercase tracking-wide mb-2 px-2 py-0.5 rounded ${colorClass ?? 'text-neutral-400'}`}>
        {emoji} {title}
      </div>
      <div className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">{children}</div>
    </div>
  );
}

function PreformattedList({ text }: { text: string | null }) {
  if (!text) return <em className="text-neutral-500">Not analyzed.</em>;
  // Try to render bullet-style text as a list
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const looksLikeBullets = lines.length > 1 && lines.every(l => /^[-•]/.test(l));
  if (looksLikeBullets) {
    return (
      <ul className="list-disc ml-4 space-y-1">
        {lines.map((l, i) => <li key={i}>{l.replace(/^[-•]\s*/, '')}</li>)}
      </ul>
    );
  }
  return <div>{text}</div>;
}
