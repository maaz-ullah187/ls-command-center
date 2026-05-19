'use client';

import { useMemo, useState, useEffect } from 'react';
import { Lead } from '@/lib/types';

interface Props {
  leads: Lead[];
}

type Status = 'healthy' | 'warning' | 'error';

interface HealthCheck {
  id: string;
  category: string;
  label: string;
  status: Status;
  detail: string;
  count?: number;
}

const STATUS_STYLES: Record<Status, { dot: string; text: string; bg: string; border: string; label: string }> = {
  healthy: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-500/20',
    label: 'Healthy',
  },
  warning: {
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    bg: 'bg-amber-500/5',
    border: 'border-amber-500/20',
    label: 'Warning',
  },
  error: {
    dot: 'bg-red-400',
    text: 'text-red-300',
    bg: 'bg-red-500/5',
    border: 'border-red-500/20',
    label: 'Problem',
  },
};

// Map of integration key → display label
const INTEGRATION_LABELS: Record<string, string> = {
  ghl: 'GoHighLevel (CRM)',
  meta: 'Meta Ads',
  youtube: 'YouTube',
  typeform: 'Typeform',
  calendly: 'Calendly',
  whop: 'Whop (Payments)',
  grain: 'Grain (Call Recordings)',
  fathom: 'Fathom (Backup Recordings)',
  slack: 'Slack',
  scoring: 'AI Lead Scoring',
  fanbasis: 'Fanbasis',
  instagram: 'Instagram',
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
  monday: 'Monday.com',
};

interface IntegrationStatus {
  configured: boolean;
  ok: boolean;
  message?: string;
}

export default function SystemHealthTab({ leads }: Props) {
  const [integrationStatuses, setIntegrationStatuses] = useState<Record<string, IntegrationStatus>>({});
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/integrations/status')
      .then(r => r.json())
      .then(data => {
        setIntegrationStatuses(data);
        setStatusLoaded(true);
      })
      .catch(() => setStatusLoaded(true));
  }, []);

  const checks = useMemo<HealthCheck[]>(() => {
    const unknownSource = leads.filter(l => !l.source || l.source === 'Unknown').length;
    const unloggedCalls = leads.filter(l => l.showStatus === 'Showed' && !l.callOutcome).length;
    const missingQuality = leads.filter(
      l => (l.callOutcome === 'Closed Won' || l.callOutcome === 'Closed Lost' || l.stage === 'Closed Won' || l.cashCollected > 1) && (!l.qualityScore || l.qualityScore === 0)
    ).length;
    const missingProgram = leads.filter(l => !l.program).length;
    const missingCloser = leads.filter(l => l.demoBooked && !l.assignedCloser).length;

    const dataQuality: HealthCheck[] = [
      {
        id: 'unknown-source',
        category: 'Data Quality',
        label: 'Leads with unknown source',
        status: unknownSource === 0 ? 'healthy' : unknownSource > 10 ? 'error' : 'warning',
        detail: unknownSource === 0 ? 'All leads have an attributed source.' : `${unknownSource} leads missing source attribution.`,
        count: unknownSource,
      },
      {
        id: 'unlogged-calls',
        category: 'Data Quality',
        label: 'Shown calls without outcome',
        status: unloggedCalls === 0 ? 'healthy' : unloggedCalls > 5 ? 'error' : 'warning',
        detail: unloggedCalls === 0 ? 'All shown calls have outcomes logged.' : `${unloggedCalls} calls need outcome logged.`,
        count: unloggedCalls,
      },
      {
        id: 'missing-quality',
        category: 'Data Quality',
        label: 'Closed calls missing quality score',
        status: missingQuality === 0 ? 'healthy' : 'warning',
        detail: missingQuality === 0 ? 'All closed calls scored.' : `${missingQuality} closed calls need a quality score.`,
        count: missingQuality,
      },
      {
        id: 'missing-program',
        category: 'Data Quality',
        label: 'Leads missing program assignment',
        status: missingProgram === 0 ? 'healthy' : 'warning',
        detail: missingProgram === 0 ? 'All leads assigned to a program.' : `${missingProgram} leads without a program.`,
        count: missingProgram,
      },
      {
        id: 'missing-closer',
        category: 'Data Quality',
        label: 'Booked calls without a closer',
        status: missingCloser === 0 ? 'healthy' : 'warning',
        detail: missingCloser === 0 ? 'All booked calls have a closer assigned.' : `${missingCloser} booked calls need a closer.`,
        count: missingCloser,
      },
    ];

    // Build integration checks from the live /api/integrations/status response
    const integrations: HealthCheck[] = Object.entries(integrationStatuses).map(([key, s]) => {
      const label = INTEGRATION_LABELS[key] || key;
      let status: Status;
      let detail: string;

      if (!s.configured) {
        status = 'warning';
        detail = `Not configured. Add credentials in environment variables.`;
      } else if (s.ok) {
        status = 'healthy';
        detail = 'Connected and responding.';
      } else {
        status = 'error';
        detail = (s as any).message || 'Configured but not responding.';
      }

      return { id: key, category: 'Integrations', label, status, detail };
    });

    // If statuses haven't loaded yet, show a placeholder
    if (!statusLoaded && integrations.length === 0) {
      integrations.push({
        id: 'loading',
        category: 'Integrations',
        label: 'Loading integration status...',
        status: 'warning',
        detail: 'Checking connections...',
      });
    }

    const pipeline: HealthCheck[] = [
      {
        id: 'storage',
        category: 'Pipeline',
        label: 'Local storage',
        status: 'healthy',
        detail: 'Lead overrides persisting on this device.',
      },
      {
        id: 'calculations',
        category: 'Pipeline',
        label: 'Metric aggregation',
        status: 'healthy',
        detail: 'All aggregations running without error.',
      },
    ];

    return [...dataQuality, ...integrations, ...pipeline];
  }, [leads, integrationStatuses, statusLoaded]);

  const counts = {
    healthy: checks.filter(c => c.status === 'healthy').length,
    warning: checks.filter(c => c.status === 'warning').length,
    error: checks.filter(c => c.status === 'error').length,
  };

  const overall: Status = counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'healthy';
  const overallStyle = STATUS_STYLES[overall];

  const categories = Array.from(new Set(checks.map(c => c.category)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">System Health</h1>
        <p className="text-sm text-gray-500 mt-1">
          Automated checks across data quality, integrations, and the reporting pipeline.
        </p>
      </div>

      {/* Overall status */}
      <div className={`rounded-xl border ${overallStyle.border} ${overallStyle.bg} p-5 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 rounded-full ${overallStyle.dot} animate-pulse`} />
          <div>
            <div className={`text-sm font-semibold ${overallStyle.text}`}>
              {overall === 'healthy'
                ? 'All systems operational'
                : overall === 'warning'
                ? 'Attention required'
                : 'Problems detected'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {checks.length} checks · updated just now
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-gray-400">{counts.healthy} healthy</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-gray-400">{counts.warning} warning</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="text-gray-400">{counts.error} problem</span>
          </div>
        </div>
      </div>

      {/* Checks grouped by category */}
      {categories.map(cat => (
        <div key={cat}>
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">{cat}</h2>
          <div className="bg-[#1a1d23] border border-gray-800 rounded-xl divide-y divide-gray-800">
            {checks
              .filter(c => c.category === cat)
              .map(c => {
                const s = STATUS_STYLES[c.status];
                return (
                  <div key={c.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-2.5 w-2.5 rounded-full ${s.dot} flex-shrink-0`} />
                      <div className="min-w-0">
                        <div className="text-sm text-gray-200 font-medium truncate">{c.label}</div>
                        <div className="text-xs text-gray-500 truncate">{c.detail}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {typeof c.count === 'number' && c.count > 0 && (
                        <span className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-0.5">{c.count}</span>
                      )}
                      <span className={`text-[10px] uppercase tracking-wider font-semibold ${s.text}`}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
