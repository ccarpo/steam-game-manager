import { getDb } from "@/lib/db";
import { extractYear } from "@/lib/release-tag";
import { AUTO_TAG_NAME, getScoreBucket, ensureAutoTag } from "@/lib/auto-tags";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Bulk sync: create/update auto tag with typed subtags, assign all games. */
function syncAutoSubtags(
  db: ReturnType<typeof getDb>,
  autoTagId: number,
  type: string,
  games: { id: number; value: string }[],
) {
  // Collect all values
  const valueSet = new Set<string>();
  const gameValues = new Map<number, string>();
  for (const g of games) { valueSet.add(g.value); gameValues.set(g.id, g.value); }

  // Create subtags
  const subtagIds = new Map<string, number>();
  for (const v of valueSet) {
    db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, ?)").run(autoTagId, v, type);
    const row = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ? AND type = ?").get(autoTagId, v, type) as { id: number };
    subtagIds.set(v, row.id);
  }

  // Get all subtag ids for this type to clear old assignments
  const allTypeSubIds = (db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND type = ?").all(autoTagId, type) as { id: number }[]).map(r => r.id);

  let assigned = 0;
  const tx = db.transaction(() => {
    // Remove old assignments for this type only
    if (allTypeSubIds.length > 0) {
      db.prepare(`DELETE FROM game_tags WHERE tag_id = ? AND subtag_id IN (${allTypeSubIds.join(",")})`).run(autoTagId);
    }
    const ins = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)");
    for (const [gameId, val] of gameValues) {
      const subId = subtagIds.get(val);
      if (subId) { ins.run(gameId, autoTagId, subId); assigned++; }
    }
  });
  tx();

  // Clean up empty subtags for this type
  db.prepare(`DELETE FROM subtags WHERE tag_id = ? AND type = ? AND id NOT IN (
    SELECT DISTINCT subtag_id FROM game_tags WHERE tag_id = ? AND subtag_id IS NOT NULL
  )`).run(autoTagId, type, autoTagId);

  return assigned;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const which = url.searchParams.get("tags") || "all";
  const db = getDb();
  const autoTagId = ensureAutoTag(db);
  const results: Record<string, number> = {};

  const allGames = db.prepare("SELECT id, release_date, review_sentiment, positive_percent, total_reviews FROM games").all() as {
    id: number; release_date: string | null; review_sentiment: string | null; positive_percent: number; total_reviews: number;
  }[];

  if (which === "all" || which === "release") {
    results.release = syncAutoSubtags(db, autoTagId, "release",
      allGames.map(g => ({ id: g.id, value: extractYear(g.release_date) }))
    );
  }

  if (which === "all" || which === "sentiment") {
    const withSentiment = allGames.filter(g => g.review_sentiment && g.review_sentiment.trim());
    results.sentiment = syncAutoSubtags(db, autoTagId, "sentiment",
      withSentiment.map(g => ({ id: g.id, value: g.review_sentiment! }))
    );
  }

  if (which === "all" || which === "score") {
    const withScore = allGames.filter(g => g.total_reviews > 0);
    results.score = syncAutoSubtags(db, autoTagId, "score",
      withScore.map(g => ({ id: g.id, value: getScoreBucket(g.positive_percent, g.total_reviews, db) }))
    );
  }

  return NextResponse.json({ ok: true, ...results });
}
