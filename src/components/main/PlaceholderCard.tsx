'use client';

import { Sparkles } from 'lucide-react';
import CardShell from './CardShell';

interface PlaceholderCardProps {
  title: string;
  subtitle?: string;
  metabaseRef?: string;
  height?: 'sm' | 'md' | 'lg';
  /** Optional stable id so the kebab "Send to Claude" feedback popover works on placeholders too. */
  cardId?: string;
}

/**
 * Placeholder used by Phase 1 sections that are scaffolded but not yet wired
 * to live data. Now uses CardShell so the three-dot kebab feedback popover
 * is available on placeholder cards too — the operator can comment on what he
 * wants in here while the data wiring is still in flight.
 */
export default function PlaceholderCard({
  title,
  subtitle,
  metabaseRef,
  height = 'md',
  cardId,
}: PlaceholderCardProps) {
  const h = height === 'sm' ? 'h-32' : height === 'lg' ? 'h-72' : 'h-48';

  return (
    <CardShell title={title} subtitle={subtitle} apiRef={metabaseRef} cardId={cardId}>
      <div className={`flex items-center justify-center ${h} text-gray-600`}>
        <div className="flex items-center gap-2 text-xs">
          <Sparkles size={14} className="text-blue-500/40" />
          <span>Scaffolded — wiring in next sub-phase</span>
        </div>
      </div>
    </CardShell>
  );
}
