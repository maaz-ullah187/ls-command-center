'use client';

import { Globe, Users, Presentation, HelpCircle, Sparkles } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

/**
 * Brand-icon + brand-color pill for the Sales Funnel by Source table.
 *
 * IMPORTANT: lucide-react does NOT ship brand logos (Youtube / Facebook /
 * Instagram / LinkedIn / X / Twitter) — they're trademarked. We inline the
 * canonical SVG glyphs ourselves and reuse lucide for the generic icons
 * (organic / referral / webinar / upsell / unknown).
 */

type IconProps = { size?: number; color?: string };
type IconLike = ComponentType<IconProps> | ComponentType<SVGProps<SVGSVGElement>>;

interface SourceStyle {
  Icon: IconLike;
  color: string;
  /** Display label override (handles casing inconsistencies in source data). */
  label?: string;
}

// ---- Brand SVG glyphs (inline, lowercase color = currentColor doesn't work
// because we want flat brand fills). Each takes { size, color } props.
const YoutubeIcon = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const FacebookIcon = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const InstagramIcon = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
  </svg>
);

const LinkedinIcon = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
);

const XIcon = ({ size = 14, color = 'currentColor' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M18.244 2H21.5l-7.594 8.677L23 22h-7.094l-5.564-7.27L3.9 22H.64l8.121-9.276L1 2h7.27l5.03 6.65L18.244 2z" />
  </svg>
);

/**
 * Maps a normalized source key to its brand icon + color.
 * Match is case-insensitive, partial substring match (e.g. "Facebook Ads"
 * matches the "facebook" entry). Order matters — first match wins.
 */
const SOURCE_RULES: Array<{ keys: string[]; style: SourceStyle }> = [
  { keys: ['youtube', 'yt '], style: { Icon: YoutubeIcon, color: '#ff0000' } },
  { keys: ['facebook', 'meta', 'fb ads', 'fb-'], style: { Icon: FacebookIcon, color: '#1877f2', label: 'Facebook Ads' } },
  { keys: ['instagram', 'ig '], style: { Icon: InstagramIcon, color: '#e1306c' } },
  { keys: ['linkedin', 'li '], style: { Icon: LinkedinIcon, color: '#0a66c2' } },
  { keys: ['twitter', ' x ', 'x.com', 'x/', '/x'], style: { Icon: XIcon, color: '#e7e9ea' } },
  { keys: ['webinar'], style: { Icon: Presentation, color: '#34d399' } },
  { keys: ['referral', 'referred'], style: { Icon: Users, color: '#a78bfa' } },
  { keys: ['organic', 'word of mouth'], style: { Icon: Globe, color: '#10b981' } },
  { keys: ['upsell', 'program a', 'program a'], style: { Icon: Sparkles, color: '#60a5fa' } },
];

const FALLBACK: SourceStyle = { Icon: HelpCircle, color: '#6b7280' };

function exactMatch(source: string): SourceStyle | null {
  const key = source.trim().toLowerCase();
  if (key === 'x') return { Icon: XIcon, color: '#e7e9ea' };
  if (key === 'unknown' || key === '') return FALLBACK;
  return null;
}

export function getSourceStyle(source: string): SourceStyle {
  const exact = exactMatch(source);
  if (exact) return exact;
  const lower = source.toLowerCase();
  for (const rule of SOURCE_RULES) {
    if (rule.keys.some((k) => lower.includes(k.trim()))) return rule.style;
  }
  return FALLBACK;
}

interface Props {
  source: string;
  showLabel?: boolean;
  size?: number;
}

export default function SourceBadge({ source, showLabel = true, size = 14 }: Props) {
  const { Icon, color, label } = getSourceStyle(source);
  const display = label ?? source;
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-md flex-shrink-0"
        style={{
          backgroundColor: `${color}1f`,
          boxShadow: `inset 0 0 0 1px ${color}40`,
        }}
        aria-hidden
      >
        {/* @ts-expect-error — IconLike is a union of lucide and our inline SVG components */}
        <Icon size={size} color={color} />
      </span>
      {showLabel && (
        <span className="text-white font-medium truncate" title={display}>
          {display}
        </span>
      )}
    </span>
  );
}
