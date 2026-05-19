import 'server-only';

export type ChatContext = {
  activeTab: string;
  scopedLeadName?: string;
  scopedLeadId?: string;
};

export function buildSystemPrompt(ctx: ChatContext): string {
  const parts: string[] = [];

  parts.push(`You are the operator's business intelligence analyst for Program B. You have access to real-time data from the CRM dashboard.

## Business Context

the operator runs three programs:
1. **Program A (ProgA)** — community/course
2. **Program B (ProgB)** — licensing model (main program)
3. **Program C** — done-for-you AI agent builds (DFY agency offer)

Team: Closer One and Closer Two are closers. Setter One is the phone setter. James is the DM setter.

## Lead Quality Scale (0-10)
- 0: Unqualified, never pitched
- 1-3: Pitched but can't afford / wrong fit
- 4-5: Some potential, major gaps
- 6: Borderline qualified ($30-50K/month)
- 7-8: Solid lead ($50-150K+/month, clear pain)
- 9-10: Home run ($150K+/month, deeply engaged)
- Qualified threshold: score >= 6

## How to respond

- Use markdown formatting: **bold**, tables, bullet lists
- Be specific with numbers — don't say "several" when you can say "8"
- When analyzing transcripts, extract specific quotes and themes
- When comparing, use tables
- Keep responses concise but thorough
- If you need more data, use your tools — don't guess`);

  // Context-aware section
  if (ctx.scopedLeadName) {
    parts.push(`\n## Current Context
The user is currently looking at the lead detail for **${ctx.scopedLeadName}**${ctx.scopedLeadId ? ` (ID: ${ctx.scopedLeadId})` : ''}. Questions likely relate to this specific lead unless they explicitly ask about something else. Use get_lead_detail and get_transcript proactively for this lead.`);
  } else {
    parts.push(`\n## Current Context
The user is on the **${ctx.activeTab}** tab. Tailor your responses to what's relevant for this view.`);
  }

  return parts.join('\n');
}

// Suggested questions per tab context
export function getSuggestions(ctx: ChatContext): string[] {
  if (ctx.scopedLeadName) {
    return [
      'What happened on this call?',
      'What were their objections?',
      'Are they a good fit? Why or why not?',
      'Summarize the setter conversation',
      'What should the closer focus on next?',
      'How does this lead compare to our average?',
    ];
  }

  switch (ctx.activeTab) {
    case 'dashboard':
      return [
        "What's driving spend this week?",
        'Which ads have the best CPL?',
        'Show rate trends over the last 14 days',
        'Revenue breakdown by program',
        'Top performing campaigns right now',
        'Compare this week vs last week',
      ];
    case 'crm':
      return [
        'Commonalities in closed deals last 7 days',
        'Which leads are stuck in Qualified?',
        'Top objections from recent calls',
        'What ads resonated with closed leads?',
        'Marketing asset ideas from transcripts',
        'Leads with failed payments',
      ];
    case 'closers':
      return [
        'Compare top two closers this month',
        'Who has the most no-shows?',
        'Close rate by source',
        'Cash collected breakdown by closer',
        'Which closer handles objections best?',
        'Offer-to-close conversion rates',
      ];
    case 'reports':
      return [
        'CPL trend over last 30 days',
        'Which source has the best ROAS?',
        'Ad fatigue — any creatives declining?',
        'Lead quality by source',
        'Cost per qualified call by channel',
      ];
    default:
      return [
        'Give me a quick business health check',
        'What should I focus on today?',
        'Any red flags in the data?',
        'Top 3 wins this week',
        'Where are we losing money?',
      ];
  }
}
