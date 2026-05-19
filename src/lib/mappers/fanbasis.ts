/**
 * Fanbasis API mapper — fetches subscribers/payments from the backup processor.
 * Base URL: https://www.fanbasis.com/public-api
 * Auth: x-api-key header
 */

export interface FanbasisSubscriber {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productTitle: string;
  productPrice: number;
  subscriptionStatus: string;
  createdAt: string;
}

export interface FanbasisPaymentSummary {
  email: string;
  name: string;
  phone: string;
  totalPaid: number;
  products: string[];
  latestDate: string;
}

const BASE_URL = 'https://www.fanbasis.com/public-api';

export async function fetchFanbasisSubscribers(
  apiKey: string,
  maxPages = 10,
): Promise<FanbasisSubscriber[]> {
  const all: FanbasisSubscriber[] = [];

  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await fetch(
        `${BASE_URL}/subscribers?per_page=100&page=${page}`,
        {
          headers: { 'x-api-key': apiKey, Accept: 'application/json' },
          next: { revalidate: 600 },
        },
      );

      if (!res.ok) {
        console.error(`[fanbasis] subscribers HTTP ${res.status} on page ${page}`);
        break;
      }

      const json = await res.json();
      const subs = json.data?.subscribers ?? [];
      if (subs.length === 0) break;

      for (const s of subs) {
        const customer = s.customer ?? {};
        const product = s.product ?? {};
        const subscription = s.subscription ?? {};
        all.push({
          id: s.id ?? '',
          customerName: customer.name ?? '',
          customerEmail: (customer.email ?? '').toLowerCase(),
          customerPhone: customer.phone ?? '',
          productTitle: product.title ?? '',
          productPrice: Number(product.price) || 0,
          subscriptionStatus: subscription.status ?? '',
          createdAt: (subscription.created_at ?? '').slice(0, 10),
        });
      }

      if (!json.data?.pagination?.has_more) break;
    } catch (e) {
      console.error('[fanbasis] fetch failed on page', page, e);
      break;
    }
  }

  console.log(`[fanbasis] fetched ${all.length} subscribers`);
  return all;
}

/**
 * Build a payment summary map keyed by email for lead enrichment.
 * Sums all payments per email and tracks products.
 */
export function buildFanbasisPaymentsByEmail(
  subscribers: FanbasisSubscriber[],
): Map<string, FanbasisPaymentSummary> {
  const map = new Map<string, FanbasisPaymentSummary>();

  for (const sub of subscribers) {
    if (!sub.customerEmail) continue;
    const existing = map.get(sub.customerEmail);
    if (existing) {
      existing.totalPaid += sub.productPrice;
      if (!existing.products.includes(sub.productTitle)) {
        existing.products.push(sub.productTitle);
      }
      if (sub.createdAt > existing.latestDate) {
        existing.latestDate = sub.createdAt;
      }
    } else {
      map.set(sub.customerEmail, {
        email: sub.customerEmail,
        name: sub.customerName,
        phone: sub.customerPhone,
        totalPaid: sub.productPrice,
        products: [sub.productTitle],
        latestDate: sub.createdAt,
      });
    }
  }

  return map;
}
