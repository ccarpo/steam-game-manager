import { getDb } from "@/lib/db";
import { getAiConfig, getAiProvider } from "@/lib/ai";
import { redactUrlCredentials } from "@/lib/ai/provider";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/ai/health — connection probe. Never echoes back the API key, nor any
// credentials embedded in the base URL.
export async function GET() {
  const db = getDb();
  const cfg = getAiConfig(db);
  const provider = getAiProvider(db);
  const summary = {
    baseUrl: redactUrlCredentials(cfg.baseUrl),
    embedModel: cfg.embedModel,
    chatModel: cfg.chatModel,
    flavor: cfg.flavor,
    hasApiKey: cfg.apiKey.length > 0,
  };
  if (!provider) {
    return NextResponse.json({ ok: false, detail: "No AI base URL configured (Settings › AI).", ...summary });
  }
  const health = await provider.health();
  return NextResponse.json({ ...health, ...summary });
}
