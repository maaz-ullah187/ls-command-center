import { NextRequest, NextResponse } from 'next/server';
import { getServerSupabaseAsync } from '@/lib/supabase/server';

/**
 * POST /api/data/payment-log
 * Accepts CSV data (as JSON array of row objects) from the operator's payment log
 * Google Sheet and upserts into the payment_log Supabase table.
 *
 * Body: { rows: PaymentLogRow[] }
 * Each row: { status, datePaid, clientName, agencyName, clientEmail, clientPhone,
 *             paymentType, program, dateCollected, newCash }
 */

interface PaymentLogRow {
  status?: string;
  datePaid?: string;
  clientName: string;
  agencyName?: string;
  clientEmail?: string;
  clientPhone?: string;
  paymentType?: string;
  program?: string;
  dateCollected?: string;
  newCash?: number | string;
}

function parseDate(val: string | undefined): string | null {
  if (!val || val.trim() === '') return null;
  // Try ISO format first
  const iso = new Date(val);
  if (!isNaN(iso.getTime())) return iso.toISOString().split('T')[0];
  // Try MM/DD/YYYY
  const parts = val.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    const yr = y.length === 2 ? `20${y}` : y;
    return `${yr}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseCurrency(val: string | number | undefined): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  // Strip $, commas, spaces
  const cleaned = val.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows: PaymentLogRow[] = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    const sb = await getServerSupabaseAsync();
    if (!sb) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    // Map to DB columns
    const dbRows = rows
      .filter(r => r.clientName && r.clientName.trim() !== '')
      .map(r => ({
        status: r.status?.trim() || null,
        date_paid: parseDate(r.datePaid),
        client_name: r.clientName.trim(),
        agency_name: r.agencyName?.trim() || null,
        client_email: r.clientEmail?.trim() || null,
        client_phone: r.clientPhone?.trim() || null,
        payment_type: r.paymentType?.trim() || null,
        program: r.program?.trim() || null,
        date_collected: parseDate(r.dateCollected),
        new_cash: parseCurrency(r.newCash),
        updated_at: new Date().toISOString(),
      }));

    if (dbRows.length === 0) {
      return NextResponse.json({ error: 'No valid rows after filtering (clientName is required)' }, { status: 400 });
    }

    // Upsert in batches of 50
    const batchSize = 50;
    let upserted = 0;
    let errors: string[] = [];

    for (let i = 0; i < dbRows.length; i += batchSize) {
      const batch = dbRows.slice(i, i + batchSize);
      const { error } = await sb
        .from('payment_log')
        .upsert(batch, { onConflict: 'client_name,date_paid,payment_type' });
      if (error) {
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      validRows: dbRows.length,
      upserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to process payment log' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sb = await getServerSupabaseAsync();
    if (!sb) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { data, error } = await sb
      .from('payment_log')
      .select('*')
      .order('date_paid', { ascending: false })
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to fetch payment log' }, { status: 500 });
  }
}
