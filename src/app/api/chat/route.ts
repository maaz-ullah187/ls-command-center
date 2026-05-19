import { getLeads } from '@/lib/dataSources';
import { CHAT_TOOLS, handleToolCall } from '@/lib/chat/tools';
import { buildSystemPrompt, type ChatContext } from '@/lib/chat/systemPrompt';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';

// Node.js v24's built-in fetch (undici) cannot connect to api.anthropic.com
// (ETIMEDOUT on IPv4, EHOSTUNREACH on IPv6). Use node-fetch as a workaround.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFetchModule = require('node-fetch');
const nodeFetch = nodeFetchModule.default ?? nodeFetchModule;

export const maxDuration = 120;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Read ANTHROPIC_API_KEY from .env.local as fallback when the shell env has an
// empty value (e.g. Claude Code sets ANTHROPIC_API_KEY="" which prevents
// Next.js from loading the .env.local value).
function getAnthropicApiKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;
  try {
    const envFile = readFileSync(join(process.cwd(), '.env.local'), 'utf-8');
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  context: ChatContext;
}

export async function POST(request: Request) {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = (await request.json()) as ChatRequest;
  const { messages, context } = body;

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Prevent the SDK from picking up stale/empty env vars (e.g. from Claude Code shell).
  // Use globalThis.fetch directly — Next.js may patch the module-scope `fetch` with
  // caching behaviour that causes ETIMEDOUT on long streaming requests.
  delete process.env.ANTHROPIC_BASE_URL;
  const client = new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com', fetch: nodeFetch });
  const systemPrompt = buildSystemPrompt(context);

  // Pre-fetch leads once for tool handlers
  const leads = await getLeads();

  // Build Anthropic message format
  const anthropicMessages: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      }

      try {
        // Tool-use loop: Claude may call tools multiple times before giving a final answer
        let currentMessages = [...anthropicMessages];
        let iterations = 0;
        const maxIterations = 5;

        while (iterations < maxIterations) {
          iterations++;

          const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            tools: CHAT_TOOLS,
            messages: currentMessages,
            stream: true,
          });

          let fullText = '';
          let toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          let currentToolId = '';
          let currentToolName = '';
          let currentToolInput = '';

          for await (const event of response) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'text') {
                // Text block starting
              } else if (event.content_block.type === 'tool_use') {
                currentToolId = event.content_block.id;
                currentToolName = event.content_block.name;
                currentToolInput = '';
                // Notify client about tool call
                const toolLabel = {
                  search_leads: 'Searching leads...',
                  get_lead_detail: 'Loading lead details...',
                  get_transcript: 'Reading transcript...',
                  get_conversations: 'Loading conversations...',
                  get_metrics: 'Fetching metrics...',
                  get_ads: 'Analyzing ads...',
                }[currentToolName] ?? 'Processing...';
                send('tool', JSON.stringify({ name: currentToolName, label: toolLabel }));
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                fullText += event.delta.text;
                send('text', event.delta.text);
              } else if (event.delta.type === 'input_json_delta') {
                currentToolInput += event.delta.partial_json;
              }
            } else if (event.type === 'content_block_stop') {
              if (currentToolId) {
                try {
                  const parsedInput = currentToolInput ? JSON.parse(currentToolInput) : {};
                  toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: parsedInput });
                } catch {
                  toolUseBlocks.push({ id: currentToolId, name: currentToolName, input: {} });
                }
                currentToolId = '';
                currentToolName = '';
                currentToolInput = '';
              }
            }
          }

          // If no tool calls, we're done
          if (toolUseBlocks.length === 0) break;

          // Execute tool calls and continue the conversation
          const assistantContent: Anthropic.ContentBlockParam[] = [];
          if (fullText) {
            assistantContent.push({ type: 'text', text: fullText });
          }
          for (const tool of toolUseBlocks) {
            assistantContent.push({
              type: 'tool_use',
              id: tool.id,
              name: tool.name,
              input: tool.input,
            });
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: assistantContent },
          ];

          // Add tool results
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tool of toolUseBlocks) {
            const result = await handleToolCall(tool.name, tool.input, leads);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tool.id,
              content: result,
            });
          }

          currentMessages.push({ role: 'user', content: toolResults });
          toolUseBlocks = [];
          fullText = '';
        }

        send('done', '{}');
      } catch (e) {
        send('error', JSON.stringify({ message: e instanceof Error ? e.message : 'Unknown error' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
