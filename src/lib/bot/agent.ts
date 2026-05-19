// Bot agent loop: Claude with tool-use. Runs a bounded loop (max 8 iterations),
// invokes tools from src/lib/bot/tools.ts, returns the final assistant text.
//
// Kept deliberately small — no streaming, no persistence, no history.
// Each Slack @mention starts a fresh conversation. Thread context is passed
// in as prior messages if the message is inside a thread.

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, dispatchTool } from './tools';

const MODEL = 'claude-opus-4-5-20250929';
const MAX_ITERATIONS = 8;
const SYSTEM_PROMPT = `You are the LS Command dashboard assistant. You help the operator and his team investigate and fix data issues in the tracking-dashboard Supabase + the source systems that feed it (GHL, Grain, Calendly, Meta, Slack, Whop).

You operate inside a Slack channel. Keep responses TIGHT and actionable — Slack formatting, short paragraphs, bullet lists where useful. Never dump 1000 tokens of explanation.

Core tables:
- t01_leads       — lead records from GHL (email, phone, source, campaign/adset/ad names, qualification answers)
- t03_bookings    — sales call bookings from Calendly (status: Showed / No Showed / Cancelled / Rescheduled / Needs Review)
- t04_call_recordings — Grain call recordings (duration_min, prospect_name, transcript_txt_url)
- t06_deals_closed — signed deals from #new-clients Slack channel
- t07_income_processors — payments from Whop / Fanbasis
- t05_eod_reports — closer EODs from Slack
- t20_slack_new_clients — parsed #new-clients messages
- t19_payment_notis — parsed #payment-notifications messages
- t18_manychat_leads — ManyChat Instagram DM leads
- t12_content_youtube — YouTube videos + attribution

Booking status rules (hard):
- Showed: valid Grain ≥10min OR #new-clients match OR demo-call-notes non-No-Show OR GHL post-call pipeline stage
- No Showed: demo-call-notes "Call No Show" OR GHL pipeline "No Show" OR 3+ unanswered team follow-ups post-booking
- Rescheduled: a later booking exists for the same identity (lead_id / email / phone / name)
- Cancelled: Calendly canceled + no rebook + no show signal
- Needs Review: anything ambiguous. Prefer this over guessing.

When investigating:
1. Use check_freshness first if the question is "is X broken?"
2. Use get_lead for specific-person questions
3. Use get_ghl_contact when Supabase data is missing/suspect and you need the source
4. Use run_sync to backfill after a fix
5. Use update_booking_status only when a human in the thread has given you an explicit override

NEVER invent data. If you don't know, say so and run a tool. If a tool errors, report the error verbatim — don't paper over it.

When you're done, respond with the final answer only. Don't narrate tool use — the user will see the tool calls inline.`;

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function runAgent(
  userText: string,
  priorMessages: AgentMessage[] = [],
): Promise<{ text: string; toolCalls: Array<{ name: string; input: unknown }>; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: 'ANTHROPIC_API_KEY not configured.', toolCalls: [], error: 'no_key' };

  const client = new Anthropic({ apiKey });

  // Seed the conversation with prior thread context, then the current message
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    ...priorMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userText },
  ];
  const toolCalls: Array<{ name: string; input: unknown }> = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      // @ts-expect-error — tool typing in SDK is permissive on input_schema
      tools: TOOL_DEFINITIONS,
      messages: messages as never,
    });

    const toolUses = response.content.filter((b: { type: string }) => b.type === 'tool_use');
    const textBlocks = response.content.filter((b: { type: string }) => b.type === 'text');

    if (toolUses.length === 0) {
      const finalText = textBlocks.map((b: { type: string; text?: string }) => b.text ?? '').join('').trim();
      return { text: finalText || '(no response)', toolCalls };
    }

    // Execute tool calls and append results
    messages.push({ role: 'assistant', content: response.content });
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    for (const tu of toolUses as Array<{ id: string; name: string; input: unknown }>) {
      toolCalls.push({ name: tu.name, input: tu.input });
      const result = await dispatchTool(tu.name, tu.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 20000),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return {
    text: 'Hit max tool iterations without a final answer. Try rephrasing.',
    toolCalls,
    error: 'max_iterations',
  };
}
