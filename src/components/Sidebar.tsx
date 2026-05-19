'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Sun,
  CalendarDays,
  CalendarRange,
  UsersRound,
  PhoneIncoming,
  CreditCard,
  Receipt,
  Plug,
  HeartPulse,
  Crosshair,
  Database,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';

/**
 * Sidebar — the operator 2026-05-01 SaaS-style refresh:
 *   • Lucide icons (animated colour + scale on hover) replace unicode emoji
 *   • Collapsible group headers (chevron rotates 90° when expanded)
 *   • Persisted collapsed state in localStorage so the layout sticks
 *   • Bigger / bolder dashboard names (text-sm font-semibold) and louder
 *     group labels (uppercase tracking-wider)
 *   • Active item: filled rounded pill with the item's accent colour on
 *     the icon (was a thin left border before)
 */

interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  /** Tailwind text-color class applied when this item is active (and on hover) */
  accent: string;
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Pacing',
    items: [
      { label: 'Main Dashboard', href: '/',      Icon: BarChart3,     accent: 'text-blue-400',    exact: true },
      { label: 'Today',          href: '/today', Icon: Sun,           accent: 'text-amber-400' },
      { label: 'Week',           href: '/week',  Icon: CalendarDays,  accent: 'text-emerald-400' },
      { label: 'Month',          href: '/month', Icon: CalendarRange, accent: 'text-purple-400' },
    ],
  },
  {
    label: 'Data & Mirrors',
    items: [
      { label: 'Leads & CRM',         href: '/crm',         Icon: UsersRound,    accent: 'text-violet-400' },
      { label: 'Sales Calls',         href: '/sales-calls', Icon: PhoneIncoming, accent: 'text-cyan-400' },
      { label: 'Billing & Payments',  href: '/billing',     Icon: CreditCard,    accent: 'text-emerald-400' },
      { label: 'Expenses',            href: '/expenses',    Icon: Receipt,       accent: 'text-rose-400' },
    ],
  },
  {
    label: 'Other',
    items: [
      { label: 'Integrations',     href: '/integrations',     Icon: Plug,       accent: 'text-orange-400' },
      { label: 'System Health',    href: '/system-health',    Icon: HeartPulse, accent: 'text-rose-400' },
      { label: 'Competitors',      href: '/competitors',      Icon: Crosshair,  accent: 'text-yellow-400' },
      { label: 'Legacy Dashboard', href: '/dashboard-legacy', Icon: Database,   accent: 'text-gray-400' },
    ],
  },
];

const COLLAPSE_KEY = 'ls-cmd:sidebar-collapsed';

export default function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();
  const queryString = qs ? `?${qs}` : '';

  // Persisted collapsed-group state. Initialise from localStorage AFTER
  // mount so SSR markup matches client (avoids hydration mismatch).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw)));
    } catch { /* ignore — defaults to empty (all expanded) */ }
  }, []);
  const toggleGroup = (label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  return (
    <aside className="w-60 shrink-0 bg-gradient-to-b from-[#0d0f12] via-[#0c0e11] to-[#0a0c10] border-r border-gray-800/80 flex flex-col">
      {/* Brand block */}
      <div className="px-5 py-5 border-b border-gray-800/80">
        <div className="text-white font-bold text-base tracking-tight">LS Command Center</div>
        <div className="text-[10px] text-gray-500 mt-1 uppercase tracking-[0.12em] font-semibold">
          Performance Dashboard
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {GROUPS.map((group) => {
          const isCollapsed = collapsed.has(group.label);
          return (
            <div key={group.label} className="mb-3">
              {/* Group header — clickable to collapse/expand */}
              <button
                onClick={() => toggleGroup(group.label)}
                className="w-full px-3 py-2 flex items-center justify-between text-xs uppercase tracking-[0.16em] text-gray-300 hover:text-white font-bold transition-colors"
              >
                <span>{group.label}</span>
                <ChevronRight
                  size={13}
                  className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                />
              </button>

              {/* Items — height collapses smoothly */}
              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
                  isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100'
                }`}
              >
                {group.items.map((item) => {
                  const active = isActive(item);
                  const Icon = item.Icon;
                  return (
                    <Link
                      key={item.href}
                      href={`${item.href}${queryString}`}
                      className={`group flex items-center gap-3 px-3 py-2 mx-1 my-0.5 rounded-lg text-sm font-semibold transition-all duration-150 ${
                        active
                          ? 'bg-blue-600/15 text-white shadow-sm ring-1 ring-blue-500/20'
                          : 'text-gray-400 hover:text-white hover:bg-gray-800/40'
                      }`}
                    >
                      <Icon
                        size={16}
                        className={`flex-shrink-0 transition-all duration-150 ${
                          active
                            ? item.accent
                            : `text-gray-500 group-hover:${item.accent.replace('text-', 'text-')} group-hover:scale-110`
                        }`}
                      />
                      <span className="tracking-tight">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-800/80 text-[10px] text-gray-600 tracking-wider uppercase font-semibold">
        v0.3
      </div>
    </aside>
  );
}
