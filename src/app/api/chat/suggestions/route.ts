import { NextResponse } from 'next/server';
import { getSuggestions, type ChatContext } from '@/lib/chat/systemPrompt';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ctx: ChatContext = {
    activeTab: searchParams.get('tab') ?? 'dashboard',
    scopedLeadName: searchParams.get('leadName') ?? undefined,
    scopedLeadId: searchParams.get('leadId') ?? undefined,
  };

  return NextResponse.json({ suggestions: getSuggestions(ctx) });
}
