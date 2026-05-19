'use client';

import { ReactNode } from 'react';
import CardFeedbackMenu from './CardFeedbackMenu';

interface CardShellProps {
  title: string;
  subtitle?: string;
  apiRef?: string;
  /**
   * Stable card identifier used by the per-card feedback popover.
   * e.g. "main:revenue-composition". Required so feedback rows can be
   * grouped per card. If omitted, the kebab is hidden.
   */
  cardId?: string;
  /**
   * Optional content rendered in the card header next to the kebab —
   * e.g. a per-card timeframe selector when the card has its own
   * filter independent of the global one.
   */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/**
 * Standard card frame used by the Main Dashboard sections so they share the
 * same heading + border + spacing. Hover reveals the three-dot kebab in the
 * top-right corner; click opens the "Send to Claude" feedback popover.
 */
export default function CardShell({ title, subtitle, apiRef, cardId, headerExtra, children }: CardShellProps) {
  return (
    <div className="group bg-[#1a1d23] border border-gray-800 rounded-xl overflow-visible">
      <div className="px-5 py-4 border-b border-gray-800 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {/* the operator 2026-05-02: bumped headlines text-base → text-lg
              so card titles read more like proper section headers. */}
          <h3 className="text-white font-bold text-lg tracking-tight truncate">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400 mt-1 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {headerExtra}
          {apiRef && <span className="text-[10px] text-gray-600 font-mono hidden md:inline">{apiRef}</span>}
          {cardId && <CardFeedbackMenu cardId={cardId} />}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
