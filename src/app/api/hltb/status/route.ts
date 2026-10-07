import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/hltb/status — counts for the Settings page
export function GET() {
  const db = getDb();
  const row = db.prepare(
    `SELECT
       SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched,
       SUM(CASE WHEN match_status = 'no_match' THEN 1 ELSE 0 END) AS no_match
     FROM hltb`
  ).get() as { matched: number | null; no_match: number | null };
  const candidates = db.prepare(
    `SELECT COUNT(DISTINCT g.id) AS c FROM games g
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
     JOIN subtags s ON s.id = gt.subtag_id AND s.name IN ('owned', 'wishlist')
     WHERE g.steam_appid IS NOT NULL
       AND COALESCE(LOWER(g.app_type), '') NOT IN ('dlc', 'music', 'video', 'demo', 'advertising', 'tool')`
  ).get() as { c: number };
  const fetched = (row.matched || 0) + (row.no_match || 0);
  return NextResponse.json({
    matched: row.matched || 0,
    noMatch: row.no_match || 0,
    notFetched: Math.max(0, candidates.c - fetched),
  });
}
