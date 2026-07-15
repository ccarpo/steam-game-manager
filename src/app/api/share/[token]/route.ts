import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { GameWithTags } from "@/lib/types";

export const dynamic = "force-dynamic";

type ShareTokenRow = { token: string; name: string; filter_json: string; created_at: string; expires_at: string | null };

function loadGamesWithTags(): GameWithTags[] {
  const db = getDb();
  const games = db.prepare("SELECT * FROM games ORDER BY name").all() as GameWithTags[];
  const tagRows = db.prepare(
    `SELECT gt.*, t.name as tag_name, t.color as tag_color, s.name as subtag_name, s.type as subtag_type
     FROM game_tags gt
     JOIN tags t ON t.id = gt.tag_id
     LEFT JOIN subtags s ON s.id = gt.subtag_id`
  ).all() as { game_id: number; id: number; tag_id: number; tag_name: string; tag_color: string; subtag_id: number | null; subtag_name: string | null; subtag_type: "genre" | "meta" | null }[];

  const tagMap = new Map<number, typeof tagRows>();
  for (const row of tagRows) {
    if (!tagMap.has(row.game_id)) tagMap.set(row.game_id, []);
    tagMap.get(row.game_id)!.push(row);
  }
  for (const game of games) {
    game.tags = tagMap.get(game.id) || [];
  }
  return games;
}

function applyFilters(games: GameWithTags[], filter: Record<string, unknown>): GameWithTags[] {
  let result = games;

  const includeTags = filter.includeTags as number[] | undefined;
  const excludeTags = filter.excludeTags as number[] | undefined;
  const includeSubtags = filter.includeSubtags as number[] | undefined;
  const excludeSubtags = filter.excludeSubtags as number[] | undefined;
  const includeGenres = filter.includeGenres as string[] | undefined;
  const excludeGenres = filter.excludeGenres as string[] | undefined;
  const includeCommunityTags = filter.includeCommunityTags as string[] | undefined;
  const search = filter.search as string | undefined;

  if (includeTags?.length) {
    result = result.filter((g) => includeTags.every((tid) => g.tags.some((t) => t.tag_id === tid)));
  }
  if (excludeTags?.length) {
    result = result.filter((g) => !excludeTags.some((tid) => g.tags.some((t) => t.tag_id === tid)));
  }
  if (includeSubtags?.length) {
    result = result.filter((g) => includeSubtags.every((sid) => g.tags.some((t) => t.subtag_id === sid)));
  }
  if (excludeSubtags?.length) {
    result = result.filter((g) => !excludeSubtags.some((sid) => g.tags.some((t) => t.subtag_id === sid)));
  }
  if (includeGenres?.length) {
    result = result.filter((g) => {
      const genres: string[] = (() => { try { return JSON.parse(g.steam_genres); } catch { return []; } })();
      return includeGenres.every((gen) => genres.includes(gen));
    });
  }
  if (excludeGenres?.length) {
    result = result.filter((g) => {
      const genres: string[] = (() => { try { return JSON.parse(g.steam_genres); } catch { return []; } })();
      return !excludeGenres.some((gen) => genres.includes(gen));
    });
  }
  if (includeCommunityTags?.length) {
    result = result.filter((g) => {
      const ctags: string[] = (() => { try { return JSON.parse(g.community_tags); } catch { return []; } })();
      return includeCommunityTags.every((ct) => ctags.includes(ct));
    });
  }
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    result = result.filter((g) => g.name.toLowerCase().includes(q));
  }
  return result;
}

// GET /api/share/[token] — return filtered game list for this token
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM share_tokens WHERE token = ?").get(token) as ShareTokenRow | undefined;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (row.expires_at) {
    const exp = new Date(row.expires_at);
    exp.setHours(23, 59, 59, 999);
    if (exp < new Date()) return NextResponse.json({ error: "This share link has expired" }, { status: 410 });
  }

  let filter: Record<string, unknown> = {};
  try { filter = JSON.parse(row.filter_json); } catch { /* empty filter */ }

  const allGames = loadGamesWithTags();
  const games = applyFilters(allGames, filter);

  return NextResponse.json({ name: row.name, filter, games, created_at: row.created_at, expires_at: row.expires_at });
}

// DELETE /api/share/[token] — revoke token
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM share_tokens WHERE token = ?").run(token);
  if (result.changes === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
