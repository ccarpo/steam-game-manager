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

  // Top genres
  const allGenres: Record<string, number> = {};
  const rows = db.prepare("SELECT steam_genres FROM games WHERE steam_genres != '[]'").all() as { steam_genres: string }[];
  for (const r of rows) {
    try { for (const g of JSON.parse(r.steam_genres)) allGenres[g] = (allGenres[g] || 0) + 1; } catch {}
  }
  const topGenres = Object.entries(allGenres).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count }));

  // Top community tags
  const allCTags: Record<string, number> = {};
  const cRows = db.prepare("SELECT community_tags FROM games WHERE community_tags != '[]'").all() as { community_tags: string }[];
  for (const r of cRows) {
    try { const arr = JSON.parse(r.community_tags); for (const t of arr) { const name = typeof t === "object" && t.name ? t.name : t; if (typeof name === "string") allCTags[name] = (allCTags[name] || 0) + 1; } } catch {}
  }
  const topCommunityTags = Object.entries(allCTags).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count }));

  // Top developers
  const allDevs: Record<string, number> = {};
  const dRows = db.prepare("SELECT developers FROM games WHERE developers != '' AND developers != '[]'").all() as { developers: string }[];
  for (const r of dRows) {
    try {
      const arr = r.developers.startsWith("[") ? JSON.parse(r.developers) : r.developers.split(",").map((s: string) => s.trim());
      for (const d of arr) if (d) allDevs[d] = (allDevs[d] || 0) + 1;
    } catch {}
  }
  const topDevelopers = Object.entries(allDevs).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

  // By release year
  const byYear: Record<string, number> = {};
  const yRows = db.prepare("SELECT release_date FROM games WHERE release_date IS NOT NULL AND release_date != ''").all() as { release_date: string }[];
  for (const r of yRows) {
    const ym = r.release_date.match(/\b(19|20)\d{2}\b/);
    const low = r.release_date.toLowerCase().trim();
    let yr = "Unknown";
    if (low === "coming soon" || low === "to be announced" || low === "tba") yr = "TBA";
    else if (low.match(/^q[1-4]\s+\d{4}$/)) yr = low.slice(-4);
    else if (ym) yr = ym[0];
    byYear[yr] = (byYear[yr] || 0) + 1;
  }
  const releaseYears = Object.entries(byYear)
    .sort((a, b) => { if (a[0] === "TBA") return 1; if (b[0] === "TBA") return -1; if (a[0] === "Unknown") return 1; if (b[0] === "Unknown") return -1; return a[0].localeCompare(b[0]); })
    .map(([year, count]) => ({ year, count }));

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
