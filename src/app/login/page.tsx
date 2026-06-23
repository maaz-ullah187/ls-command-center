'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2 } from 'lucide-react';

/**
 * /login — single-field password page. the operator 2026-04-30: didn't want
 * the Basic Auth username field, so we replaced the browser-native
 * dialog with this dedicated page. POSTs to /api/auth/login which
 * sets a signed cookie on success, then redirects back to the
 * original destination (or `/`).
 */
function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/';
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Wrong password');
        setSubmitting(false);
        return;
      }
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError('Network error');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#0a0c0f]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-600/20 border border-blue-700/40 mb-3">
            <Lock size={20} className="text-blue-300" />
          </div>
          <h1 className="text-white font-bold text-xl tracking-tight">PPS Dashboard</h1>
          <p className="text-xs text-gray-400 mt-1">Enter the dashboard password to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#1a1d23] border border-gray-800 rounded-xl p-5 space-y-3">
          <input
            type="password"
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-black/30 border border-gray-700 rounded-md px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
            disabled={submitting}
          />
          {error && (
            <div className="text-xs text-rose-300 bg-rose-900/20 border border-rose-800/40 rounded px-2.5 py-1.5">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-md py-2.5 transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Log in
          </button>
        </form>
        <p className="text-[10px] text-gray-600 text-center mt-4">Session lasts 30 days on this browser.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0c0f]" />}>
      <LoginInner />
    </Suspense>
  );
}
