import { NextResponse } from 'next/server';
import { fetchWhopPayments, type WhopPayment } from '@/lib/mappers/whop';
import { fetchFanbasisSubscribers, type FanbasisSubscriber } from '@/lib/mappers/fanbasis';
import { getServerSupabaseAsync } from '@/lib/supabase/server';
import { FINANCING_FEE } from '@/lib/commission-config';

export interface BillingRow {
  id: string;
  date: string;
  name: string;
  email: string;
  amount: number;
  grossAmount: number;
  status: 'Approved' | 'Failed' | 'Refunded' | 'Chargeback' | 'Pending' | 'Overdue' | 'Declined';
  closer: string;
  program: string;
  financing: boolean;
  finalAmount: number;
  processor: 'Whop' | 'Fanbasis' | 'Manual' | 'Slack';
  notes: string;
  isAnomaly: boolean;
  anomalyReason: string;
  /** Categorization bucket from t07_income_processors.payment_type */
  payment_type?: string;
}

interface BillingTotals {
  total: number;
  approved: number;
  failed: number;
  refunded: number;
  totalCash: number;
  totalAfterFinancing: number;
}

function mapWhopStatus(status: WhopPayment['status']): BillingRow['status'] {
  switch (status) {
    case 'paid': return 'Approved';
    case 'failed': return 'Failed';
    case 'refunded': return 'Refunded';
    case 'chargedback': return 'Chargeback';
    case 'open': return 'Pending';
    default: return 'Pending';
  }
}

function mapWhopPayment(p: WhopPayment): BillingRow {
  const isFinanced = p.billingReason === 'recurring' || (p.planId ?? '').length > 0;
  const amount = p.net > 0 ? p.net : p.gross;
  const finalAmount = isFinanced ? amount * (1 - FINANCING_FEE) : amount;
  const isAnomaly = p.refundedAmount > 0 && p.status === 'paid';

  return {
    id: `whop-${p.id}`,
    date: p.date,
    name: p.customerName,
    email: p.customerEmail,
    amount,
    grossAmount: p.gross,
    status: mapWhopStatus(p.status),
    closer: '',
    program: p.program,
    financing: isFinanced,
    finalAmount: p.status === 'paid' ? finalAmount : 0,
    processor: 'Whop',
    notes: p.productName + (p.billingReason ? ` (${p.billingReason})` : ''),
    isAnomaly,
    anomalyReason: isAnomaly ? `Partial refund of $${p.refundedAmount} on paid transaction` : '',
  };
}

function mapFanbasisSubscriber(s: FanbasisSubscriber): BillingRow {
  const amount = s.productPrice;
  return {
    id: `fanbasis-${s.id}`,
    date: s.createdAt,
    name: s.customerName,
    email: s.customerEmail,
    amount,
    grossAmount: amount,
    status: 'Approved',
    closer: '',
    program: s.productTitle,
    financing: false,
    finalAmount: amount,
    processor: 'Fanbasis',
    notes: s.productTitle + (s.subscriptionStatus ? ` (${s.subscriptionStatus})` : ''),
    isAnomaly: false,
    anomalyReason: '',
  };
}

interface SlackPaymentRow {
  id: string;
  action: string;
  name: string;
  email: string;
  amount: number;
  parsed_at: string;
}

function mapSlackPayment(row: SlackPaymentRow): BillingRow {
  const isApproved = row.action === 'succeeded';
  return {
    id: `slack-${row.id}`,
    date: row.parsed_at ? row.parsed_at.slice(0, 10) : '',
    name: row.name ?? '',
    email: row.email ?? '',
    amount: row.amount ?? 0,
    grossAmount: row.amount ?? 0,
    status: isApproved ? 'Approved' : 'Failed',
    closer: '',
    program: '',
    financing: false,
    finalAmount: isApproved ? (row.amount ?? 0) : 0,
    processor: 'Slack',
    notes: `Payment ${row.action}`,
    isAnomaly: false,
    anomalyReason: '',
  };
}

function computeTotals(payments: BillingRow[]): BillingTotals {
  let total = 0, approved = 0, failed = 0, refunded = 0, totalCash = 0, totalAfterFinancing = 0;

  for (const p of payments) {
    total++;
    if (p.status === 'Approved') {
      approved++;
      totalCash += p.amount;
      totalAfterFinancing += p.finalAmount;
    } else if (p.status === 'Failed') {
      failed++;
    } else if (p.status === 'Refunded') {
      refunded++;
    }
  }

  return { total, approved, failed, refunded, totalCash, totalAfterFinancing };
}

// the operator 2026-05-01: rewired to read from t07_income_processors (the
// canonical Architecture-B revenue source) instead of live Whop/Fanbasis
// fetches. The previous version always set closer='' and never filled
// in payment_type because those fields don't exist on Whop/Fanbasis
// rows — they live on t07 after the sync worker enriches each row.
//
// t07 has: date, name, email, amount, final_amount, status, closer,
//          payment_type, payment_structure, offer, processor, notes.
// Same source the main dashboard's revenue cards use.

interface T07Row {
  id: string;
  date: string | null;
  name: string | null;
  email: string | null;
  amount: number | string | null;
  final_amount: number | string | null;
  status: string | null;
  closer: string | null;
  payment_type: string | null;
  payment_structure: string | null;
  offer: string | null;
  processor: string | null;
  notes: string | null;
  financing_used: boolean | null;
}

function mapT07Status(status: string | null): BillingRow['status'] {
  const s = (status ?? '').toLowerCase();
  if (s === 'paid' || s === 'approved') return 'Approved';
  if (s === 'failed' || s === 'declined') return 'Failed';
  if (s === 'refunded') return 'Refunded';
  if (s === 'chargedback' || s === 'chargeback') return 'Chargeback';
  if (s === 'pending' || s === 'open') return 'Pending';
  if (s === 'overdue') return 'Overdue';
  return 'Pending';
}

function mapT07Processor(processor: string | null): BillingRow['processor'] {
  const p = (processor ?? '').toLowerCase();
  if (p.includes('whop')) return 'Whop';
  if (p.includes('fanbasis')) return 'Fanbasis';
  if (p.includes('slack') || p.includes('manual')) return 'Slack';
  return 'Whop'; // sensible default
}

function mapT07Row(r: T07Row): BillingRow {
  const amount = Number(r.amount ?? 0);
  const finalAmount = Number(r.final_amount ?? amount);
  const financing = !!r.financing_used;
  return {
    id: `t07-${r.id}`,
    date: r.date ?? '',
    name: r.name ?? '',
    email: r.email ?? '',
    amount,
    grossAmount: amount,
    status: mapT07Status(r.status),
    closer: r.closer ?? '',
    program: r.offer ?? '',
    financing,
    finalAmount,
    processor: mapT07Processor(r.processor),
    notes: [r.payment_structure, r.notes].filter(Boolean).join(' · '),
    isAnomaly: false,
    anomalyReason: '',
    payment_type: r.payment_type ?? undefined,
  };
}

export async function GET() {
  const payments: BillingRow[] = [];
  const errors: string[] = [];

  const supa = await getServerSupabaseAsync();
  if (!supa) {
    return NextResponse.json({ payments: [], totals: computeTotals([]), errors: ['supabase_not_configured'] });
  }

  // Page through t07_income_processors. Default cap at 2000 most-recent
  // rows ordered by date desc — covers ~3 months of activity for ProgB.
  const PAGE = 1000;
  for (let offset = 0; offset < 2000; offset += PAGE) {
    const { data, error } = await supa
      .from('t07_income_processors')
      .select('id, date, name, email, amount, final_amount, status, closer, payment_type, payment_structure, offer, processor, notes, financing_used')
      .neq('payment_type', 'excluded')
      .order('date', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      errors.push(`t07: ${error.message}`);
      break;
    }
    const batch = (data ?? []) as T07Row[];
    for (const row of batch) {
      payments.push(mapT07Row(row));
    }
    if (batch.length < PAGE) break;
  }

  payments.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const totals = computeTotals(payments);

  return NextResponse.json({
    payments,
    totals,
    errors: errors.length > 0 ? errors : undefined,
  });
}
