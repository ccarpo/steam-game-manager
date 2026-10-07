import { getDb } from "@/lib/db";
import { classifyGames } from "@/lib/classify";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// POST /api/classify?mode=new|all
export async function POST(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode") === "all" ? "all" : "new";
  const db = getDb();
  const result = classifyGames(db, { mode });
  return NextResponse.json({ ok: true, ...result });
}
