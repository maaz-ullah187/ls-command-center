// Vendor categorization memory — shared helpers used by the expense
// categorize endpoint (write) and the Mercury sync (read).
//
// The memory table (t08a_vendor_categorization_memory) maps a NORMALISED
// vendor name to the expense_type the team last picked. Future Mercury
// transactions matching that normalised name auto-apply the learned type.

import 'server-only';

/**
 * Normalise a Mercury transaction_name into a stable lookup key.
 *
 * Examples:
 *   "UPWORK *-913284471"    → "upwork"
 *   "PADDLE.NET* SETAPP"    → "paddle.net setapp"
 *   "Send Money — wire to John Smith"  → "send money wire to john smith"
 *
 * Strategy: lowercase, strip transaction-id-like tails (asterisk + alnum),
 * collapse non-letter runs to single spaces, trim. Tuned to keep enough
 * signal that distinct vendors stay distinct, while collapsing the
 * unique-per-charge garbage Mercury appends.
 */
export function normaliseVendor(rawName: string | null | undefined): string {
  if (!rawName) return '';
  let s = String(rawName).toLowerCase();
  // Drop everything after an asterisk + space (Mercury's per-charge tail)
  s = s.replace(/\s*\*\s*[-\w]+.*$/, '');
  // Drop trailing transaction IDs (long digit runs at the end)
  s = s.replace(/\s+\d{4,}$/g, '');
  // Replace any non-letter/digit/dot run with a single space
  s = s.replace(/[^a-z0-9.]+/g, ' ');
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Look up the learned expense_type for a vendor. Returns null if no memory
 * exists. Increments hit_count + last_used_at as a side effect so we can
 * see which patterns are being used.
 */
export async function lookupVendorMemory(
  supa: any,
  rawVendor: string | null | undefined
): Promise<string | null> {
  const key = normaliseVendor(rawVendor);
  if (!key) return null;
  const { data, error } = await supa
    .from('t08a_vendor_categorization_memory')
    .select('expense_type, hit_count')
    .eq('vendor_pattern', key)
    .maybeSingle();
  if (error || !data) return null;
  // Update hit counter + last_used_at (fire-and-forget — don't block sync)
  supa
    .from('t08a_vendor_categorization_memory')
    .update({
      hit_count: (data.hit_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('vendor_pattern', key)
    .then(() => {}, () => {});
  return data.expense_type as string;
}

/**
 * Record a learned categorization. Called by /api/expense/categorize when
 * a human picks a bucket via the queue.
 */
export async function rememberVendor(
  supa: any,
  rawVendor: string | null | undefined,
  expense_type: string
): Promise<void> {
  const key = normaliseVendor(rawVendor);
  if (!key) return;
  await supa
    .from('t08a_vendor_categorization_memory')
    .upsert(
      {
        vendor_pattern: key,
        expense_type,
        learned_at: new Date().toISOString(),
        learned_by: 'dashboard',
        source_sample: rawVendor ?? null,
      },
      { onConflict: 'vendor_pattern' }
    );
}
