import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

function countFromColumn(db: ReturnType<typeof getDb>, column: string): { name: string; count: number }[] {
  return db.prepare(`
    WITH labels AS (
      SELECT CASE
        WHEN substr(trim(j.value), 1, 1) = '{' THEN trim(json_extract(j.value, '$.name'))
        ELSE trim(j.value)
      END AS label
      FROM games, json_each(games.${column}) j
      WHERE games.${column} IS NOT NULL AND games.${column} != '[]' AND games.${column} != ''
        AND json_valid(games.${column})
    )
    SELECT MIN(label) AS name, COUNT(*) AS count
    FROM labels
    WHERE label IS NOT NULL AND label != ''
    GROUP BY lower(label)
    ORDER BY count DESC, name COLLATE NOCASE
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
