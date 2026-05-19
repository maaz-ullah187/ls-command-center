'use client';

import { useState, useRef, useEffect, useLayoutEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  align?: 'left' | 'right';
  disabled?: boolean;
}

/**
 * Sleek custom dropdown that replaces native <select>.
 * Dark-themed, smooth animations, keyboard-friendly.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  size = 'sm',
  className = '',
  align = 'left',
  disabled = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Fixed-position coordinates so the menu portals out of any scrolling /
  // overflow-hidden ancestor (e.g. the Daily Review Queue table). Without
  // this the menu was clipped behind the panel and the user could barely
  // see the source options.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; placement: 'down' | 'up' } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const compute = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const menuHeight = menuRef.current?.offsetHeight ?? 256;
      const spaceBelow = window.innerHeight - rect.bottom;
      const placement: 'down' | 'up' = spaceBelow < menuHeight + 12 && rect.top > spaceBelow ? 'up' : 'down';
      setMenuPos({
        top: placement === 'down' ? rect.bottom + 4 : rect.top - menuHeight - 4,
        left: align === 'right' ? rect.right - Math.max(rect.width, 160) : rect.left,
        width: Math.max(rect.width, 160),
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
  }, [open, align]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
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

  const sizeClasses = {
    xs: 'px-2 py-1 text-[11px]',
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3 py-2 text-sm',
  }[size];

  const iconSize = size === 'xs' ? 10 : size === 'sm' ? 12 : 14;

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center justify-between gap-2 w-full bg-gray-800 border border-gray-600 hover:border-gray-500 rounded-lg ${sizeClasses} text-gray-200 transition-colors focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {selected?.icon}
          <span className={selected ? 'text-white' : 'text-gray-500'}>
            {selected?.label || placeholder}
          </span>
        </span>
        <ChevronDown
          size={iconSize}
          className={`text-gray-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
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
          className="bg-[#1a1d23] border border-gray-700 rounded-lg shadow-2xl overflow-hidden"
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-2 ${sizeClasses} transition-colors ${
                    active
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {opt.icon}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {active && <Check size={iconSize} className="text-blue-400 shrink-0" />}
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
