'use client';

/**
 * /expenses — Mercury expense tracker view.
 *
 * the operator 2026-05-01: previously used `useDashboardData()` which
 * Promise.all's 10 fetches — if any hung, the whole page sat on
 * "Loading…". Now fetches only what this page actually needs
 * (expenses + leads-for-cash) independently, so the table renders
 * the moment the expenses query returns.
 */

import { useEffect, useMemo, useState } from 'react';
import ExpensesPnLTab from '@/components/ExpensesPnLTab';
import type { Lead, Expense, Client } from '@/lib/types';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Fetch expenses — this is what the page actually needs to render.
    // Use a 15s timeout so a slow endpoint can't hang the page.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    fetch('/api/data/expenses', { signal: ctl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setExpenses(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? 'failed to load expenses');
      })
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });

    // Fetch leads in the background for the front-end-cash calculation.
    // Failing here doesn't block the page — frontEndCash falls back to 0.
    fetch('/api/data/leads', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setLeads(Array.isArray(data) ? data : []);
      })
      .catch(() => {/* ignore — non-blocking */});

    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, []);

  const frontEndCash = useMemo(
    () => leads.reduce((sum, l) => sum + (l.cashCollected ?? 0), 0),
    [leads]
  );

  // Clients aren't sourced anywhere in this page — keep empty array.
  const clients: Client[] = [];

  if (loading) {
    return (
      <div className="px-6 py-6">
        <div className="text-gray-400 text-sm">Loading expenses…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-6">
        <div className="text-rose-300 text-sm">Error loading expenses: {error}</div>
      </div>
    );
  }

  return (
    <div className="px-6 py-6">
      <ExpensesPnLTab frontEndCash={frontEndCash} clients={clients} expenses={expenses} />
    </div>
  );
}
