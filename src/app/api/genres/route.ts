import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

function countFromColumn(db: ReturnType<typeof getDb>, column: string): { name: string; count: number }[] {
  return db.prepare(`
    SELECT
      CASE
        WHEN substr(trim(j.value),1,1) = '{' THEN trim(json_extract(j.value, '$.name'))
        ELSE trim(j.value)
      END as name,
      COUNT(*) as count
    FROM games, json_each(games.${column}) j
    WHERE games.${column} IS NOT NULL AND games.${column} != '[]' AND games.${column} != ''
      AND json_valid(games.${column})
    GROUP BY name HAVING name IS NOT NULL AND name != ''
    ORDER BY count DESC
  `).all() as { name: string; count: number }[];
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
