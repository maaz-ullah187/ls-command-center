'use client';

// EditableValue — inline editing with override persistence (Pillar 0.5)
//
// Wrap any displayed value (number, string, currency) with this component.
// On hover → pencil icon. On click → inline editor with the current value
// pre-filled. On save → POST to /api/overrides. On revert → DELETE from
// /api/overrides. The parent component sees the corrected value via
// dataSources.ts left-join on next fetch.
//
// Overridden values show a small blue dot + tooltip showing who edited and when.

import { useState, useRef, useEffect, useCallback } from 'react';
import { Pencil, X, Check, RotateCcw } from 'lucide-react';

interface EditableValueProps {
  /** The currently displayed (possibly already overridden) value */
  value: string | number;
  /** Table name in Supabase: 'leads', 'ads', 'closer_eod_reports', etc */
  tableName: string;
  /** The row's unique ID */
  rowId: string;
  /** The field name being edited: 'closedDeals', 'revenue', etc */
  field: string;
  /** The raw (un-overridden) value from the source system, for the "original" snapshot */
  originalValue?: string | number;
  /** How to format the value for display. 'number' | 'currency' | 'percent' | 'text' */
  format?: 'number' | 'currency' | 'percent' | 'text';
  /** Optional: is this value currently overridden? Shows the blue dot if true */
  isOverridden?: boolean;
  /** Optional: who edited + when, for tooltip */
  overrideInfo?: { editedBy: string; editedAt: string; reason?: string };
  /** Callback fired after a successful save, so parent can refresh data */
  onSaved?: () => void;
  /** Optional CSS class for the wrapper */
  className?: string;
}

export default function EditableValue({
  value,
  tableName,
  rowId,
  field,
  originalValue,
  format = 'text',
  isOverridden = false,
  overrideInfo,
  onSaved,
  className = '',
}: EditableValueProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(String(value));
    setReason('');
    setEditing(true);
  }, [value]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(String(value));
    setReason('');
  }, [value]);

  const save = useCallback(async () => {
    if (saving) return;
    const parsed = format === 'number' || format === 'currency' || format === 'percent'
      ? Number(draft)
      : draft;
    if (parsed === value) { cancel(); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table_name: tableName,
          row_id: rowId,
          field,
          original: originalValue ?? value,
          corrected: parsed,
          reason: reason || undefined,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setEditing(false);
      onSaved?.();
    } catch (err) {
      console.error('[EditableValue] save failed:', err);
      alert('Failed to save override. Check console.');
    } finally {
      setSaving(false);
    }
  }, [draft, value, format, tableName, rowId, field, originalValue, reason, saving, cancel, onSaved]);

  const revert = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Revert to original source value?')) return;
    try {
      const res = await fetch(
        `/api/overrides?table=${tableName}&row_id=${rowId}&field=${field}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Delete failed');
      onSaved?.();
    } catch (err) {
      console.error('[EditableValue] revert failed:', err);
      alert('Failed to revert override. Check console.');
    }
  }, [tableName, rowId, field, onSaved]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  };

  // ----- Render: editing mode -----
  if (editing) {
    return (
      <div className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          type={format === 'text' ? 'text' : 'number'}
          step={format === 'currency' ? '0.01' : format === 'percent' ? '0.1' : '1'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-20 px-1.5 py-0.5 bg-gray-700 border border-blue-500 rounded text-xs text-white outline-none"
        />
        <input
          type="text"
          placeholder="reason (optional)"
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-24 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-gray-300 outline-none placeholder-gray-500"
        />
        <button
          onClick={save}
          disabled={saving}
          className="p-0.5 hover:bg-emerald-900/40 rounded text-emerald-400"
          title="Save"
        >
          <Check size={12} />
        </button>
        <button onClick={cancel} className="p-0.5 hover:bg-gray-700 rounded text-gray-400" title="Cancel">
          <X size={12} />
        </button>
      </div>
    );
  }

  // ----- Render: display mode -----
  const tooltipText = isOverridden && overrideInfo
    ? `Edited by ${overrideInfo.editedBy} on ${new Date(overrideInfo.editedAt).toLocaleDateString()}${overrideInfo.reason ? ` — "${overrideInfo.reason}"` : ''}`
    : undefined;

  return (
    <span
      className={`inline-flex items-center gap-1 group relative ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={tooltipText}
    >
      {/* Blue dot for overridden values */}
      {isOverridden && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
      )}

      <span>{typeof value === 'number' ? formatDisplay(value, format) : value}</span>

      {/* Pencil icon on hover */}
      {hovered && (
        <button
          onClick={startEdit}
          className="p-0.5 hover:bg-gray-700 rounded text-gray-500 hover:text-blue-400 transition-colors"
          title="Edit value"
        >
          <Pencil size={11} />
        </button>
      )}

      {/* Revert icon for overridden values on hover */}
      {hovered && isOverridden && (
        <button
          onClick={revert}
          className="p-0.5 hover:bg-gray-700 rounded text-gray-500 hover:text-orange-400 transition-colors"
          title="Revert to original"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </span>
  );
}

function formatDisplay(v: number, format: string): string {
  switch (format) {
    case 'currency':
      return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    case 'percent':
      return `${v.toFixed(1)}%`;
    case 'number':
      return v.toLocaleString();
    default:
      return String(v);
  }
}
