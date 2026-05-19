// Sync worker: t08_expenses table
// Source: Mercury Banking API (configured checking account) → t08_expenses
// Schedule: daily 08:00 UTC (≈ 4 AM ET) via Vercel Cron
// Pulls last 90 days of outgoing transactions and upserts on transaction id,
// so history is always complete and late-posting transactions backfill cleanly.
//
// Categorization lives in `src/lib/mappers/mercury.ts#categorizeExpense`.
// 6 buckets: labour / marketing / overhead / mastermind / other / unknown.
// Unrecognized counterparties fall back to `unknown` for human review.
// Card attribution (card_name + card_last_four) is attached to debit-card rows.

import { NextResponse } from 'next/server';
import { runSync } from '@/lib/sync/runner';

export const maxDuration = 60;

export async function POST() {
  const result = await runSync('expenses', async (sb) => {
    const mercuryKey = process.env.MERCURY_API_KEY;
    if (!mercuryKey) throw new Error('MERCURY_API_KEY not set');

    const { fetchMercuryExpenses } = await import('@/lib/mappers/mercury');

    // 90-day rolling window — covers a full quarter and re-anchors history
    // every run so any late-posted or edited transactions self-heal.
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
    const startDate = ninetyDaysAgo.toISOString().slice(0, 10);
    const endDate = now.toISOString().slice(0, 10);

    const summary = await fetchMercuryExpenses(mercuryKey, startDate, endDate);

    if (summary.transactions.length === 0) {
      return { rowsUpserted: 0, rowsSkipped: 0 };
    }

    // Pre-fetch the vendor categorization memory (learned from manual queue
    // categorizations) so we can override the mapper's default category when
    // we've already learned what bucket this vendor belongs to.
    const { normaliseVendor } = await import('@/lib/vendorMemory');
    const { data: memoryRows } = await sb
      .from('t08a_vendor_categorization_memory')
      .select('vendor_pattern, expense_type');
    const memory = new Map<string, string>();
    for (const m of (memoryRows ?? []) as Array<{ vendor_pattern: string; expense_type: string }>) {
      memory.set(m.vendor_pattern, m.expense_type);
    }

    // Also pre-fetch existing t08_expenses rows so we don't clobber manual
    // corrections that aren't in vendor memory yet (one-time self-heal —
    // next time the user touches this vendor, it lands in memory too).
    const ids = summary.transactions.map(t => t.id);
    const existing = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb
        .from('t08_expenses')
        .select('id, expense_type')
        .in('id', ids.slice(i, i + 200));
      for (const r of (data ?? []) as Array<{ id: string; expense_type: string }>) {
        if (r.expense_type && r.expense_type !== 'unknown' && r.expense_type !== 'other') {
          existing.set(r.id, r.expense_type);
        }
      }
    }

    // Mapper has already filtered/normalised. Now apply learning order:
    //   1. Vendor memory (learned from queue) → wins
    //   2. Existing t08 row's category (manual fix not yet in memory) → wins
    //   3. Mapper's default category (keyword rules)
    let memoryHits = 0;
    let preservedHits = 0;
    const rows = summary.transactions.map(t => {
      const transaction_name = t.counterpartyName || t.description || 'Unknown';
      const vendorKey = normaliseVendor(transaction_name);
      const learnedType = memory.get(vendorKey);
      const preservedType = existing.get(t.id);
      let finalCategory = t.category;
      if (learnedType) {
        finalCategory = learnedType;
        memoryHits += 1;
      } else if (preservedType) {
        finalCategory = preservedType;
        preservedHits += 1;
      }
      return {
        id: t.id,
        date: t.date,
        transaction_name,
        expense_type: finalCategory,
        amount: t.amount,
        notes: t.description && t.description !== t.counterpartyName ? t.description : null,
        card_name: t.cardName,
        card_last_four: t.cardLastFour,
        updated_at: new Date().toISOString(),
      };
    });
    console.log(`[sync/expenses] Vendor memory hits: ${memoryHits} | Preserved manual corrections: ${preservedHits} | Mapper defaults: ${rows.length - memoryHits - preservedHits}`);

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await sb
        .from('t08_expenses')
        .upsert(chunk, { onConflict: 'id' });
      if (error) throw error;
      upserted += chunk.length;
    }

    console.log(`[sync/expenses] Upserted ${upserted} expense transactions (${startDate} → ${endDate})`);
    return { rowsUpserted: upserted, rowsSkipped: 0 };
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = POST;
