import { getDb } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/ai/models — model ids reported by the provider
export async function GET() {
  const provider = getAiProvider(getDb());
  if (!provider) return NextResponse.json({ error: "No AI base URL configured (Settings › AI)." }, { status: 400 });
  try {
    return NextResponse.json({ models: await provider.listModels() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
