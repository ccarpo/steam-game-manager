import { getDb } from "@/lib/db";
import { getAiConfig } from "@/lib/ai";
import { buildCatalogIndex } from "@/lib/catalog";
import { fetchLibrary, fetchVectors, buildProfile, scoreLibraryRows } from "@/lib/taste-data";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/discover?tab=wishlist|library|foryou&limit=&offset=&maxHours=&minReviews=100
 *
 * - wishlist/library: ranks games you already track against your taste profile.
 * - foryou: ranks unowned catalog games against your taste profile.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const tab = ["wishlist", "library", "foryou"].includes(sp.get("tab") || "")
    ? (sp.get("tab") as "wishlist" | "library" | "foryou")
    : "wishlist";
  const limit = Math.min(200, parseInt(sp.get("limit") || "60", 10) || 60);
  const offset = Math.max(0, parseInt(sp.get("offset") || "0", 10) || 0);
  const maxHours = sp.get("maxHours") ? Number(sp.get("maxHours")) : null;
  const minReviews = Math.max(0, parseInt(sp.get("minReviews") || "100", 10) || 100);

  const model = getAiConfig(db).embedModel;
  const bundle = buildProfile(db, model);

  if (tab === "foryou") {
    const ownedRows = db.prepare("SELECT DISTINCT steam_appid FROM games WHERE steam_appid IS NOT NULL").all() as { steam_appid: number }[];
    const ownedAppids = new Set(ownedRows.map((r) => r.steam_appid));
    const index = buildCatalogIndex(db, model, { minReviews, excludeAppids: ownedAppids });
    if (index.size === 0) {
      return NextResponse.json({
        tab,
        model,
        confidence: bundle.profile.confidence,
        signalCount: bundle.profile.signalCount,
        total: 0,
        missingVectors: 0,
        hasTasteVector: bundle.profile.vector.some((x) => x !== 0),
        games: [],
      });
    }

    // Catalog games are already unowned (ingest excludes owned appids) and quality-filtered;
    // the excludeAppids guard above also drops wishlist entries.
    const matches = index.topMatches(bundle.profile.vector, 1000);
    const games = matches.map(({ row, sim }) => {
      const e = index.entryAt(row).meta;
      return {
        appid: e.appid,
        name: e.name,
        score: sim,
        tags: e.tags.slice(0, 5),
        positivePercent: e.totalReviews > 0 ? Math.round((e.positive / e.totalReviews) * 100) : 0,
        totalReviews: e.totalReviews,
        hltbMain: null as number | null,
      };
    });

    const filtered = maxHours != null
      ? games.filter(() => false) // HLTB not available for catalog entries yet
      : games;

    return NextResponse.json({
      tab,
      model,
      confidence: bundle.profile.confidence,
      signalCount: bundle.profile.signalCount,
      total: filtered.length,
      missingVectors: 0,
      hasTasteVector: bundle.profile.vector.some((x) => x !== 0),
      games: filtered.slice(offset, offset + limit),
    });
  }

  // wishlist / library path: same as before.
  const vectors = fetchVectors(db, model);
  const rows = fetchLibrary(db, tab === "library" ? "owned" : "wishlist");
  const { scored, missingVectors } = scoreLibraryRows(bundle, rows, vectors);

  const filtered = maxHours != null
    ? scored.filter((g) => g.hltbMain != null && g.hltbMain <= maxHours)
    : scored;

  return NextResponse.json({
    tab,
    model,
    confidence: bundle.profile.confidence,
    signalCount: bundle.profile.signalCount,
    total: filtered.length,
    missingVectors,
    hasTasteVector: bundle.profile.vector.some((x) => x !== 0),
    games: filtered.slice(offset, offset + limit),
  });
}
