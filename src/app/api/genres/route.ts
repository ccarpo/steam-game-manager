import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

function countFromColumn(db: ReturnType<typeof getDb>, column: string) {
  const rows = db
    .prepare(`SELECT ${column} FROM games WHERE ${column} IS NOT NULL AND ${column} != '[]' AND ${column} != ''`)
    .all() as Record<string, string>[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row[column]);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        const name = typeof item === "object" && item.name ? item.name : typeof item === "string" ? item : null;
        if (name) counts.set(name.trim(), (counts.get(name.trim()) || 0) + 1);
      }
    } catch { /* skip */ }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// GET /api/genres — returns genres, features, and community tags separately
export function GET() {
  const db = getDb();

  return NextResponse.json({
    genres: countFromColumn(db, "steam_genres"),
    features: countFromColumn(db, "steam_features"),
    communityTags: countFromColumn(db, "community_tags"),
  });
}
