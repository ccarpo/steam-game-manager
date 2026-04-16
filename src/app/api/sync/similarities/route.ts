import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

function safeJson(s: string | null): string[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    if (!Array.isArray(p)) return [];
    if (p.length > 0 && typeof p[0] === "object" && p[0].name) return p.map((t: { name: string }) => t.name);
    return p;
  } catch { return []; }
}

// POST /api/sync/similarities — pre-compute similarity scores for all games
export async function POST() {
  const db = getDb();

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_similarities (
      game_id INTEGER NOT NULL,
      similar_id INTEGER NOT NULL,
      score REAL NOT NULL,
      shared TEXT DEFAULT '[]',
      PRIMARY KEY (game_id, similar_id),
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (similar_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  const games = db.prepare(
    "SELECT id, community_tags, steam_genres FROM games"
  ).all() as { id: number; community_tags: string | null; steam_genres: string | null }[];

  // Build tag weights + genre sets for all games
  const gameData = games.map((g) => {
    const tags = safeJson(g.community_tags);
    const genres = safeJson(g.steam_genres);
    const tagWeights = new Map<string, number>();
    for (let i = 0; i < tags.length; i++) {
      tagWeights.set(tags[i].toLowerCase(), 1 / (1 + i * 0.15));
    }
    const genreSet = new Set(genres.map((x) => x.toLowerCase()));
    return { id: g.id, tags, tagWeights, genreSet };
  });

  // Clear old data
  db.exec("DELETE FROM game_similarities");

  const insert = db.prepare(
    "INSERT INTO game_similarities (game_id, similar_id, score, shared) VALUES (?, ?, ?, ?)"
  );

  let totalPairs = 0;

  const tx = db.transaction(() => {
    for (let i = 0; i < gameData.length; i++) {
      const src = gameData[i];
      if (src.tagWeights.size === 0 && src.genreSet.size === 0) continue;

      const scored: { id: number; score: number; shared: string[] }[] = [];

      for (let j = 0; j < gameData.length; j++) {
        if (i === j) continue;
        const other = gameData[j];

        let score = 0;
        const shared: string[] = [];

        // Community tag matching with position-weighted scoring
        for (const [tag, otherIdx] of other.tagWeights) {
          const srcWeight = src.tagWeights.get(tag);
          if (srcWeight !== undefined) {
            score += srcWeight * (1 / (1 + otherIdx * 0.15));
            // Find original-case tag name
            const origTag = other.tags.find((t) => t.toLowerCase() === tag);
            if (origTag) shared.push(origTag);
          }
        }

        // Genre matching
        for (const g of other.genreSet) {
          if (src.genreSet.has(g)) score += 0.15;
        }

        if (score > 0.3) {
          scored.push({ id: other.id, score, shared: shared.slice(0, 5) });
        }
      }

      // Keep top 8 per game
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored.slice(0, 8)) {
        insert.run(src.id, s.id, s.score, JSON.stringify(s.shared));
        totalPairs++;
      }
    }
  });

  tx();

  return NextResponse.json({ ok: true, games: games.length, pairs: totalPairs });
}
