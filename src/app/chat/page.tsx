"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";

interface Msg { role: "user" | "assistant"; content: string }
interface Stats {
  owned: number; unstarted: number; inProgress: number;
  withHltb: number; hasTasteVector: boolean; confidence: string;
}

const SUGGESTIONS = [
  "What should I play tonight? I have about 2 hours.",
  "Recommend something short I haven't started yet.",
  "What am I in the middle of that I should finish?",
  "What's on my wishlist that I'd actually play?",
  "What kinds of games do I keep bouncing off?",
];

/** Minimal renderer for the markdown local models emit: **bold**, *italic*, `code`. */
function Md({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let key = 0;
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={key++} className="bg-border/40 rounded px-1">{tok.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
      setMessages([...next, { role: "assistant", content: data.reply }]);
      setStats(data.stats || null);
      setModel(data.model || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Roll the failed user turn back so it isn't stuck in history.
      setMessages(messages);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [messages, busy]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <div className="max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0 p-4 gap-3">
        {/* Header */}
        <div className="flex items-center gap-4 shrink-0">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">💬 Play Next</h1>
          <span className="text-[11px] text-muted">
            {model ? `chat · ${model}` : "chat with your library"}
            {stats ? ` · ${stats.unstarted} unstarted · ${stats.inProgress} in progress` : ""}
          </span>
          <div className="flex-1" />
          {messages.length > 0 && (
            <button onClick={() => { setMessages([]); setError(null); }}
              className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent">
              Clear
            </button>
          )}
          <Link href="/settings?tab=ai" className="text-xs text-muted hover:text-foreground">⚙️ AI</Link>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {messages.length === 0 && (
            <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
              <p className="text-sm">Ask about your library — it knows your taste profile, playtime, completions, and how long each game takes.</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} disabled={busy}
                    className="px-2.5 py-1.5 rounded-full text-xs border border-border text-muted hover:text-foreground hover:border-accent disabled:opacity-50 text-left">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-accent/15 border border-accent/30"
                  : "bg-surface border border-border"
              }`}>
                {m.role === "assistant" ? <Md text={m.content} /> : m.content}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-muted">
                Thinking…
              </div>
            </div>
          )}

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-xs text-danger">
              {error}
              {error.includes("Settings") && (
                <> — <Link href="/settings?tab=ai" className="underline">open AI settings</Link></>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="What should I play next? (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-accent"
          />
          <button onClick={() => send(input)} disabled={busy || !input.trim()}
            className="px-4 py-2 rounded-lg text-sm bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
