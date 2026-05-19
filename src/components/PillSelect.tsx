'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

/**
 * Shared "gold standard" dropdown — colored pill trigger with a dot,
 * floating menu in a portal so it never gets clipped.
 *
 * Lifted from BillingTracker.tsx's inline CustomDropdown so it can be
 * reused across CRMTab, ExpensesTab, BillingTracker (modal + cells), etc.
 */

export interface PillSelectOption {
  value: string;
  label: string;
  /** colorMap key. Defaults to 'gray'. */
  color?: string;
}

export const PILL_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-400',   dot: 'bg-amber-400' },
  red:     { bg: 'bg-red-500/15',     text: 'text-red-400',     dot: 'bg-red-400' },
  purple:  { bg: 'bg-purple-500/15',  text: 'text-purple-400',  dot: 'bg-purple-400' },
  blue:    { bg: 'bg-blue-500/15',    text: 'text-blue-400',    dot: 'bg-blue-400' },
  cyan:    { bg: 'bg-cyan-500/15',    text: 'text-cyan-400',    dot: 'bg-cyan-400' },
  violet:  { bg: 'bg-violet-500/15',  text: 'text-violet-400',  dot: 'bg-violet-400' },
  orange:  { bg: 'bg-orange-500/15',  text: 'text-orange-400',  dot: 'bg-orange-400' },
  sky:     { bg: 'bg-sky-500/15',     text: 'text-sky-400',     dot: 'bg-sky-400' },
  pink:    { bg: 'bg-pink-500/15',    text: 'text-pink-400',    dot: 'bg-pink-400' },
  gray:    { bg: 'bg-gray-500/15',    text: 'text-gray-400',    dot: 'bg-gray-400' },
};

interface PillSelectProps {
  value: string;
  options: PillSelectOption[];
  onChange: (val: string) => void;
  placeholder?: string;
  /** Adds a "clear" item at the top of the menu that emits ''. */
  allowClear?: boolean;
  clearLabel?: string;
  /** Cap the trigger label width in px. Default 130. */
  maxLabelWidth?: number;
  /** Min menu width in px. Default 170. */
  minMenuWidth?: number;
  /** Align menu to the right edge of the trigger. */
  align?: 'left' | 'right';
  className?: string;
  disabled?: boolean;
}

export default function PillSelect({
  value,
  options,
  onChange,
  placeholder = '--',
  allowClear = false,
  clearLabel = 'None',
  maxLabelWidth = 130,
  minMenuWidth = 170,
  align = 'left',
  className = '',
  disabled = false,
}: PillSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    placement: 'down' | 'up';
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const compute = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 256;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placement: 'down' | 'up' =
        spaceBelow < menuHeight + 12 && rect.top > spaceBelow ? 'up' : 'down';
      const width = Math.max(rect.width, minMenuWidth);
      setMenuPos({
        top: placement === 'down' ? rect.bottom + 4 : rect.top - menuHeight - 4,
        left: align === 'right' ? rect.right - width : rect.left,
        width,
        placement,
      });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [open, align, minMenuWidth]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const triggerColors = selected
    ? PILL_COLORS[selected.color ?? 'gray'] || PILL_COLORS.gray
    : PILL_COLORS.gray;

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          selected
            ? `${triggerColors.bg} ${triggerColors.text} border-transparent`
            : 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-500'
        }`}
      >
        {selected && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${triggerColors.dot}`} />
        )}
        <span className="truncate" style={{ maxWidth: maxLabelWidth }}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown
          size={10}
          className={`flex-shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && mounted && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            minWidth: menuPos.width,
            zIndex: 9999,
          }}
          className="bg-[#111827] border border-[#1e293b] rounded-lg shadow-xl shadow-black/40 py-1 overflow-hidden"
        >
          <div className="max-h-64 overflow-y-auto">
            {allowClear && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-800/50 transition-colors cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600 flex-shrink-0" />
                <span>{clearLabel}</span>
                {!value && <Check size={10} className="ml-auto text-gray-500" />}
              </button>
            )}
            {options.map((opt) => {
              const c = PILL_COLORS[opt.color ?? 'gray'] || PILL_COLORS.gray;
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                    isSelected ? `${c.bg} ${c.text}` : 'text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check size={10} className="ml-auto" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
