import { getDb } from "@/lib/db";
import { getAiConfig } from "@/lib/ai";
import { blobToVector } from "@/lib/embeddings";
import { buildCatalogIndex } from "@/lib/catalog";
import { similarGames } from "@/lib/taste";
import { pushLog } from "@/lib/log-buffer";
import { NextRequest, NextResponse } from "next/server";
import type { CatalogEntry } from "@/lib/catalog-types";
import type { FlatIndex } from "@/lib/vector-index";

// GET /api/games/:id/similar — vector-based "more like this" across the catalog + library.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const source = db.prepare(
    `SELECT g.id, g.name, g.steam_appid, g.community_tags, g.steam_genres, g.positive_percent, g.total_reviews, g.developers,
            e.vector AS source_vector
     FROM games g
     LEFT JOIN embeddings e ON e.source = 'game' AND e.key = g.id
     WHERE g.id = ?`
  ).get(id) as {
    id: number; name: string; steam_appid: number; community_tags: string | null;
    steam_genres: string | null; positive_percent: number; total_reviews: number;
    developers: string | null; source_vector: Uint8Array | null;
  } | undefined;

  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const model = getAiConfig(db).embedModel;
  const ownedRows = db.prepare("SELECT DISTINCT steam_appid FROM games WHERE steam_appid IS NOT NULL").all() as { steam_appid: number }[];
  const ownedAppids = new Set<number>(ownedRows.map((r) => r.steam_appid));

  let sourceVec: Float32Array | null = null;
  if (source.source_vector) {
    sourceVec = blobToVector(source.source_vector);
  }

  // Fallback to tag-based similar games when no vector is available (AI not configured
  // or this game wasn't embedded yet). This preserves the existing behaviour.
  const selfAppid = source.steam_appid;
  if (!sourceVec) {
    return tagBasedFallback(db, source.id);
  }

  let developers: string[] = [];
  try {
    const parsed = JSON.parse(source.developers || "[]");
    if (Array.isArray(parsed)) developers = parsed.filter((x: unknown): x is string => typeof x === "string");
  } catch { /* ignore */ }

  const sourceMeta = {
    appid: selfAppid,
    name: source.name,
    tags: signalTags(source.community_tags, source.steam_genres),
    developers,
    reviewPositivePct: source.positive_percent || 0,
    reviewTotal: source.total_reviews || 0,
  };

  // Build the catalog index (it already excludes owned/wishlisted appids at ingest time)
  // so "more like this" can surface unowned catalog games, plus the source itself.
  const catalogIndex: FlatIndex<CatalogEntry> = buildCatalogIndex(db, model, {});
  ownedAppids.add(selfAppid);
  const sims = similarGames(catalogIndex, sourceVec, sourceMeta, ownedAppids, 8);

  return NextResponse.json(sims.map((s) => ({
    id: s.appid, // for catalog entries, appid is used as id because they aren't in the games table
    appid: s.appid,
    name: s.name,
    score: s.similarity,
    shared: s.tags.slice(0, 5),
    owned: s.owned,
    nonObvious: s.nonObvious,
  })));
}

function signalTags(community_tags: string | null, steam_genres: string | null): string[] {
  const parseList = (s: string | null): string[] => {
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        if (parsed.length && typeof parsed[0] === "string") return parsed as string[];
        return (parsed as { name?: string }[]).map((t) => t.name || "").filter(Boolean);
      }
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed as Record<string, number>)
          .sort((a, b) => (b[1] || 0) - (a[1] || 0))
          .map(([name]) => name);
      }
    } catch { /* ignore */ }
    return [];
  };
  const tags = parseList(community_tags);
  return tags.length ? tags : parseList(steam_genres);
}

// Legacy tag-only fallback for games without an embedding.
function tagBasedFallback(
  db: ReturnType<typeof getDb>,
  id: number | string,
): NextResponse {
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='game_similarities'"
    ).get();

    if (tableExists) {
      const rows = db.prepare(`
        SELECT gs.similar_id as id, g.name, g.steam_appid, gs.score, gs.shared
        FROM game_similarities gs
        JOIN games g ON g.id = gs.similar_id
        WHERE gs.game_id = ?
        ORDER BY gs.score DESC
        LIMIT 8
      `).all(id) as { id: number; name: string; steam_appid: number | null; score: number; shared: string }[];

      if (rows.length > 0) {
        return NextResponse.json(rows.map((r) => ({
          ...r,
          shared: safeJson(r.shared as unknown as string | null),
          owned: true,
          nonObvious: false,
        })));
      }
    }
  } catch (e) { pushLog("ERROR", `Similarity lookup failed for game ${id}: ${e}`); }

  const game = db.prepare("SELECT community_tags, steam_genres FROM games WHERE id = ?").get(id) as
    { community_tags: string | null; steam_genres: string | null } | undefined;
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const srcTags = signalTags(game.community_tags, game.steam_genres);
  if (srcTags.length === 0) return NextResponse.json([]);

  const srcTagWeights = new Map<string, number>();
  for (let i = 0; i < srcTags.length; i++) srcTagWeights.set(srcTags[i].toLowerCase(), 1 / (1 + i * 0.15));

  const others = db.prepare(
    "SELECT id, name, steam_appid, community_tags, steam_genres FROM games WHERE id != ?"
  ).all(id) as { id: number; name: string; steam_appid: number | null; community_tags: string | null; steam_genres: string | null }[];

  const scored: { id: number; name: string; steam_appid: number | null; score: number; shared: string[] }[] = [];
  for (const other of others) {
    const otherTags = signalTags(other.community_tags, other.steam_genres);
    const shared: string[] = [];
    let score = 0;
    for (let j = 0; j < otherTags.length; j++) {
      const w = srcTagWeights.get(otherTags[j].toLowerCase());
      if (w !== undefined) {
        score += w * (1 / (1 + j * 0.15));
        shared.push(otherTags[j]);
      }
    }
    if (score > 0.3) {
      scored.push({ id: other.id, name: other.name, steam_appid: other.steam_appid, score, shared: shared.slice(0, 5) });
    }
  }

  return NextResponse.json(
    scored.sort((a, b) => b.score - a.score).slice(0, 8).map((r) => ({ ...r, owned: true, nonObvious: false }))
  );
}

function safeJson(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    if (!Array.isArray(p)) return [];
    if (p.length > 0 && typeof p[0] === "object" && p[0].name) return p.map((t: { name: string }) => t.name);
    return p;
  } catch { return []; }
}
