import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();

  const total = (db.prepare("SELECT COUNT(*) as c FROM games").get() as { c: number }).c;
  const withAppid = (db.prepare("SELECT COUNT(*) as c FROM games WHERE steam_appid IS NOT NULL").get() as { c: number }).c;
  const withNotes = (db.prepare("SELECT COUNT(*) as c FROM games WHERE notes IS NOT NULL AND notes != ''").get() as { c: number }).c;
  const untagged = (db.prepare("SELECT COUNT(*) as c FROM games WHERE id NOT IN (SELECT DISTINCT game_id FROM game_tags)").get() as { c: number }).c;

  // Score distribution
  const scoreBuckets = db.prepare(`
    SELECT
      CASE
        WHEN positive_percent >= 90 THEN '90-100'
        WHEN positive_percent >= 80 THEN '80-89'
        WHEN positive_percent >= 70 THEN '70-79'
        WHEN positive_percent >= 60 THEN '60-69'
        WHEN positive_percent >= 50 THEN '50-59'
        WHEN positive_percent > 0 THEN '0-49'
        ELSE 'No reviews'
      END as bucket,
      COUNT(*) as count
    FROM games GROUP BY bucket ORDER BY bucket DESC
  `).all() as { bucket: string; count: number }[];

  // By tag (L0)
  const byTag = db.prepare(`
    SELECT t.name, t.color, COUNT(DISTINCT gt.game_id) as count
    FROM tags t JOIN game_tags gt ON gt.tag_id = t.id
    GROUP BY t.id ORDER BY count DESC
  `).all() as { name: string; color: string; count: number }[];

  // By subtag (top 20)
  const bySubtag = db.prepare(`
    SELECT t.name as tag, s.name as subtag, t.color, COUNT(DISTINCT gt.game_id) as count
    FROM subtags s JOIN tags t ON t.id = s.tag_id
    JOIN game_tags gt ON gt.subtag_id = s.id
    GROUP BY s.id ORDER BY count DESC LIMIT 20
  `).all() as { tag: string; subtag: string; color: string; count: number }[];

  // Top genres — via json_each() in SQLite
  const topGenres = db.prepare(`
    SELECT
      CASE
        WHEN json_type(j.value) = 'object' THEN json_extract(j.value, '$.name')
        ELSE j.value
      END as name,
    COUNT(*) as count
    FROM games, json_each(games.steam_genres) j
    WHERE games.steam_genres IS NOT NULL AND games.steam_genres != '[]'
    GROUP BY name HAVING name IS NOT NULL ORDER BY count DESC LIMIT 15
  `).all() as { name: string; count: number }[];

  // Top community tags — objects {name,count} or plain strings; extract .name when value is JSON object
  const topCommunityTags = db.prepare(`
    SELECT
      CASE
        WHEN json_type(j.value) = 'object' THEN json_extract(j.value, '$.name')
        ELSE j.value
      END as name,
      COUNT(*) as count
    FROM games, json_each(games.community_tags) j
    WHERE games.community_tags IS NOT NULL AND games.community_tags != '[]'
    GROUP BY name HAVING name IS NOT NULL ORDER BY count DESC LIMIT 15
  `).all() as { name: string; count: number }[];

  // Top developers — JSON array format via json_each(), comma-separated fallback in JS
  const topDevelopers = db.prepare(`
    SELECT trim(j.value) as name, COUNT(*) as count
    FROM games, json_each(
      CASE WHEN substr(trim(developers), 1, 1) = '[' THEN developers
           ELSE json_array(trim(developers))
      END
    ) j
    WHERE developers IS NOT NULL AND developers != '' AND developers != '[]'
      AND trim(j.value) != ''
    GROUP BY name ORDER BY count DESC LIMIT 10
  `).all() as { name: string; count: number }[];

  // By release year — extract 4-digit year in SQLite using substr+instr patterns
  const releaseYearsRaw = db.prepare(`
    SELECT
      CASE
        WHEN lower(trim(release_date)) IN ('coming soon', 'to be announced', 'tba') THEN 'TBA'
        WHEN lower(trim(release_date)) GLOB 'q[1-4] [0-9][0-9][0-9][0-9]' THEN substr(trim(release_date), -4)
        WHEN release_date GLOB '*[12][0-9][0-9][0-9]*'
          THEN substr(release_date, instr(release_date, substr(release_date, max(1, instr(release_date,'19') + instr(release_date,'20') - 1), 4)), 4)
        ELSE 'Unknown'
      END as year,
      COUNT(*) as count
    FROM games
    WHERE release_date IS NOT NULL AND release_date != ''
    GROUP BY year
  `).all() as { year: string; count: number }[];
  const releaseYears = releaseYearsRaw.sort((a, b) => {
    if (a.year === "TBA") return 1; if (b.year === "TBA") return -1;
    if (a.year === "Unknown") return 1; if (b.year === "Unknown") return -1;
    return a.year.localeCompare(b.year);
  });

  // Added over time (by month)
  const addedByMonth = db.prepare(`
    SELECT substr(added_at, 1, 7) as month, COUNT(*) as count
    FROM games WHERE added_at IS NOT NULL AND added_at != ''
    GROUP BY month ORDER BY month
  `).all() as { month: string; count: number }[];

  // Sentiment distribution
  const sentiments = db.prepare(`
    SELECT review_sentiment as sentiment, COUNT(*) as count
    FROM games WHERE review_sentiment IS NOT NULL AND review_sentiment != ''
    GROUP BY review_sentiment ORDER BY count DESC
  `).all() as { sentiment: string; count: number }[];

  // Average score
  const avgScore = (db.prepare("SELECT AVG(positive_percent) as avg FROM games WHERE positive_percent > 0").get() as { avg: number | null })?.avg || 0;
  const avgMetacritic = (db.prepare("SELECT AVG(metacritic_score) as avg FROM games WHERE metacritic_score > 0").get() as { avg: number | null })?.avg || 0;
  const totalScreenshots = (db.prepare("SELECT SUM(total_screenshots) as s FROM games").get() as { s: number | null })?.s || 0;
  const totalMovies = (db.prepare("SELECT SUM(total_movies) as s FROM games").get() as { s: number | null })?.s || 0;

  return NextResponse.json({
    total, withAppid, withNotes, untagged,
    avgScore: Math.round(avgScore), avgMetacritic: Math.round(avgMetacritic),
    totalScreenshots, totalMovies,
    scoreBuckets, byTag, bySubtag, topGenres, topCommunityTags, topDevelopers,
    releaseYears, addedByMonth, sentiments,
  });
}
