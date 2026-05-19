import 'server-only';
import type { Lead } from '../types';
import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages';

// ---------------------------------------------------------------------------
// Tool definitions (JSON schema for Claude)
// ---------------------------------------------------------------------------

export const CHAT_TOOLS: AnthropicTool[] = [
  {
    name: 'search_leads',
    description: 'Search and filter leads. Returns matching leads with key fields (name, email, source, program, stage, score, cashCollected, demoDate, showStatus, callOutcome, assignedCloser). Use this for aggregate questions like "how many leads from Facebook Ads last week?" or "which leads are Closed Won?".',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'Filter by source: Facebook Ads, YouTube, Instagram, LinkedIn, X, Referral, Unknown' },
        program: { type: 'string', description: 'Filter by program: Program A, Program B, Program C' },
        stage: { type: 'string', description: 'Filter by stage: New Lead, Qualified, Long Term Nurture, Closed Won, Closed Lost' },
        min_score: { type: 'number', description: 'Minimum quality score (0-10)' },
        max_score: { type: 'number', description: 'Maximum quality score (0-10)' },
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        closer: { type: 'string', description: 'Filter by assigned closer name' },
        show_status: { type: 'string', description: 'Filter by show status: Showed, No Show, Cancelled, Rescheduled' },
        call_outcome: { type: 'string', description: 'Filter by call outcome: Closed Won, Follow Up Booked, Not Qualified, No Decision, Closed Lost' },
        limit: { type: 'number', description: 'Max results to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_lead_detail',
    description: 'Get full details for a specific lead by name or email. Returns all 44 fields including qualification answers, scoring data, call metadata, and Grain summary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Lead name (partial match OK)' },
        email: { type: 'string', description: 'Lead email (exact match)' },
      },
      required: [],
    },
  },
  {
    name: 'get_transcript',
    description: 'Get the full Grain call transcript for a specific lead. Use when the user asks about what was said on a call, objections, talking points, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Lead name to find transcript for' },
        email: { type: 'string', description: 'Lead email to find transcript for' },
      },
      required: [],
    },
  },
  {
    name: 'get_conversations',
    description: 'Get GHL SMS/text conversation history for a lead. Shows the setter back-and-forth with the lead before and after calls.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Lead name' },
        email: { type: 'string', description: 'Lead email' },
      },
      required: [],
    },
  },
  {
    name: 'get_metrics',
    description: 'Get daily performance metrics: spend, leads, callsBooked, callsShown, callsClosed, revenue. Returns per-day data for the requested date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to 7 days ago.' },
        date_to: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
      },
      required: [],
    },
  },
  {
    name: 'get_ads',
    description: 'Get Meta ad performance data: spend, impressions, clicks, CPC, CPL per ad. Use for questions about ad performance, best/worst ads, creative analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_preset: { type: 'string', description: 'Date range: last_7d, last_14d, last_30d, last_90d. Default last_7d.' },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers — execute tools server-side, return data for Claude
// ---------------------------------------------------------------------------

export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  leads: Lead[],
): Promise<string> {
  switch (toolName) {
    case 'search_leads':
      return handleSearchLeads(toolInput, leads);
    case 'get_lead_detail':
      return handleGetLeadDetail(toolInput, leads);
    case 'get_transcript':
      return await handleGetTranscript(toolInput, leads);
    case 'get_conversations':
      return await handleGetConversations(toolInput, leads);
    case 'get_metrics':
      return await handleGetMetrics(toolInput);
    case 'get_ads':
      return await handleGetAds(toolInput);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// --- search_leads ---

function handleSearchLeads(input: Record<string, unknown>, leads: Lead[]): string {
  let filtered = [...leads];

  if (input.source) filtered = filtered.filter(l => l.source === input.source);
  if (input.program) filtered = filtered.filter(l => l.program === input.program);
  if (input.stage) filtered = filtered.filter(l => l.stage === input.stage);
  if (input.closer) {
    const c = String(input.closer).toLowerCase();
    filtered = filtered.filter(l => l.assignedCloser?.toLowerCase().includes(c));
  }
  if (input.show_status) filtered = filtered.filter(l => l.showStatus === input.show_status);
  if (input.call_outcome) filtered = filtered.filter(l => l.callOutcome === input.call_outcome);
  if (typeof input.min_score === 'number') filtered = filtered.filter(l => l.qualityScore >= (input.min_score as number));
  if (typeof input.max_score === 'number') filtered = filtered.filter(l => l.qualityScore <= (input.max_score as number));
  if (input.date_from) filtered = filtered.filter(l => l.date >= String(input.date_from));
  if (input.date_to) filtered = filtered.filter(l => l.date <= String(input.date_to));

  const limit = typeof input.limit === 'number' ? input.limit : 20;

  const summary = {
    totalMatching: filtered.length,
    totalCash: filtered.reduce((s, l) => s + l.cashCollected, 0),
    totalContracted: filtered.reduce((s, l) => s + l.contractedRevenue, 0),
    byStage: countBy(filtered, l => l.stage),
    bySource: countBy(filtered, l => l.source),
    byProgram: countBy(filtered, l => l.program),
    leads: filtered.slice(0, limit).map(l => ({
      name: l.name,
      email: l.email,
      source: l.source,
      program: l.program,
      stage: l.stage,
      score: l.qualityScore,
      cashCollected: l.cashCollected,
      contractedRevenue: l.contractedRevenue,
      demoDate: l.demoDate,
      showStatus: l.showStatus,
      callOutcome: l.callOutcome,
      closer: l.assignedCloser,
      date: l.date,
    })),
  };

  return JSON.stringify(summary);
}

function countBy<T>(arr: T[], fn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    const key = fn(item) || 'Unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// --- get_lead_detail ---

function handleGetLeadDetail(input: Record<string, unknown>, leads: Lead[]): string {
  const name = String(input.name ?? '').toLowerCase();
  const email = String(input.email ?? '').toLowerCase();

  const lead = leads.find(l => {
    if (email && l.email?.toLowerCase() === email) return true;
    if (name && l.name?.toLowerCase().includes(name)) return true;
    return false;
  });

  if (!lead) return JSON.stringify({ error: `No lead found matching name="${name}" email="${email}"` });

  return JSON.stringify({
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    program: lead.program,
    stage: lead.stage,
    date: lead.date,
    campaignName: lead.campaignName,
    adSetName: lead.adSetName,
    adName: lead.adName,
    qualityScore: lead.qualityScore,
    qualityScoreSummary: lead.qualityScoreSummary,
    qualityRedFlags: lead.qualityRedFlags,
    qualityGreenFlags: lead.qualityGreenFlags,
    qualification: lead.qualification,
    demoBooked: lead.demoBooked,
    demoDate: lead.demoDate,
    showStatus: lead.showStatus,
    callOutcome: lead.callOutcome,
    assignedCloser: lead.assignedCloser,
    assignedSetter: lead.assignedSetter,
    cashCollected: lead.cashCollected,
    contractedRevenue: lead.contractedRevenue,
    grainCallSummary: lead.grainCallSummary,
    grainCallType: lead.grainCallType,
    grainDurationMin: lead.grainDurationMin,
    grainIntelligenceNotes: lead.grainIntelligenceNotes,
    grainOwnerEmail: lead.grainOwnerEmail,
    calendlyEventName: lead.calendlyEventName,
    calendlyStatus: lead.calendlyStatus,
    paymentFailed: lead.paymentFailed,
    paymentFailedReason: lead.paymentFailedReason,
    ghlContactId: lead.ghlContactId,
  });
}

// --- get_transcript ---

async function handleGetTranscript(input: Record<string, unknown>, leads: Lead[]): Promise<string> {
  const name = String(input.name ?? '').toLowerCase();
  const email = String(input.email ?? '').toLowerCase();

  const lead = leads.find(l => {
    if (email && l.email?.toLowerCase() === email) return true;
    if (name && l.name?.toLowerCase().includes(name)) return true;
    return false;
  });

  if (!lead) return JSON.stringify({ error: `No lead found matching name="${name}" email="${email}"` });
  if (!lead.grainRecordingId) return JSON.stringify({ error: `${lead.name} has no Grain recording.` });

  const grainToken = process.env.GRAIN_API_KEY;
  if (!grainToken) return JSON.stringify({ error: 'Grain API not configured' });

  try {
    const { fetchGrainTranscript } = await import('../mappers/grain');
    const transcript = await fetchGrainTranscript(grainToken, lead.grainRecordingId);
    if (!transcript) return JSON.stringify({ error: `No transcript available for ${lead.name}` });
    // Truncate to 30k chars to stay within reasonable token limits
    const maxLen = 30_000;
    const text = transcript.length > maxLen
      ? transcript.slice(0, maxLen) + '\n\n[...truncated at 30,000 chars]'
      : transcript;
    return JSON.stringify({
      leadName: lead.name,
      callType: lead.grainCallType,
      durationMin: lead.grainDurationMin,
      closer: lead.grainOwnerEmail,
      transcript: text,
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to fetch transcript: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// --- get_conversations ---

async function handleGetConversations(input: Record<string, unknown>, leads: Lead[]): Promise<string> {
  const name = String(input.name ?? '').toLowerCase();
  const email = String(input.email ?? '').toLowerCase();

  const lead = leads.find(l => {
    if (email && l.email?.toLowerCase() === email) return true;
    if (name && l.name?.toLowerCase().includes(name)) return true;
    return false;
  });

  if (!lead) return JSON.stringify({ error: `No lead found matching name="${name}" email="${email}"` });
  if (!lead.ghlContactId) return JSON.stringify({ error: `${lead.name} has no GHL contact ID.` });

  const ghlToken = process.env.GHL_API_KEY;
  const ghlLoc = process.env.GHL_LOCATION_ID;
  if (!ghlToken || !ghlLoc) return JSON.stringify({ error: 'GHL API not configured' });

  try {
    const { fetchGHLConversations } = await import('../mappers/ghl');
    const messages = await fetchGHLConversations(ghlToken, ghlLoc, lead.ghlContactId);
    if (messages.length === 0) return JSON.stringify({ error: `No conversations found for ${lead.name}` });
    return JSON.stringify({
      leadName: lead.name,
      messageCount: messages.length,
      messages: messages.map(m => ({
        direction: m.direction,
        type: m.type,
        body: m.body.slice(0, 500), // Truncate long messages
        timestamp: m.timestamp,
      })),
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to fetch conversations: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// --- get_metrics ---

async function handleGetMetrics(input: Record<string, unknown>): Promise<string> {
  try {
    const { getDailyMetrics } = await import('../dataSources');
    const allMetrics = await getDailyMetrics();
    const from = String(input.date_from ?? '');
    const to = String(input.date_to ?? '');

    let filtered = allMetrics;
    if (from) filtered = filtered.filter(m => m.date >= from);
    if (to) filtered = filtered.filter(m => m.date <= to);

    const totals = {
      totalSpend: filtered.reduce((s, m) => s + m.spend, 0),
      totalLeads: filtered.reduce((s, m) => s + m.leads, 0),
      totalCallsBooked: filtered.reduce((s, m) => s + m.callsBooked, 0),
      totalCallsShown: filtered.reduce((s, m) => s + m.callsShown, 0),
      totalCallsClosed: filtered.reduce((s, m) => s + m.callsClosed, 0),
      totalRevenue: filtered.reduce((s, m) => s + m.revenue, 0),
      days: filtered.length,
    };

    return JSON.stringify({
      ...totals,
      cpl: totals.totalLeads > 0 ? totals.totalSpend / totals.totalLeads : 0,
      showRate: totals.totalCallsBooked > 0 ? (totals.totalCallsShown / totals.totalCallsBooked * 100) : 0,
      closeRate: totals.totalCallsShown > 0 ? (totals.totalCallsClosed / totals.totalCallsShown * 100) : 0,
      dailyBreakdown: filtered.slice(-14), // Last 14 days max
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to fetch metrics: ${e instanceof Error ? e.message : String(e)}` });
  }
}

// --- get_ads ---

async function handleGetAds(input: Record<string, unknown>): Promise<string> {
  try {
    const { getAds } = await import('../dataSources');
    const allAds = await getAds();

    // Aggregate by ad name (since time_increment=1 creates per-day rows)
    const byAd = new Map<string, { spend: number; impressions: number; clicks: number; count: number }>();
    for (const ad of allAds) {
      const key = ad.adName;
      const existing = byAd.get(key) ?? { spend: 0, impressions: 0, clicks: 0, count: 0 };
      existing.spend += ad.spend;
      existing.impressions += ad.impressions;
      existing.clicks += ad.clicks;
      existing.count++;
      byAd.set(key, existing);
    }

    const ads = Array.from(byAd.entries())
      .map(([name, data]) => ({
        adName: name,
        spend: Math.round(data.spend * 100) / 100,
        impressions: data.impressions,
        clicks: data.clicks,
        cpc: data.clicks > 0 ? Math.round(data.spend / data.clicks * 100) / 100 : 0,
        ctr: data.impressions > 0 ? Math.round(data.clicks / data.impressions * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 25);

    return JSON.stringify({
      totalAds: byAd.size,
      totalSpend: ads.reduce((s, a) => s + a.spend, 0),
      ads,
    });
  } catch (e) {
    return JSON.stringify({ error: `Failed to fetch ads: ${e instanceof Error ? e.message : String(e)}` });
  }
}
