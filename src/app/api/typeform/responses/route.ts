import { NextResponse } from 'next/server';

const TYPEFORM_BASE = 'https://api.typeform.com';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const formId = searchParams.get('formId');
  const pageSize = searchParams.get('pageSize') || '25';
  const since = searchParams.get('since');
  const until = searchParams.get('until');

  try {
    const token = process.env.TYPEFORM_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'Typeform token not configured' }, { status: 500 });
    }

    if (!formId) {
      return NextResponse.json({ error: 'formId query parameter is required' }, { status: 400 });
    }

    const params = new URLSearchParams({ page_size: pageSize });
    if (since) params.set('since', since);
    if (until) params.set('until', until);

    const res = await fetch(`${TYPEFORM_BASE}/forms/${formId}/responses?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`Typeform API error: ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
