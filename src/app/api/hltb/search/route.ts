import { HltbClient, secondsToHours } from "@/lib/hltb";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/hltb/search?q= — top 5 HLTB results with hours converted
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });
  try {
    const client = await HltbClient.create();
    let results;
    try {
      results = await client.search(q, 5);
    } catch {
      // one auth refresh + retry before giving up
      await client.refreshAuth();
      results = await client.search(q, 5);
    }
    return NextResponse.json(results.map((r) => ({
      hltb_id: r.gameId,
      hltb_name: r.gameName,
      main_hours: secondsToHours(r.compMain),
      extra_hours: secondsToHours(r.compPlus),
      completionist_hours: secondsToHours(r.comp100),
    })));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
