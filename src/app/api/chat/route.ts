import { getDb } from "@/lib/db";
import { getAiConfig, getAiProvider } from "@/lib/ai";
import { buildChatContext } from "@/lib/chat-context";
import { AiError } from "@/lib/ai";
import type { ChatMessage } from "@/lib/ai";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

const MAX_HISTORY = 20; // keep context small for local 8B models
const MAX_MSG_CHARS = 4000;

/**
 * POST /api/chat — { messages: [{role, content}] } → { reply, model, stats }
 * The system prompt is rebuilt per request from live library/taste data, so
 * answers always reflect the current DB, not a snapshot.
 */
export async function POST(req: NextRequest) {
  let body: { messages?: { role?: string; content?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const history: ChatMessage[] = (body.messages || [])
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }))
    .slice(-MAX_HISTORY);

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "messages must end with a user turn" }, { status: 400 });
  }

  const db = getDb();
  const cfg = getAiConfig(db);
  const provider = getAiProvider(db);
  if (!provider) {
    return NextResponse.json(
      { error: "AI provider not configured — set a base URL in Settings › AI." },
      { status: 400 },
    );
  }

  const { systemPrompt, stats } = buildChatContext(db, cfg.embedModel);
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...history];

  try {
    // Reasoning models (qwen3) spend completion tokens on hidden thinking before
    // the answer, so the budget must cover both — 1200 starves replies to empty.
    const reply = (await provider.chat(messages, { temperature: 0.4, maxTokens: 4000 })).trim();
    return NextResponse.json({ reply, model: cfg.chatModel, stats });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("network", String(e));
    const status = err.kind === "config" ? 400 : err.kind === "http" && err.status ? err.status : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
}
