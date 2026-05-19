'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Send, Loader2 } from 'lucide-react';
import type { ChatContext } from '@/lib/chat/systemPrompt';

interface AIChatPanelProps {
  activeTab: string;
  scopedLeadName?: string;
  scopedLeadId?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Inline markdown renderer for bold, tables, and bullets
function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    // Bold
    const parts = line.split(/\*\*(.*?)\*\*/g);
    const rendered = parts.map((part, j) =>
      j % 2 === 1 ? <strong key={j} className="text-white">{part}</strong> : part
    );
    return <p key={i} className={i > 0 ? 'mt-0.5' : ''}>{rendered}</p>;
  });
}

export default function AIChatPanel({ activeTab, scopedLeadName, scopedLeadId }: AIChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch suggestions when context changes
  useEffect(() => {
    const ctx: ChatContext = { activeTab, scopedLeadName, scopedLeadId };
    // Import dynamically to avoid server-only module in client
    fetch('/api/chat/suggestions?' + new URLSearchParams({
      tab: ctx.activeTab,
      ...(ctx.scopedLeadName ? { leadName: ctx.scopedLeadName } : {}),
    }))
      .then(r => r.json())
      .then(data => setSuggestions(data.suggestions ?? []))
      .catch(() => {
        // Fallback suggestions
        setSuggestions([
          'Give me a quick business health check',
          'What should I focus on today?',
          'Any red flags in the data?',
        ]);
      });
  }, [activeTab, scopedLeadName, scopedLeadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setStreamingText('');
    setToolStatus(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          context: { activeTab, scopedLeadName, scopedLeadId },
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7);
            // Next line should be data
            continue;
          }
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            // Determine event type from previous event line
            // Simple SSE parsing: we track the last event type
            if (data === '{}' || data === '') continue;

            try {
              // Try to parse as JSON first (tool/done/error events)
              const parsed = JSON.parse(data);
              if (parsed.label) {
                setToolStatus(parsed.label);
              } else if (parsed.message) {
                accumulated += `\n\nError: ${parsed.message}`;
                setStreamingText(accumulated);
              }
            } catch {
              // Not JSON — it's a text delta
              accumulated += data;
              setStreamingText(accumulated);
              setToolStatus(null);
            }
          }
        }
      }

      // Finalize: add assistant message
      if (accumulated) {
        setMessages(prev => [...prev, { role: 'assistant', content: accumulated }]);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `Sorry, something went wrong: ${(e as Error).message}` },
        ]);
      }
    } finally {
      setIsLoading(false);
      setStreamingText('');
      setToolStatus(null);
      abortRef.current = null;
    }
  }, [messages, isLoading, activeTab, scopedLeadName, scopedLeadId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-purple-600 hover:bg-purple-500 text-white rounded-full p-4 shadow-xl transition-all hover:scale-110"
        title="AI Intelligence"
      >
        <Sparkles size={24} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 z-50 w-[420px] h-[640px] bg-[#1a1d23] border border-gray-700 rounded-tl-2xl shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Intelligence</p>
            <p className="text-[10px] text-gray-400">
              {scopedLeadName ? scopedLeadName : `${activeTab} view`}
            </p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-gray-700 rounded text-gray-400">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-purple-700/30 flex items-center justify-center mx-auto mb-3">
              <Sparkles size={24} className="text-purple-400" />
            </div>
            <p className="text-white font-semibold text-sm mb-1">Ask anything</p>
            <p className="text-gray-400 text-xs mb-4">
              {scopedLeadName
                ? `Ask about ${scopedLeadName}'s call, objections, qualification...`
                : 'Ask about leads, performance, transcripts, trends...'}
            </p>
            <div className="space-y-1.5">
              {suggestions.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-gray-700 text-gray-300 text-xs hover:bg-gray-800 hover:border-gray-600 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[340px] rounded-lg px-3 py-2 text-xs leading-relaxed ${
              msg.role === 'user'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-200 border border-gray-700'
            }`}>
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[340px] rounded-lg px-3 py-2 text-xs leading-relaxed bg-gray-800 text-gray-200 border border-gray-700">
              {toolStatus && (
                <div className="flex items-center gap-1.5 text-purple-400 mb-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  <span className="text-[10px]">{toolStatus}</span>
                </div>
              )}
              {streamingText ? renderMarkdown(streamingText) : (
                !toolStatus && (
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <Loader2 size={12} className="animate-spin" />
                    <span>Thinking...</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={scopedLeadName ? `Ask about ${scopedLeadName}...` : 'Ask about your business...'}
            disabled={isLoading}
            rows={1}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="p-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-30 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
