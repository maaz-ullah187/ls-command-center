'use client';

/**
 * /billing/review — Payment Review Queue.
 *
 * Lists every Whop/Fanbasis payment in `pending_review` state. The operator
 * picks New Cash or Backend Revenue from the dropdown and clicks Authorise;
 * the row's payment_type is set and review_status flips to 'approved'. Once
 * approved, the dashboard's revenue cards start counting it.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Check, Trash2 } from 'lucide-react';

type Choice = 'new_cash' | 'backend_revenue';

interface QueueRow {
  id: string;
  date: string;
  name: string | null;
  email: string | null;
  amount: number | null;
  final_amount: number | null;
  processor: string;
  payment_type: string | null;
  status: string;
  offer: string | null;
}

const fmtUSD = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

export default function PaymentReviewPage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/billing/review-queue', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const authorise = useCallback(async (id: string) => {
    const choice = choices[id] ?? 'new_cash';
    setSavingId(id);
    try {
      const res = await fetch('/api/billing/review-queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, choice }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Authorise failed: ${err?.error ?? res.status}`);
        return;
      }
      // Optimistic: drop the row from the list locally.
      setRows((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setSavingId(null);
    }
  }, [choices]);

  const remove = useCallback(async (row: QueueRow) => {
    const label = row.name || row.email || row.id;
    const confirmed = window.confirm(
      `Delete this payment?\n\n${label} — ${fmtUSD(row.final_amount ?? row.amount)}\n\nThis permanently removes the row from t07_income_processors. Use Authorise instead if you just want to categorize it.`,
    );
    if (!confirmed) return;
    setDeletingId(row.id);
    try {
      const res = await fetch('/api/billing/review-queue', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Delete failed: ${err?.error ?? res.status}`);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Payment Review Queue</h1>
          <p className="text-xs text-gray-400 mt-1">
            Authorise each payment as <span className="text-emerald-300 font-medium">New Cash</span> or{' '}
            <span className="text-blue-300 font-medium">Backend Revenue</span>. Approved
            payments start flowing into the main-dashboard cards immediately.
          </p>
        </div>
        <div className="text-xs text-gray-400">
          {loading ? (
            <Loader2 size={14} className="inline animate-spin" />
          ) : (
            <>{rows.length} pending</>
          )}
        </div>
      </div>

      <div className="bg-[#1a1d23] rounded-xl border border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#15171c]">
            <tr className="text-gray-400 text-xs uppercase tracking-wider">
              <th className="text-left py-2 px-4 font-medium">Date</th>
              <th className="text-left py-2 px-3 font-medium">Name</th>
              <th className="text-right py-2 px-3 font-medium">Amount</th>
              <th className="text-left py-2 px-3 font-medium">Processor</th>
              <th className="text-left py-2 px-3 font-medium">Current Type</th>
              <th className="text-left py-2 px-3 font-medium">Authorise as</th>
              <th className="text-right py-2 px-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-500">
                  <Loader2 size={14} className="inline animate-spin mr-2" /> Loading queue…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-500">
                  All caught up — no payments waiting for review.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const choice = choices[r.id] ?? 'new_cash';
                const saving = savingId === r.id;
                return (
                  <tr key={r.id} className="border-t border-gray-800 hover:bg-[#15171c]">
                    <td className="py-2.5 px-4 text-gray-300 tabular-nums">{r.date}</td>
                    <td className="py-2.5 px-3 text-white">
                      <div className="font-medium">{r.name ?? '—'}</div>
                      {r.email && <div className="text-[11px] text-gray-500">{r.email}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right text-white tabular-nums">
                      {fmtUSD(r.final_amount ?? r.amount)}
                    </td>
                    <td className="py-2.5 px-3 text-gray-300 capitalize">{r.processor}</td>
                    <td className="py-2.5 px-3 text-gray-400 text-xs">{r.payment_type ?? '—'}</td>
                    <td className="py-2.5 px-3">
                      <select
                        value={choice}
                        onChange={(e) =>
                          setChoices((prev) => ({ ...prev, [r.id]: e.target.value as Choice }))
                        }
                        disabled={saving}
                        className="bg-[#0f1115] border border-gray-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500 disabled:opacity-50"
                      >
                        <option value="new_cash">New Cash</option>
                        <option value="backend_revenue">Backend Revenue</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => authorise(r.id)}
                          disabled={saving || deletingId === r.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600/40 hover:bg-emerald-600/60 border border-emerald-600/50 text-emerald-200 text-xs font-semibold disabled:opacity-50"
                        >
                          {saving ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          Authorise
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          disabled={saving || deletingId === r.id}
                          title="Permanently delete this payment"
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-red-600/30 hover:bg-red-600/50 border border-red-600/50 text-red-200 text-xs font-semibold disabled:opacity-50"
                        >
                          {deletingId === r.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
