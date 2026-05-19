'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { loadJSON, saveJSON } from '@/lib/storage/localStore';
import { Search, Trash2, Plus, ChevronUp, ChevronDown, ExternalLink, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Competitor {
  id: string;
  name: string;
  instagram: string;
  youtube: string;
  ads_library_url: string;
  strengths: string;
  monthly_rev: number;
  niche: string[];
  competitor_type: 'Direct' | 'Indirect';
  notes: string;
  custom_fields: Record<string, string>;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type SortDir = 'asc' | 'desc';

interface ColumnDef {
  key: string;
  label: string;
  type: 'text' | 'url' | 'currency' | 'niche' | 'competitorType' | 'custom' | 'social' | 'notes';
  width?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ls-cc.competitors';

const NICHE_COLORS: Record<string, string> = {
  Agency: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  AI: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Sales: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  Marketing: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  Trading: 'bg-green-500/20 text-green-300 border-green-500/30',
  SaaS: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  Coaching: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'E-commerce': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  Finance: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Education: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  Fitness: 'bg-lime-500/20 text-lime-300 border-lime-500/30',
  Real_Estate: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
};

const DEFAULT_NICHE_COLOR = 'bg-gray-500/20 text-gray-300 border-gray-500/30';

const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'COMPETITOR NAME', type: 'text', width: 'min-w-[180px]' },
  { key: 'instagram', label: 'IG', type: 'social', width: 'min-w-[60px]' },
  { key: 'youtube', label: 'YT', type: 'social', width: 'min-w-[60px]' },
  { key: 'ads_library_url', label: 'ADS', type: 'social', width: 'min-w-[60px]' },
  { key: 'strengths', label: 'STRENGTHS', type: 'text', width: 'min-w-[160px]' },
  { key: 'monthly_rev', label: 'MONTHLY REV ($)', type: 'currency', width: 'min-w-[130px]' },
  { key: 'niche', label: 'NICHE', type: 'niche', width: 'min-w-[180px]' },
  { key: 'competitor_type', label: 'COMPETITOR TYPE', type: 'competitorType', width: 'min-w-[140px]' },
  { key: 'notes', label: 'NOTES', type: 'notes', width: 'min-w-[200px]' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyCompetitor(): Competitor {
  return {
    id: generateId(),
    name: '',
    instagram: '',
    youtube: '',
    ads_library_url: '',
    strengths: '',
    monthly_rev: 0,
    niche: [],
    competitor_type: 'Indirect',
    notes: '',
    custom_fields: {},
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function getNicheColor(niche: string): string {
  return NICHE_COLORS[niche] ?? DEFAULT_NICHE_COLOR;
}

function getFieldValue(c: Competitor, key: string): string {
  if (key in c) {
    const val = (c as Record<string, unknown>)[key];
    if (Array.isArray(val)) return val.join(', ');
    if (val === null || val === undefined) return '';
    return String(val);
  }
  return c.custom_fields?.[key] ?? '';
}

// ---------------------------------------------------------------------------
// Social Link Badges
// ---------------------------------------------------------------------------

function SocialBadge({
  url,
  platform,
}: {
  url: string;
  platform: 'instagram' | 'youtube' | 'ads_library_url';
}) {
  if (!url) {
    return <span className="text-gray-600 text-xs">&mdash;</span>;
  }

  const href = url.startsWith('http') ? url : `https://${url}`;

  const config = {
    instagram: { label: 'IG', bg: 'bg-pink-500/20', text: 'text-pink-400', hover: 'hover:bg-pink-500/30' },
    youtube: { label: 'YT', bg: 'bg-red-500/20', text: 'text-red-400', hover: 'hover:bg-red-500/30' },
    ads_library_url: { label: 'Meta', bg: 'bg-blue-500/20', text: 'text-blue-400', hover: 'hover:bg-blue-500/30' },
  }[platform];

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={url}
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-bold ${config.bg} ${config.text} ${config.hover} transition-colors cursor-pointer`}
    >
      {config.label}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function NicheBadge({ niche }: { niche: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${getNicheColor(niche)}`}>
      {niche}
    </span>
  );
}

function CompetitorTypeBadge({ type }: { type: string }) {
  const cls = type === 'Direct'
    ? 'bg-green-500/20 text-green-300 border-green-500/30'
    : 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Notes Display (multi-line with bullet support)
// ---------------------------------------------------------------------------

function NotesDisplay({ text }: { text: string }) {
  if (!text) return <span className="text-gray-600 text-xs">-</span>;

  return (
    <div className="text-gray-300 text-xs whitespace-pre-wrap leading-relaxed">
      {text.split('\n').map((line, i) => {
        const isBullet = line.trimStart().startsWith('- ');
        if (isBullet) {
          const indent = line.length - line.trimStart().length;
          return (
            <div key={i} style={{ paddingLeft: `${indent * 4 + 8}px` }} className="relative">
              <span className="absolute left-0 text-gray-500" style={{ left: `${indent * 4}px` }}>&bull;</span>
              {line.trimStart().slice(2)}
            </div>
          );
        }
        return <div key={i}>{line || '\u00A0'}</div>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Editors
// ---------------------------------------------------------------------------

function TextEditor({
  value,
  onSave,
  onCancel,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      className="w-full bg-[#23262e] border border-blue-500/50 rounded px-2 py-1 text-xs text-white outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSave(draft);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onSave(draft)}
      placeholder={placeholder}
    />
  );
}

function NotesEditor({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, []);

  const rows = Math.max(2, draft.split('\n').length);

  return (
    <textarea
      ref={ref}
      className="w-full bg-[#23262e] border border-blue-500/50 rounded px-2 py-1 text-xs text-white outline-none resize-none leading-relaxed"
      value={draft}
      rows={rows}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          // Cmd/Ctrl+Enter inserts a newline
          e.preventDefault();
          const target = e.target as HTMLTextAreaElement;
          const start = target.selectionStart;
          const end = target.selectionEnd;
          const newVal = draft.slice(0, start) + '\n' + draft.slice(end);
          setDraft(newVal);
          // Move cursor after the newline
          requestAnimationFrame(() => {
            target.setSelectionRange(start + 1, start + 1);
          });
        } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          // Plain Enter saves
          e.preventDefault();
          onSave(draft);
        }
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onSave(draft)}
    />
  );
}

function CurrencyEditor({
  value,
  onSave,
  onCancel,
}: {
  value: number;
  onSave: (v: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(String(value || ''));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      type="number"
      className="w-full bg-[#23262e] border border-blue-500/50 rounded px-2 py-1 text-xs text-white outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSave(Number(draft) || 0);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onSave(Number(draft) || 0)}
    />
  );
}

function NicheEditor({
  value,
  onSave,
  onCancel,
}: {
  value: string[];
  onSave: (v: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value.join(', '));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input
      ref={ref}
      className="w-full bg-[#23262e] border border-blue-500/50 rounded px-2 py-1 text-xs text-white outline-none"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const niches = draft.split(',').map((s) => s.trim()).filter(Boolean);
          onSave(niches);
        }
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => {
        const niches = draft.split(',').map((s) => s.trim()).filter(Boolean);
        onSave(niches);
      }}
      placeholder="Agency, AI, Sales..."
    />
  );
}

function TypeEditor({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: 'Direct' | 'Indirect') => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <select
      ref={ref}
      className="w-full bg-[#23262e] border border-blue-500/50 rounded px-2 py-1 text-xs text-white outline-none"
      value={value}
      onChange={(e) => onSave(e.target.value as 'Direct' | 'Indirect')}
      onBlur={() => onCancel()}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <option value="Direct">Direct</option>
      <option value="Indirect">Indirect</option>
    </select>
  );
}

// ---------------------------------------------------------------------------
// Add Competitor Modal
// ---------------------------------------------------------------------------

function AddCompetitorModal({
  onAdd,
  onClose,
}: {
  onAdd: (c: Competitor) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [instagram, setInstagram] = useState('');
  const [youtube, setYoutube] = useState('');
  const [adsLibraryUrl, setAdsLibraryUrl] = useState('');
  const [strengths, setStrengths] = useState('');
  const [monthlyRev, setMonthlyRev] = useState('');
  const [niche, setNiche] = useState('');
  const [competitorType, setCompetitorType] = useState<'Direct' | 'Indirect'>('Indirect');
  const [notes, setNotes] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const c = emptyCompetitor();
    c.name = name.trim();
    c.instagram = instagram.trim();
    c.youtube = youtube.trim();
    c.ads_library_url = adsLibraryUrl.trim();
    c.strengths = strengths.trim();
    c.monthly_rev = Number(monthlyRev) || 0;
    c.niche = niche.split(',').map((s) => s.trim()).filter(Boolean);
    c.competitor_type = competitorType;
    c.notes = notes.trim();

    onAdd(c);
  };

  const inputClass =
    'w-full bg-[#23262e] border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500/60 transition-colors';
  const labelClass = 'block text-xs font-medium text-gray-400 mb-1.5';

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#1a1d23] rounded-2xl border border-gray-700 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 className="text-base font-bold text-white">Add Competitor</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className={labelClass}>
                Name <span className="text-red-400">*</span>
              </label>
              <input
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Competitor name"
                required
              />
            </div>

            {/* Instagram URL */}
            <div>
              <label className={labelClass}>Instagram URL</label>
              <input
                type="text"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                className={inputClass}
                placeholder="instagram.com/username"
              />
            </div>

            {/* YouTube URL */}
            <div>
              <label className={labelClass}>YouTube URL</label>
              <input
                type="text"
                value={youtube}
                onChange={(e) => setYoutube(e.target.value)}
                className={inputClass}
                placeholder="youtube.com/@channel"
              />
            </div>

            {/* Ads Library URL */}
            <div>
              <label className={labelClass}>Ads Library URL</label>
              <input
                type="text"
                value={adsLibraryUrl}
                onChange={(e) => setAdsLibraryUrl(e.target.value)}
                className={inputClass}
                placeholder="facebook.com/ads/library/..."
              />
            </div>

            {/* Strengths */}
            <div>
              <label className={labelClass}>Strengths</label>
              <textarea
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
                className={`${inputClass} resize-none`}
                rows={2}
                placeholder="Key strengths..."
              />
            </div>

            {/* Monthly Revenue */}
            <div>
              <label className={labelClass}>Monthly Revenue</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                <input
                  type="number"
                  value={monthlyRev}
                  onChange={(e) => setMonthlyRev(e.target.value)}
                  className={`${inputClass} pl-7`}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Niche */}
            <div>
              <label className={labelClass}>Niche</label>
              <input
                type="text"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className={inputClass}
                placeholder="AI, Agency, Sales"
              />
              <p className="text-[10px] text-gray-600 mt-1">Comma separated</p>
            </div>

            {/* Competitor Type */}
            <div>
              <label className={labelClass}>Competitor Type</label>
              <div className="flex items-center gap-4 mt-1.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="competitor_type"
                    value="Direct"
                    checked={competitorType === 'Direct'}
                    onChange={() => setCompetitorType('Direct')}
                    className="text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0 bg-[#23262e] border-gray-600"
                  />
                  <span className="text-sm text-gray-300">Direct</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="competitor_type"
                    value="Indirect"
                    checked={competitorType === 'Indirect'}
                    onChange={() => setCompetitorType('Indirect')}
                    className="text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0 bg-[#23262e] border-gray-600"
                  />
                  <span className="text-sm text-gray-300">Indirect</span>
                </label>
              </div>
            </div>

            {/* Notes - full width */}
            <div className="col-span-2">
              <label className={labelClass}>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${inputClass} resize-none`}
                rows={3}
                placeholder="Additional notes..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white bg-gray-700/50 hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add Competitor
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CompetitorTracker() {
  // ----- State -----
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>(DEFAULT_COLUMNS);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingCell, setEditingCell] = useState<{ id: string; key: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // ----- Persistence helpers -----
  const persistLocal = useCallback((data: Competitor[]) => {
    saveJSON(STORAGE_KEY, data);
  }, []);

  const apiSync = useCallback(async (method: string, body?: unknown, query?: string) => {
    try {
      const url = `/api/competitors${query ?? ''}`;
      const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      await fetch(url, opts);
    } catch {
      // Supabase not set up yet — silent fail, localStorage has the data
    }
  }, []);

  // ----- Load on mount -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try Supabase first
      try {
        const res = await fetch('/api/competitors');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            if (!cancelled) {
              setCompetitors(data);
              persistLocal(data);
              setLoaded(true);
              return;
            }
          }
        }
      } catch {
        // fall through
      }
      // Fall back to localStorage
      const local = loadJSON<Competitor[]>(STORAGE_KEY, []);
      if (!cancelled) {
        setCompetitors(local);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [persistLocal]);

  // ----- CRUD operations -----
  const addCompetitorFromModal = useCallback((c: Competitor) => {
    c.sort_order = competitors.length;
    setCompetitors((prev) => {
      const next = [c, ...prev];
      persistLocal(next);
      return next;
    });
    apiSync('POST', c);
    setShowAddModal(false);
  }, [competitors.length, persistLocal, apiSync]);

  const updateCompetitor = useCallback((id: string, field: string, value: unknown) => {
    setCompetitors((prev) => {
      const next = prev.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, updated_at: new Date().toISOString() };
        if (field in updated) {
          (updated as Record<string, unknown>)[field] = value;
        } else {
          updated.custom_fields = { ...updated.custom_fields, [field]: String(value) };
        }
        return updated;
      });
      persistLocal(next);
      return next;
    });

    // Build the API update payload
    const payload: Record<string, unknown> = { id };
    payload[field] = value;
    apiSync('PUT', payload);
  }, [persistLocal, apiSync]);

  const deleteCompetitor = useCallback((id: string) => {
    setCompetitors((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistLocal(next);
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDeleteConfirm(null);
    apiSync('DELETE', undefined, `?id=${id}`);
  }, [persistLocal, apiSync]);

  const bulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    setCompetitors((prev) => {
      const next = prev.filter((c) => !selectedIds.has(c.id));
      persistLocal(next);
      return next;
    });
    for (const id of selectedIds) {
      apiSync('DELETE', undefined, `?id=${id}`);
    }
    setSelectedIds(new Set());
  }, [selectedIds, persistLocal, apiSync]);

  const addCustomColumn = useCallback(() => {
    const name = prompt('Column name:');
    if (!name) return;
    const key = `custom_${name.toLowerCase().replace(/\s+/g, '_')}`;
    setColumns((prev) => [...prev, { key, label: name.toUpperCase(), type: 'custom', width: 'min-w-[140px]' }]);
  }, []);

  // ----- Sorting -----
  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // ----- Filtered + sorted data -----
  const filteredCompetitors = useMemo(() => {
    let list = competitors;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.niche.some((n) => n.toLowerCase().includes(q)) ||
        c.notes.toLowerCase().includes(q) ||
        c.strengths.toLowerCase().includes(q)
      );
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = getFieldValue(a, sortKey);
        const bv = getFieldValue(b, sortKey);
        if (sortKey === 'monthly_rev') {
          const diff = (a.monthly_rev || 0) - (b.monthly_rev || 0);
          return sortDir === 'asc' ? diff : -diff;
        }
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [competitors, search, sortKey, sortDir]);

  // ----- Selection -----
  const allSelected = filteredCompetitors.length > 0 && filteredCompetitors.every((c) => selectedIds.has(c.id));

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCompetitors.map((c) => c.id)));
    }
  }, [allSelected, filteredCompetitors]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ----- Render cell content -----
  const renderCell = (c: Competitor, col: ColumnDef) => {
    const isEditing = editingCell?.id === c.id && editingCell?.key === col.key;

    if (isEditing) {
      const cancel = () => setEditingCell(null);
      switch (col.type) {
        case 'currency':
          return (
            <CurrencyEditor
              value={c.monthly_rev}
              onSave={(v) => { updateCompetitor(c.id, col.key, v); setEditingCell(null); }}
              onCancel={cancel}
            />
          );
        case 'niche':
          return (
            <NicheEditor
              value={c.niche}
              onSave={(v) => { updateCompetitor(c.id, col.key, v); setEditingCell(null); }}
              onCancel={cancel}
            />
          );
        case 'competitorType':
          return (
            <TypeEditor
              value={c.competitor_type}
              onSave={(v) => { updateCompetitor(c.id, col.key, v); setEditingCell(null); }}
              onCancel={cancel}
            />
          );
        case 'notes':
          return (
            <NotesEditor
              value={getFieldValue(c, col.key)}
              onSave={(v) => { updateCompetitor(c.id, col.key, v); setEditingCell(null); }}
              onCancel={cancel}
            />
          );
        case 'social':
          // In edit mode, show a text input for the URL
          return (
            <TextEditor
              value={getFieldValue(c, col.key)}
              onSave={(v) => { updateCompetitor(c.id, col.key, v); setEditingCell(null); }}
              onCancel={cancel}
              placeholder={
                col.key === 'instagram'
                  ? 'instagram.com/username'
                  : col.key === 'youtube'
                    ? 'youtube.com/@channel'
                    : 'facebook.com/ads/library/...'
              }
            />
          );
        default:
          return (
            <TextEditor
              value={getFieldValue(c, col.key)}
              onSave={(v) => { updateCompetitor(c.id, col.key, v); setEditingCell(null); }}
              onCancel={cancel}
              placeholder={col.label.toLowerCase()}
            />
          );
      }
    }

    // Display mode
    switch (col.type) {
      case 'social':
        return (
          <SocialBadge
            url={getFieldValue(c, col.key)}
            platform={col.key as 'instagram' | 'youtube' | 'ads_library_url'}
          />
        );
      case 'currency':
        return (
          <span className="text-emerald-400 text-xs font-medium">
            {c.monthly_rev ? formatCurrency(c.monthly_rev) : '-'}
          </span>
        );
      case 'niche':
        return c.niche.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {c.niche.map((n) => <NicheBadge key={n} niche={n} />)}
          </div>
        ) : (
          <span className="text-gray-600 text-xs">-</span>
        );
      case 'competitorType':
        return <CompetitorTypeBadge type={c.competitor_type} />;
      case 'notes':
        return <NotesDisplay text={getFieldValue(c, col.key)} />;
      default: {
        const val = getFieldValue(c, col.key);
        return val ? (
          <span className="text-gray-300 text-xs">{val}</span>
        ) : (
          <span className="text-gray-600 text-xs">-</span>
        );
      }
    }
  };

  // ----- Skeleton / loading -----
  if (!loaded) {
    return (
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-800 rounded w-1/3" />
          <div className="h-64 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add Competitor Modal */}
      {showAddModal && (
        <AddCompetitorModal
          onAdd={addCompetitorFromModal}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">Competitor Tracker</h2>
          <div className="flex items-center gap-1 bg-[#23262e] rounded-lg px-2 py-1 border border-gray-700">
            <span className="text-[10px] text-gray-400 font-medium">Table</span>
          </div>
          <span className="text-xs text-gray-500">{competitors.length} competitors</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors"
            >
              <Trash2 size={12} />
              Delete {selectedIds.size}
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            <Plus size={14} />
            New
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search competitors..."
          className="w-full bg-[#23262e] border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500/50 transition-colors"
        />
      </div>

      {/* Table */}
      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-[#15171c]">
                {/* Checkbox */}
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-600 bg-[#23262e] text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-3 text-left ${col.width ?? ''}`}
                  >
                    <button
                      onClick={() => handleSort(col.key)}
                      className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-gray-400 hover:text-gray-200 transition-colors group"
                    >
                      {col.key === 'name' && <span className="text-gray-500 font-normal">Aa</span>}
                      {col.key === 'monthly_rev' && <span className="text-gray-500 font-normal">#</span>}
                      {col.label}
                      {sortKey === col.key ? (
                        sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
                      ) : (
                        <ChevronUp size={10} className="opacity-0 group-hover:opacity-30" />
                      )}
                    </button>
                  </th>
                ))}
                {/* Add column button */}
                <th className="w-10 px-2 py-3">
                  <button
                    onClick={addCustomColumn}
                    className="text-gray-600 hover:text-gray-400 transition-colors"
                    title="Add column"
                  >
                    <Plus size={14} />
                  </button>
                </th>
                {/* Delete column spacer */}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filteredCompetitors.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 3} className="text-center py-12">
                    <div className="text-gray-500 text-sm">
                      {search ? 'No competitors match your search.' : 'No competitors yet.'}
                    </div>
                    {!search && (
                      <button
                        onClick={() => setShowAddModal(true)}
                        className="mt-3 inline-flex items-center gap-1 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 transition-colors"
                      >
                        <Plus size={14} />
                        Add your first competitor
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredCompetitors.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-gray-800 hover:bg-[#1e2128] transition-colors group"
                  >
                    {/* Checkbox */}
                    <td className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded border-gray-600 bg-[#23262e] text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0 cursor-pointer"
                      />
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 cursor-pointer ${col.width ?? ''}`}
                        onClick={() => setEditingCell({ id: c.id, key: col.key })}
                      >
                        {renderCell(c, col)}
                      </td>
                    ))}
                    {/* Empty column cell for add-column */}
                    <td className="w-10" />
                    {/* Delete button */}
                    <td className="w-10 px-2 py-2.5">
                      {deleteConfirm === c.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteCompetitor(c.id)}
                            className="text-[10px] text-red-400 font-medium hover:text-red-300"
                          >
                            Yes
                          </button>
                          <span className="text-gray-600 text-[10px]">/</span>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-[10px] text-gray-400 font-medium hover:text-gray-300"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(c.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
                          title="Delete competitor"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary bar */}
      {competitors.length > 0 && (
        <div className="flex items-center gap-6 text-xs text-gray-500 px-1">
          <span>
            {competitors.filter((c) => c.competitor_type === 'Direct').length} direct
            {' / '}
            {competitors.filter((c) => c.competitor_type === 'Indirect').length} indirect
          </span>
          <span>
            Avg rev: {formatCurrency(
              competitors.reduce((s, c) => s + (c.monthly_rev || 0), 0) / (competitors.filter(c => c.monthly_rev > 0).length || 1)
            )}
          </span>
          <span>
            Top niches: {
              Object.entries(
                competitors.flatMap((c) => c.niche).reduce((acc, n) => {
                  acc[n] = (acc[n] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              )
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([n]) => n)
                .join(', ') || 'None'
            }
          </span>
        </div>
      )}
    </div>
  );
}
