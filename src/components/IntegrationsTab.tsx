'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { checkIntegrationStatus } from '@/lib/integrations';
import { resetAllStorage } from '@/lib/storage/localStore';
import { RotateCcw, ExternalLink, Copy, Check } from 'lucide-react';
import PaymentLogImport from './PaymentLogImport';

interface Integration {
  key: string;
  name: string;
  description: string;
  icon: string;
}

const INTEGRATIONS: Integration[] = [
  {
    key: 'ghl',
    name: 'GoHighLevel',
    description: 'CRM contacts, pipeline deals, closer assignments',
    icon: 'GHL',
  },
  {
    key: 'typeform',
    name: 'Typeform',
    description: 'Lead capture form responses and qualification data',
    icon: 'TF',
  },
  {
    key: 'calendly',
    name: 'Calendly',
    description: 'Booked calls, scheduled events, show/no-show tracking',
    icon: 'CAL',
  },
  {
    key: 'youtube',
    name: 'YouTube',
    description: 'Video stats, thumbnails, per-video lead attribution',
    icon: 'YT',
  },
  {
    key: 'instagram',
    name: 'Instagram',
    description: 'DM conversations, content performance, engagement',
    icon: 'IG',
  },
  {
    key: 'twitter',
    name: 'Twitter / X',
    description: 'DM metrics, content performance',
    icon: 'X',
  },
  {
    key: 'linkedin',
    name: 'LinkedIn',
    description: 'Post performance, DM tracking',
    icon: 'LI',
  },
  {
    key: 'grain',
    name: 'Grain',
    description: 'Call recordings for closed deals',
    icon: 'GR',
  },
  {
    key: 'googleSheets',
    name: 'Google Sheets',
    description: 'P&L projections auto-import',
    icon: 'GS',
  },
];

const ICON_COLORS: Record<string, string> = {
  GHL: 'bg-orange-600',
  TF: 'bg-indigo-600',
  CAL: 'bg-blue-500',
  YT: 'bg-red-600',
  IG: 'bg-gradient-to-br from-purple-600 to-pink-500',
  X: 'bg-gray-700',
  LI: 'bg-blue-700',
  GR: 'bg-violet-600',
  '$': 'bg-purple-600',
  GS: 'bg-green-600',
};

export default function IntegrationsTab() {
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  const searchParams = useSearchParams();
  const linkedinToken = searchParams.get('linkedin_token');
  const linkedinExpiresIn = searchParams.get('linkedin_expires_in');
  const linkedinError = searchParams.get('linkedin_error');

  useEffect(() => {
    checkIntegrationStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  const connectedCount = Object.values(status).filter(Boolean).length;
  const totalCount = INTEGRATIONS.length;

  const handleReset = () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      // Auto-cancel the confirmation after 4s
      setTimeout(() => setResetConfirm(false), 4000);
      return;
    }
    resetAllStorage();
    // Hard reload so every component picks up fresh mock data
    window.location.reload();
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white mb-1">Integrations</h2>
        <p className="text-sm text-gray-400">
          {loading
            ? 'Checking integration status...'
            : `${connectedCount} of ${totalCount} integrations connected`}
        </p>
      </div>

      {/* LinkedIn OAuth token banner */}
      {linkedinToken && (
        <div className="mb-6 bg-emerald-950/40 border border-emerald-700/50 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-600 text-white text-xs font-bold shrink-0">
              LI
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-emerald-300 mb-1">LinkedIn Connected Successfully</h3>
              <p className="text-xs text-emerald-400/80 mb-3">
                Copy this access token and paste it as <code className="bg-black/30 px-1 py-0.5 rounded text-emerald-300">LINKEDIN_ACCESS_TOKEN</code> in your <code className="bg-black/30 px-1 py-0.5 rounded text-emerald-300">.env.local</code> file.
                {linkedinExpiresIn && (
                  <span className="ml-1">
                    Expires in {Math.round(Number(linkedinExpiresIn) / 86400)} days.
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <code className="block bg-black/40 border border-emerald-800/50 rounded-lg px-3 py-2 text-[11px] text-emerald-200 font-mono break-all max-w-xl">
                  {linkedinToken}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(linkedinToken);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 p-2 rounded-lg bg-emerald-800/40 border border-emerald-700/50 text-emerald-300 hover:bg-emerald-700/50 transition-colors"
                  title="Copy token"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LinkedIn OAuth error banner */}
      {linkedinError && (
        <div className="mb-6 bg-red-950/40 border border-red-700/50 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-red-600 text-white text-xs font-bold shrink-0">
              LI
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-300 mb-1">LinkedIn Connection Failed</h3>
              <p className="text-xs text-red-400/80">{linkedinError}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INTEGRATIONS.map((integration) => {
          const connected = status[integration.key] ?? false;
          const isLinkedIn = integration.key === 'linkedin';

          return (
            <div
              key={integration.key}
              className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5 flex items-start gap-4 hover:border-gray-600 transition-colors"
            >
              {/* Icon */}
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                  ICON_COLORS[integration.icon] || 'bg-gray-600'
                }`}
              >
                {integration.icon}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-sm font-semibold text-white">{integration.name}</h3>
                  {loading ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-700 text-gray-400">
                      Checking...
                    </span>
                  ) : connected ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-900/50 text-emerald-400 border border-emerald-700/50">
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-800 text-gray-500 border border-gray-700">
                      Not Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{integration.description}</p>
                {/* Connect LinkedIn button */}
                {isLinkedIn && !connected && !loading && (
                  <a
                    href="/api/linkedin/auth"
                    className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold hover:bg-blue-600 transition-colors"
                  >
                    <ExternalLink size={12} />
                    Connect LinkedIn
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Data Import Section */}
      <div className="mt-8 pt-6 border-t border-gray-800">
        <h2 className="text-lg font-bold text-white mb-1">Data Import</h2>
        <p className="text-sm text-gray-400 mb-4">
          Import data from external sources that don&apos;t have direct API integrations.
        </p>
        <PaymentLogImport />
      </div>

      {/* Local Data Reset */}
      <div className="mt-8 pt-6 border-t border-gray-800">
        <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-red-900/30 text-red-400 shrink-0">
            <RotateCcw size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white mb-1">Reset Local Data</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-3">
              Clears every closer, CSM, call outcome, and form edit saved to this browser.
              Reloads the dashboard back to the seeded mock data. Does not affect other users
              or any connected integration.
            </p>
            <button
              onClick={handleReset}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                resetConfirm
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-red-900/30 text-red-400 border border-red-700/50 hover:bg-red-900/50'
              }`}
            >
              <RotateCcw size={13} />
              {resetConfirm ? 'Click again to confirm' : 'Reset local data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
