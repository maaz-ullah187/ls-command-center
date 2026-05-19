'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';

// Live integration health banner. Pings /api/integrations/status on mount
// and every 60s afterwards. Only renders when something is configured but
// broken — if everything is healthy OR nothing is wired up, the banner
// stays hidden so it doesn't waste screen space.
//
// Placement: directly under the Daily Review Queue in Dashboard.tsx so any
// broken API surfaces in the first screenful.

type IntegrationStatus =
  | { configured: false; ok: false }
  | { configured: true; ok: true }
  | { configured: true; ok: false; message: string; fixUrl?: string };

type StatusResponse = Record<string, IntegrationStatus>;

const LABELS: Record<string, string> = {
  meta: 'Meta Ads',
  ghl: 'GoHighLevel',
  youtube: 'YouTube',
  typeform: 'Typeform',
  calendly: 'Calendly',
  instagram: 'Instagram',
  twitter: 'X / Twitter',
  linkedin: 'LinkedIn',
  grain: 'Grain',
  whop: 'Whop',
  fanbasis: 'Fanbasis',
  hyros: 'Hyros',
  googleSheets: 'Google Sheets',
};

export default function IntegrationHealthBanner() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/status', { cache: 'no-store' });
      if (res.ok) setStatus(await res.json());
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!status) return null;

  // Collect only the integrations that are configured AND broken. Healthy
  // + unconfigured integrations don't need to surface.
  const broken = Object.entries(status).filter(
    ([, s]) => s.configured && !s.ok,
  ) as Array<[string, { configured: true; ok: false; message: string; fixUrl?: string }]>;

  if (broken.length === 0) return null;

  return (
    <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <h3 className="text-sm font-semibold text-red-200">
                {broken.length === 1
                  ? '1 integration is broken'
                  : `${broken.length} integrations are broken`}
              </h3>
              <p className="text-xs text-red-300/80">
                Dashboard is falling back to cached or mock data for these sources. Fix them to restore live numbers.
              </p>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="shrink-0 flex items-center gap-1.5 text-xs text-red-200 hover:text-white bg-red-900/50 hover:bg-red-800/60 px-2.5 py-1.5 rounded border border-red-500/40 disabled:opacity-50"
              title="Re-check integration status now"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Recheck
            </button>
          </div>
          <ul className="mt-3 space-y-2">
            {broken.map(([key, s]) => (
              <li
                key={key}
                className="flex items-center justify-between gap-3 bg-red-900/30 border border-red-500/30 rounded px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-red-100">
                    {LABELS[key] ?? key}
                  </div>
                  <div className="text-[11px] text-red-300/80 truncate" title={s.message}>
                    {s.message}
                  </div>
                </div>
                {s.fixUrl && (
                  <a
                    href={s.fixUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 flex items-center gap-1 text-[11px] text-red-200 hover:text-white bg-red-800/60 hover:bg-red-700/70 px-2 py-1 rounded border border-red-500/40"
                  >
                    Fix
                    <ExternalLink size={10} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
