import { getDb } from "@/lib/db";
import { loadCatalog } from "@/lib/catalog";
import { parseReleaseDate } from "@/lib/date-parse";
import { parseTags } from "@/lib/taste-data";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface ReleaseItem {
  key: string;
  appid: number | null;
  name: string;
  source: "owned" | "wishlist" | "unowned";
  releaseDate: string;       // raw string
  releaseIso: string;        // parsed YYYY-MM-DD
  timestamp: number;
  owned: boolean;
  wishlisted: boolean;
  tags: string[];
  genres: string[];
  positivePercent: number;
  totalReviews: number;
  headerUrl: string;
}

function headerUrl(appid: number | null, external: string): string {
  if (appid) return `/api/assets/${appid}/header.jpg`;
  return external || "";
}

/**
 * GET /api/releases?owned=1&wishlist=1&unowned=1&limit=200
 * Returns upcoming releases from owned, wishlist and/or unowned catalog games,
 * sorted by release date ascending.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const wantOwned = sp.get("owned") !== "0";
  const wantWishlist = sp.get("wishlist") === "1";
  const wantUnowned = sp.get("unowned") === "1";
  const limit = Math.min(1000, Math.max(1, parseInt(sp.get("limit") || "200", 10) || 200));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();

  const items: ReleaseItem[] = [];

  if (wantOwned || wantWishlist) {
    const conditions: string[] = ["release_date != ''"];
    const params: (string | number)[] = [];
    const joins: string[] = [];

    // Use the steam tag to tell owned vs wishlist apart.
    joins.push("JOIN tags t ON t.name = 'steam'");
    joins.push("JOIN subtags s_owned ON s_owned.tag_id = t.id AND s_owned.name = 'owned'");
    joins.push("JOIN subtags s_wish ON s_wish.tag_id = t.id AND s_wish.name = 'wishlist'");
    joins.push("LEFT JOIN game_tags gt_owned ON gt_owned.game_id = g.id AND gt_owned.tag_id = t.id AND gt_owned.subtag_id = s_owned.id");
    joins.push("LEFT JOIN game_tags gt_wish ON gt_wish.game_id = g.id AND gt_wish.tag_id = t.id AND gt_wish.subtag_id = s_wish.id");

    const want = [];
    if (wantOwned) want.push("gt_owned.game_id IS NOT NULL");
    if (wantWishlist) want.push("gt_wish.game_id IS NOT NULL");
    conditions.push(`(${want.join(" OR ")})`);

    const rows = db.prepare(`
      SELECT DISTINCT g.id, g.name, g.steam_appid, g.release_date, g.steam_genres,
             g.community_tags, g.positive_percent, g.total_reviews,
             CASE WHEN gt_owned.game_id IS NOT NULL THEN 1 ELSE 0 END AS is_owned,
             CASE WHEN gt_wish.game_id IS NOT NULL THEN 1 ELSE 0 END AS is_wish
      FROM games g
      ${joins.join("\n")}
      WHERE ${conditions.join(" AND ")}
    `).all(...params) as {
      id: number; name: string; steam_appid: number; release_date: string;
      steam_genres: string | null; community_tags: string | null;
      positive_percent: number; total_reviews: number; is_owned: number; is_wish: number;
    }[];

    for (const r of rows) {
      const iso = parseReleaseDate(r.release_date);
      if (!iso) continue;
      const ts = new Date(iso + "T00:00:00").getTime();
      if (ts < todayTs) continue;
      const owned = r.is_owned === 1;
      const wishlisted = r.is_wish === 1 && !owned;
      items.push({
        key: `g:${r.id}`,
        appid: r.steam_appid,
        name: r.name,
        source: owned ? "owned" : "wishlist",
        releaseDate: r.release_date,
        releaseIso: iso,
        timestamp: ts,
        owned,
        wishlisted,
        tags: parseTags(r.community_tags).slice(0, 6),
        genres: parseTags(r.steam_genres).slice(0, 6),
        positivePercent: r.positive_percent || 0,
        totalReviews: r.total_reviews || 0,
        headerUrl: headerUrl(r.steam_appid, ""),
      });
    }
  }

  if (wantUnowned) {
    const catalog = loadCatalog(db, { minReviews: 0 });
    for (const e of catalog) {
      if (!e.releaseDate) continue;
      const iso = parseReleaseDate(e.releaseDate);
      if (!iso) continue;
      const ts = new Date(iso + "T00:00:00").getTime();
      if (ts < todayTs) continue;
      items.push({
        key: `c:${e.appid}`,
        appid: e.appid,
        name: e.name,
        source: "unowned",
        releaseDate: e.releaseDate,
        releaseIso: iso,
        timestamp: ts,
        owned: false,
        wishlisted: false,
        tags: e.tags.slice(0, 6),
        genres: e.genres.slice(0, 6),
        positivePercent: e.reviewPositivePct,
        totalReviews: e.reviewTotal,
        headerUrl: headerUrl(e.appid, e.headerImage),
      });
    }
  }

  items.sort((a, b) => a.timestamp - b.timestamp || a.name.localeCompare(b.name));

  return NextResponse.json({
    today: today.toISOString().slice(0, 10),
    total: items.length,
    releases: items.slice(0, limit),
  });
}
