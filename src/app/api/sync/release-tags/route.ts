import { getDb } from "@/lib/db";
import { extractYear } from "@/lib/release-tag";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const db = getDb();

  // Ensure "release" tag exists
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES ('release', '#f97316')").run();
  const tag = db.prepare("SELECT id FROM tags WHERE name = 'release'").get() as { id: number };
  const tagId = tag.id;

  // Get all games with release dates
  const games = db.prepare("SELECT id, release_date FROM games").all() as { id: number; release_date: string | null }[];

  // Collect all years needed
  const yearSet = new Set<string>();
  const gameYears = new Map<number, string>();
  for (const g of games) {
    const yr = extractYear(g.release_date);
    yearSet.add(yr);
    gameYears.set(g.id, yr);
  }

  // Create subtags for each year
  const years = [...yearSet].sort((a, b) => {
    if (a === "TBA") return 1;
    if (b === "TBA") return -1;
    return a.localeCompare(b);
  });

  const subtagIds = new Map<string, number>();
  for (const yr of years) {
    db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, 'meta')").run(tagId, yr);
    const row = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?").get(tagId, yr) as { id: number };
    subtagIds.set(yr, row.id);
  }

  // Remove old release tag assignments and re-assign
  let assigned = 0;
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM game_tags WHERE tag_id = ?").run(tagId);
    const ins = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)");
    for (const [gameId, yr] of gameYears) {
      const subId = subtagIds.get(yr);
      if (subId) {
        ins.run(gameId, tagId, subId);
        assigned++;
      }
    }
  });
  tx();

  // Clean up subtags with no games
  db.prepare(`
    DELETE FROM subtags WHERE tag_id = ? AND id NOT IN (
      SELECT DISTINCT subtag_id FROM game_tags WHERE tag_id = ? AND subtag_id IS NOT NULL
    )
  `).run(tagId, tagId);

  return NextResponse.json({ ok: true, years: years.length, assigned });
}
