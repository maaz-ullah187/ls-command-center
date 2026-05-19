/**
 * Mercury Banking API mapper — pulls EXPENSES ONLY from one configured
 * checking account. NOT tracking income — only outgoing transactions.
 *
 * Base URL: https://api.mercury.com/api/v1
 * Auth: Bearer token
 *
 * Configure which Mercury account to read via env vars:
 *   MERCURY_API_KEY        — token from Mercury settings
 *   MERCURY_ACCOUNT_NAME   — substring match against account name
 *   MERCURY_ACCOUNT_LAST4  — substring match against account last-four
 */

export interface MercuryTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;            // positive number (mapper has already flipped sign)
  category: string;          // labour | marketing | overhead | mastermind | other | unknown
  counterpartyName: string;
  status: string;            // pending | sent | completed (never 'failed' — filtered out)
  cardName: string | null;   // name on card used — null for non-debit-card txns
  cardLastFour: string | null;
}

export interface MercuryExpenseSummary {
  totalExpenses: number;
  byCategory: Record<string, number>;
  transactions: MercuryTransaction[];
}

interface MercuryCardInfo {
  cardId: string;
  nameOnCard: string;
  lastFourDigits: string;
}

const BASE_URL = 'https://api.mercury.com/api/v1';

export async function fetchMercuryAccounts(
  apiKey: string,
): Promise<{ id: string; name: string; balance: number }[]> {
  try {
    const res = await fetch(`${BASE_URL}/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.accounts ?? []).map((a: any) => ({
      id: a.id,
      name: a.name ?? '',
      balance: a.currentBalance ?? 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch every card for one account and return a `cardId → { name, last4 }` map.
 * Used to attribute card transactions to a specific team member.
 */
async function fetchCardsForAccount(
  apiKey: string,
  accountId: string,
): Promise<Map<string, MercuryCardInfo>> {
  const map = new Map<string, MercuryCardInfo>();
  try {
    const res = await fetch(`${BASE_URL}/account/${accountId}/cards`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return map;
    const data = await res.json();
    for (const c of data.cards ?? []) {
      if (!c.cardId) continue;
      map.set(c.cardId, {
        cardId: c.cardId,
        nameOnCard: c.nameOnCard ?? '',
        lastFourDigits: c.lastFourDigits ?? '',
      });
    }
  } catch {
    // Card lookup failures aren't fatal — transactions will just have null card info.
  }
  return map;
}

/**
 * True if the transaction is an internal transfer (money moving between the operator's
 * own accounts / entities) that should NEVER be counted as an expense.
 */
function isInternalTransfer(t: any): boolean {
  const desc = (t.note || t.bankDescription || t.counterpartyName || '').toLowerCase();
  const kind = (t.kind || '').toLowerCase();
  const cpName = (t.counterpartyName || '').toLowerCase();
  const cpNick = (t.counterpartyNickname || '').toLowerCase();

  // Substrings that always mean "internal"
  const internalSubstrings = [
    'transfer between',
    'to personal',
    'to savings',
    'to credit card',
  ];
  if (internalSubstrings.some(s => desc.includes(s))) return true;

  // Kind flags from Mercury
  if (kind === 'internaltransfer' || kind === 'internal_transfer') return true;

  // Counterparty-based exclusions — sister LLCs / personal accounts.
  // Add lowercase substrings for any of your own internal counterparties.
  const internalCounterparties: string[] = [
    'personal expenses',
  ];
  if (internalCounterparties.some(s => cpName.includes(s) || cpNick.includes(s))) return true;

  // Mercury-issued credits from dispute resolutions / reversals — money
  // coming BACK into the account (not a real outgoing expense). Amount can
  // be negative during intermediate states, so filter by counterparty name
  // rather than relying on amount sign.
  const mercuryCreditNames = ['mercury provisional credit', 'mercury credit'];
  if (mercuryCreditNames.some(s => cpName.includes(s))) return true;

  return false;
}

export async function fetchMercuryExpenses(
  apiKey: string,
  startDate?: string,
  endDate?: string,
): Promise<MercuryExpenseSummary> {
  try {
    // 1. Resolve the ProgB account. STRICT — no fallback to accounts[0].
    const accounts = await fetchMercuryAccounts(apiKey);
    if (accounts.length === 0) {
      throw new Error('Mercury returned zero accounts — check MERCURY_API_KEY');
    }
    // Configure which Mercury account to pull. Set MERCURY_ACCOUNT_NAME or
    // MERCURY_ACCOUNT_LAST4 in your env so the mapper knows which checking
    // account to read transactions from.
    const wantName = (process.env.MERCURY_ACCOUNT_NAME ?? '').toLowerCase();
    const wantLast4 = process.env.MERCURY_ACCOUNT_LAST4 ?? '';
    const lsAccount = accounts.find(
      a => (wantName && a.name.toLowerCase().includes(wantName)) ||
           (wantLast4 && a.name.includes(wantLast4)),
    );
    if (!lsAccount) {
      throw new Error(
        `Configured Mercury account not found. ` +
        `Accounts visible: ${accounts.map(a => a.name).join(', ')}`,
      );
    }

    // 2. Pre-fetch the card roster so we can attribute debit-card transactions
    //    to a specific team member.
    const cardMap = await fetchCardsForAccount(apiKey, lsAccount.id);

    // 3. Pull transactions for the configured window.
    const now = new Date();
    const start =
      startDate ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const end = endDate || now.toISOString().slice(0, 10);

    const url = `${BASE_URL}/account/${lsAccount.id}/transactions?start=${start}&end=${end}&limit=500`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Mercury transactions fetch failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const rawTxns: any[] = data.transactions ?? [];

    // 4. Filter + map.
    const allTransactions: MercuryTransaction[] = [];
    for (const t of rawTxns) {
      const amount = Number(t.amount) || 0;

      // Skip income
      if (amount >= 0) continue;

      // Skip failed transactions — money never moved, so they aren't expenses
      if ((t.status || '').toLowerCase() === 'failed') continue;

      // Skip internal transfers
      if (isInternalTransfer(t)) continue;

      // Look up card attribution if this is a debit-card transaction
      const cardId: string | undefined = t?.details?.debitCardInfo?.id;
      const card = cardId ? cardMap.get(cardId) : undefined;

      allTransactions.push({
        id: t.id ?? '',
        date: (t.postedDate || t.createdAt || '').slice(0, 10),
        description: t.note || t.bankDescription || t.counterpartyName || '',
        amount: Math.abs(amount),
        category: categorizeExpense(t),
        counterpartyName: t.counterpartyName ?? '',
        status: t.status ?? 'completed',
        cardName: card?.nameOnCard ?? null,
        cardLastFour: card?.lastFourDigits ?? null,
      });
    }

    // 5. Aggregate by category
    const byCategory: Record<string, number> = {};
    let totalExpenses = 0;
    for (const t of allTransactions) {
      byCategory[t.category] = (byCategory[t.category] ?? 0) + t.amount;
      totalExpenses += t.amount;
    }

    return { totalExpenses, byCategory, transactions: allTransactions };
  } catch (e) {
    console.error('[mercury] fetchExpenses failed:', e);
    // Re-throw so runSync surfaces the error + posts a Slack alert, instead of
    // silently returning an empty summary like before.
    throw e;
  }
}

/**
 * Categorize a Mercury transaction into expense buckets.
 *
 * 7-bucket vocabulary (per the spec, 2026-04-23):
 *   personal (shouldn't be there) — personal charge hitting an ProgB-issued card
 *   labour     — team payments
 *   marketing  — ad spend + marketing contractors
 *   overhead   — known SaaS / tools / services
 *   mastermind — events, venues, travel
 *   other      — legit, needed, doesn't fit above
 *   unknown    — FALLBACK. system doesn't recognize it; human review needed
 *
 * Order matters: `personal` is checked FIRST so a personal charge on a
 * business card can't be swept into another bucket by coincidence.
 */
function categorizeExpense(txn: any): string {
  const name = (
    (txn.counterpartyName ?? '') + ' ' +
    (txn.note ?? '') + ' ' +
    (txn.bankDescription ?? '')
  ).toLowerCase();

  // personal — charges on ProgB-issued cards that are personal, not business.
  // Flagged with literal "shouldn't be there" phrasing so they stand out
  // in the expense_type column and in the UI.
  const personalKeywords = [
    'netflix',
    'omega wellness',
  ];
  if (personalKeywords.some(k => name.includes(k))) {
    return "personal (shouldn't be there)";
  }

  // labour — team member payments (closers, setters, CSMs, coaches, contractors)
  // Add team-member first names / last names / company-of-record keywords here.
  const labourKeywords = [
    // Generic patterns kept (payroll providers, role keywords)
    'whop',                // Whop is labour (team payments go through Whop)
    'gusto', 'payroll', 'deel', 'remote.com', 'salary', 'wage',
    'wire foreign exchange fee', 'intl. wire',
    'closer', 'setter', 'csm', 'coach', 'pmo',
    // Added 2026-04-23 from unknown-bucket review:
    'neil kevin pua', 'gallego',
    'joshua l twine',
    'saban mehic',
    'alexander dzavaryan',
    'julia rice',
    'nicholas carmona',
    // Added 2026-04-25 per the spec — manual recategorizations, locked into source:
    'john wolf',
  ];
  if (labourKeywords.some(k => name.includes(k))) return 'labour';

  // marketing — ad spend and marketing contractors
  const marketingKeywords = [
    'facebook', 'meta platform', 'google ads', 'tiktok',
    'panos', 'antonios', 'apostolidis',
    // Added 2026-04-23 from unknown-bucket review:
    'agency ad accelerator',
    'warrior pipeline',
  ];
  if (marketingKeywords.some(k => name.includes(k))) return 'marketing';

  // coaching — the operator paying for external coaching/consulting (not income)
  // Added 2026-04-25 — was bucketed as `other` previously.
  const coachingKeywords = [
    'megalodon marketing',
  ];
  if (coachingKeywords.some(k => name.includes(k))) return 'coaching';

  // mastermind — events the operator attends/hosts as a participant or facilitator.
  // Note: 'event sales agency' moved to overhead per the spec 2026-04-25.
  const mastermindKeywords = [
    'mastermind', 'venue', 'hotel', 'flight', 'airbnb',
    'conference', 'retreat',
  ];
  if (mastermindKeywords.some(k => name.includes(k))) return 'mastermind';

  // overhead — known SaaS / tools / services / banking
  const overheadKeywords = [
    'anthropic', 'openai', 'claude.ai', 'manus', 'google cloud', 'gcp',
    'onsite studios', 'manychat', 'make.com', 'make ', 'calendly',
    'content hq', 'marko', 'hostinger', 'elevenlabs', 'close.com', 'close ',
    'stripe', 'z.ai', 'vercel', 'supabase', 'slack', 'notion', 'zapier',
    'aws', 'amazon web', 'github', 'linear', 'figma', 'loom', 'superhuman',
    'gohighlevel', 'high level', 'typeform', 'grain', 'fathom',
    'subscription', 'saas', 'software',
    // Added 2026-04-23 from unknown-bucket review:
    'skool', 'hyros', 'cleverprofits', 'wistia', 'circle.so', 'circle ',
    'delphi ai', 'delphi.ai', 'kie.ai', 'bitly', 'riverside', 'ideogram',
    'replyrocket', 'railway', 'numverify', 'ergonis', 'yt jobs',
    'x developer platform', 'alignflow', 'every',
    'intl. transaction fee', 'international transaction fee',
    // Added 2026-04-25 per the spec — manual recategorizations, locked into source:
    'bluevine',            // banking
    'alpha tux',           // contractor/admin
    'event sales agency',  // moved out of mastermind
    'capcut',              // editing software
  ];
  if (overheadKeywords.some(k => name.includes(k))) return 'overhead';

  // other — legit business expenses that don't fit the above buckets.
  // the operator tags these explicitly. Grows over time.
  const otherKeywords = [
    'blkn crypto',         // Instagram username purchase
  ];
  if (otherKeywords.some(k => name.includes(k))) return 'other';

  // Fallback — needs human review
  return 'unknown';
}
