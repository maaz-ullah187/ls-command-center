// Whop → Payment mapper (Pillar 4)
//
// Fetches all payments from the Whop API and returns:
// 1. A normalised Payment[] for the Expenses/P&L tab
// 2. A Map<email, WhopPaymentSummary> for enriching GHL leads with
//    cashCollected + contractedRevenue

import 'server-only';

export interface WhopPayment {
  id: string;
  date: string;            // ISO date string from paid_at or created_at
  customerEmail: string;
  customerName: string;
  gross: number;           // subtotal (what the customer was charged)
  net: number;             // final_amount (after processing fees)
  refundedAmount: number;
  status: 'paid' | 'open' | 'refunded' | 'failed' | 'chargedback';
  productId: string;
  productName: string;
  program: string;         // mapped from product
  planId: string;
  billingReason: string;   // one_time, recurring, etc
  cardBrand: string | null;
  cardLast4: string | null;
  // Direct URL to the Whop dashboard payment page. the operator validates each
  // transaction by clicking through (rule 2026-04-23).
  paymentLink: string | null;
}

/**
 * Resolve the operator's Whop business ID once (cached for the process lifetime)
 * so every payment can be hyperlinked to the dashboard. Sample:
 *   https://whop.com/dashboard/biz_jhKKuSTx5Podze/payments/pay_xxx/
 */
let cachedBizId: string | null = null;
async function getWhopBizId(token: string): Promise<string | null> {
  if (cachedBizId) return cachedBizId;
  try {
    const res = await fetch('https://api.whop.com/api/v5/company', {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.id) {
      cachedBizId = data.id;
      return cachedBizId;
    }
  } catch {
    // network flake — fall through and return null
  }
  return null;
}

export interface WhopPaymentSummary {
  totalPaid: number;          // sum of final_amount where status=paid
  totalContracted: number;    // sum of subtotal (includes open/pending)
  paymentCount: number;
  lastPaymentDate: string;
  productNames: string[];
}

// Product ID → human name + program mapping
const PRODUCT_MAP: Record<string, { name: string; program: string }> = {
  'prod_PROGRAM_B_PRIMARY': { name: 'Program B', program: 'Program B' },
  'prod_PROGRAM_C_PRIMARY': { name: 'Generic Limited', program: 'Program B' },
  'prod_PROGRAM_A_PRIMARY': { name: 'Payment Plan', program: 'Program B' },
  'prod_PROGRAM_B_RENEWAL': { name: 'Program B Renewal', program: 'Program B' },
  'prod_PROGRAM_C_SECONDARY': { name: 'Renewal', program: 'Program B' },
};

interface WhopAPIPayment {
  id: string;
  created_at: number;      // epoch seconds
  paid_at: number | null;
  refunded_at: number | null;
  status: string;
  subtotal: number;
  final_amount: number;
  refunded_amount: number;
  currency: string | null;
  product_id: string;
  plan_id: string;
  user_email: string;
  user_username: string;
  billing_reason: string;
  card_brand: string | null;
  card_last_4: string | null;
  billing_address?: {
    name: string | null;
  };
}

interface WhopPaginatedResponse {
  pagination: {
    current_page: number;
    total_pages: number;
    next_page: number | null;
    total_count: number;
  };
  data: WhopAPIPayment[];
}

function epochToISO(epoch: number | null): string {
  if (!epoch) return '';
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function mapStatus(s: string): WhopPayment['status'] {
  if (s === 'paid') return 'paid';
  if (s === 'refunded') return 'refunded';
  if (s === 'chargedback' || s === 'chargeback' || s === 'disputed') return 'chargedback';
  if (s === 'open' || s === 'pending') return 'open';
  return 'failed';
}

/**
 * Fetch all Whop payments (paginated). Returns up to maxPages × 50 payments.
 * Default 20 pages = 1000 payments. Increase for full backfill.
 */
export async function fetchWhopPayments(
  token: string,
  maxPages = 100
): Promise<WhopPayment[]> {
  const all: WhopPayment[] = [];
  const bizId = await getWhopBizId(token);

  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `https://api.whop.com/api/v5/company/payments?per=50&page=${page}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 300 }, // 5 min cache
      }
    );

    if (!res.ok) {
      console.error(`[whop] payments HTTP ${res.status} on page ${page}`);
      break;
    }

    const json = (await res.json()) as WhopPaginatedResponse;
    const items = json.data ?? [];

    for (const p of items) {
      const product = PRODUCT_MAP[p.product_id] ?? { name: p.product_id, program: 'Unknown' };
      all.push({
        id: p.id,
        date: epochToISO(p.paid_at) || epochToISO(p.created_at),
        customerEmail: (p.user_email ?? '').toLowerCase().trim(),
        customerName: p.billing_address?.name ?? p.user_username ?? '',
        gross: p.subtotal ?? 0,
        net: p.final_amount ?? 0,
        refundedAmount: p.refunded_amount ?? 0,
        status: mapStatus(p.status),
        productId: p.product_id,
        productName: product.name,
        program: product.program,
        planId: p.plan_id ?? '',
        billingReason: p.billing_reason ?? '',
        cardBrand: p.card_brand,
        cardLast4: p.card_last_4,
        paymentLink: bizId ? `https://whop.com/dashboard/${bizId}/payments/${p.id}/` : null,
      });
    }

    if (!json.pagination.next_page || page >= json.pagination.total_pages) break;
  }

  return all;
}

/**
 * Build a per-email payment summary for enriching GHL leads.
 * Only counts status=paid payments toward cashCollected.
 */
export function buildPaymentSummaryByEmail(
  payments: WhopPayment[]
): Map<string, WhopPaymentSummary> {
  const map = new Map<string, WhopPaymentSummary>();

  for (const p of payments) {
    if (!p.customerEmail) continue;
    const email = p.customerEmail;
    const existing = map.get(email) ?? {
      totalPaid: 0,
      totalContracted: 0,
      paymentCount: 0,
      lastPaymentDate: '',
      productNames: [],
    };

    if (p.status === 'paid') {
      existing.totalPaid += p.net;
      existing.paymentCount += 1;
    }
    // Contracted = everything including open/pending (what they agreed to pay)
    existing.totalContracted += p.gross;

    if (p.date > existing.lastPaymentDate) {
      existing.lastPaymentDate = p.date;
    }
    if (!existing.productNames.includes(p.productName)) {
      existing.productNames.push(p.productName);
    }

    map.set(email, existing);
  }

  return map;
}
