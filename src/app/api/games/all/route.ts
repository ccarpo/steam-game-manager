import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

// GET /api/games/all — returns ALL games with tags in one shot (for client-side filtering)
export function GET() {
  const db = getDb();

  const games = db.prepare("SELECT * FROM games ORDER BY name").all() as { id: number; steam_appid: number | null; tags?: unknown[]; metadata_missing?: boolean }[];
  const metadataCache = new Map<number, string>();
  for (const row of db.prepare("SELECT appid, appdetails FROM steam_cache WHERE appdetails IS NOT NULL AND appdetails != ''").all() as { appid: number; appdetails: string }[]) {
    metadataCache.set(row.appid, row.appdetails);
  }
  for (const game of games) {
    if (!game.steam_appid) continue;
    try {
      const payload = JSON.parse(metadataCache.get(game.steam_appid) || "") as Record<string, { success?: boolean }>;
      game.metadata_missing = payload[String(game.steam_appid)]?.success !== true;
    } catch {
      game.metadata_missing = true;
    }
  }

  // Fetch all game_tags in one query
  const tagRows = db.prepare(
    `SELECT gt.*, t.name as tag_name, t.color as tag_color, s.name as subtag_name, s.type as subtag_type
     FROM game_tags gt
     JOIN tags t ON t.id = gt.tag_id
     LEFT JOIN subtags s ON s.id = gt.subtag_id
     ORDER BY t.name, s.name`
  ).all() as { game_id: number }[];

  const tagMap = new Map<number, typeof tagRows>();
  for (const row of tagRows) {
    if (!tagMap.has(row.game_id)) tagMap.set(row.game_id, []);
    tagMap.get(row.game_id)!.push(row);
  }

  const classMap = new Map<number, { category: string; reason: string; confidence: string; override_category: string | null }>();
  for (const row of db.prepare("SELECT game_id, category, reason, confidence, override_category FROM game_classification").all() as { game_id: number; category: string; reason: string; confidence: string; override_category: string | null }[]) {
    classMap.set(row.game_id, row);
  }

  const hltbMap = new Map<number, { main_hours: number | null; extra_hours: number | null; completionist_hours: number | null; match_status: string; hltb_id: number | null; hltb_name: string | null }>();
  for (const row of db.prepare("SELECT appid, hltb_id, hltb_name, main_hours, extra_hours, completionist_hours, match_status FROM hltb").all() as { appid: number; hltb_id: number | null; hltb_name: string | null; main_hours: number | null; extra_hours: number | null; completionist_hours: number | null; match_status: string }[]) {
    hltbMap.set(row.appid, row);
  }

  for (const game of games) {
    game.tags = tagMap.get(game.id) || [];
    const cls = classMap.get(game.id);
    if (cls) (game as Record<string, unknown>).classification = cls;
    const h = game.steam_appid != null ? hltbMap.get(game.steam_appid) : undefined;
    if (h) (game as Record<string, unknown>).hltb = h;
  }

  return NextResponse.json(games);
}
