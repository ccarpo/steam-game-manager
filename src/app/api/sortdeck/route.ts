import { getDb } from "@/lib/db";
import { getAiConfig } from "@/lib/ai";
import { buildCatalogIndex } from "@/lib/catalog";
import { blobToVector } from "@/lib/embeddings";
import {
  buildProfile, fetchLibrary, fetchVectors, parseTags, scoreLibraryRows, signalTags,
} from "@/lib/taste-data";
import { dot, similarGames } from "@/lib/taste";
import type { CandidateMeta } from "@/lib/taste";
import { blendOrder } from "@/lib/sortdeck";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export interface DeckCard {
  key: string;
  gameId: number | null;
  appid: number | null;
  name: string;
  owned: boolean;
  wishlisted: boolean;
  tags: string[];
  genres: string[];
  positivePercent: number;
  totalReviews: number;
  playtimeHours: number | null;
  hltbMain: number | null;
  /** Deck ordering score 0-1 (taste fit or similarity-to-seed). */
  fit: number;
  description: string;
  releaseDate: string;
  developers: string[];
  headerUrl: string;
}

function headerUrl(appid: number | null, external: string): string {
  // /api/assets serves cached art for known appids; catalog entries keep their
  // Steam CDN URL as a fallback (the client tries both).
  if (appid) return `/api/assets/${appid}/header.jpg`;
  return external || "";
}

function parseDevs(json: string | null): string[] {
  try {
    const d = JSON.parse(json || "[]");
    if (Array.isArray(d)) return d.filter((x): x is string => typeof x === "string");
  } catch { /* comma-separated legacy values are not worth salvaging */ }
  return [];
}

/**
 * GET /api/sortdeck?owned=1&unowned=1&wishlist=0&similarTo=g:<id>|c:<appid>|<appid>
 *   &randomness=0..1&limit=100
 *
 * Builds a blended deck: ranked by fit (taste-vector dot) or similarity to the
 * seed, then blended with a shuffle according to `randomness`.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const sp = req.nextUrl.searchParams;
  const wantOwned = sp.get("owned") !== "0";
  const wantWishlist = sp.get("wishlist") === "1";
  const wantUnowned = sp.get("unowned") === "1";
  const similarTo = sp.get("similarTo");
  const randomness = Math.min(1, Math.max(0, Number(sp.get("randomness") || "0")));
  const limit = Math.min(500, Math.max(10, parseInt(sp.get("limit") || "100", 10) || 100));

  const model = getAiConfig(db).embedModel;
  const bundle = buildProfile(db, model);
  const vectors = fetchVectors(db, model);
  const hasTaste = bundle.profile.vector.some((x) => x !== 0);

  const cards: DeckCard[] = [];

  // --- owned + wishlist -----------------------------------------------------
  const ownedLib = fetchLibrary(db, "owned");
  const ownedIds = new Set(ownedLib.map((r) => r.id));
  const libRows = [
    ...(wantOwned ? ownedLib : []),
    ...(wantWishlist ? fetchLibrary(db, "wishlist") : []),
  ];
  if (libRows.length > 0) {
    const { scored } = scoreLibraryRows(bundle, libRows, vectors);
    // Use raw sim (not composite score) so owned cards share the catalog feed's scale.
    const scoredById = new Map(scored.map((s) => [s.id, s.sim]));
    for (const r of libRows) {
      const fit = scoredById.get(r.id) ??
        // No embedding: fall back to a review-quality prior so order still means something.
        Math.min(1, (r.positive_percent || 0) / 100) * Math.min(1, (r.total_reviews || 0) / 500);
      cards.push({
        key: `g:${r.id}`,
        gameId: r.id,
        appid: r.steam_appid,
        name: r.name,
        owned: ownedIds.has(r.id),
        wishlisted: !ownedIds.has(r.id),
        tags: signalTags(r).slice(0, 6),
        genres: parseTags(r.steam_genres).slice(0, 6),
        positivePercent: r.positive_percent || 0,
        totalReviews: r.total_reviews || 0,
        playtimeHours: (r.playtime_forever || 0) / 60,
        hltbMain: r.hltb_main ?? null,
        fit,
        description: "",
        releaseDate: "",
        developers: parseDevs(r.developers),
        headerUrl: headerUrl(r.steam_appid, ""),
      });
    }
  }

  // --- catalog index (needed for unowned feed and/or similar seed) ----------
  let catalogIndex: ReturnType<typeof buildCatalogIndex> | null = null;
  if (wantUnowned || similarTo) {
    const ownedRows = db.prepare(
      "SELECT DISTINCT steam_appid FROM games WHERE steam_appid IS NOT NULL"
    ).all() as { steam_appid: number }[];
    const ownedAppids = new Set(ownedRows.map((r) => r.steam_appid));
    catalogIndex = buildCatalogIndex(db, model, { excludeAppids: ownedAppids });
    if (catalogIndex.size === 0) catalogIndex = null;
  }

  if (wantUnowned && catalogIndex) {
    const pool = hasTaste
      ? catalogIndex.topMatches(bundle.profile.vector, Math.min(catalogIndex.size, limit * 4))
      : Array.from({ length: Math.min(catalogIndex.size, limit * 4) }, (_, row) => ({ row, sim: 0 }));
    for (const { row, sim } of pool) {
      const e = catalogIndex.entryAt(row).meta;
      cards.push({
        key: `c:${e.appid}`,
        gameId: null,
        appid: e.appid,
        name: e.name,
        owned: false,
        wishlisted: false,
        tags: e.tags.slice(0, 6),
        genres: e.genres.slice(0, 6),
        positivePercent: e.reviewPositivePct,
        totalReviews: e.reviewTotal,
        playtimeHours: null,
        hltbMain: null,
        fit: hasTaste ? sim : Math.min(1, e.reviewTotal / 2000),
        description: e.description || "",
        releaseDate: e.releaseDate || "",
        developers: e.developers,
        headerUrl: headerUrl(e.appid, e.headerImage),
      });
    }
  }

  // --- similar-to-seed ------------------------------------------------------
  if (similarTo && catalogIndex) {
    const seedGameId = similarTo.startsWith("g:") ? Number(similarTo.slice(2)) : null;
    const seedAppid = seedGameId == null
      ? Number(similarTo.startsWith("c:") ? similarTo.slice(2) : similarTo) || null
      : null;

    let seedVec: Float32Array | null = null;
    let seedMeta: CandidateMeta | null = null;

    if (seedGameId != null) {
      const g = db.prepare(
        `SELECT id, name, steam_appid, community_tags, steam_genres, positive_percent,
                total_reviews, developers
         FROM games WHERE id = ?`
      ).get(seedGameId) as {
        id: number; name: string; steam_appid: number; community_tags: string | null;
        steam_genres: string | null; positive_percent: number; total_reviews: number;
        developers: string | null;
      } | undefined;
      const emb = db.prepare(
        "SELECT vector FROM embeddings WHERE source = 'game' AND key = ? AND model = ?"
      ).get(seedGameId, model) as { vector: Uint8Array } | undefined;
      if (g && emb) {
        seedVec = blobToVector(emb.vector);
        const tags = parseTags(g.community_tags);
        seedMeta = {
          appid: g.steam_appid, name: g.name,
          tags: tags.length ? tags : parseTags(g.steam_genres),
          developers: parseDevs(g.developers),
          reviewPositivePct: g.positive_percent || 0,
          reviewTotal: g.total_reviews || 0,
        };
      }
    } else if (seedAppid != null) {
      const rowIdx = catalogIndex.findIndexByAppid(seedAppid);
      if (rowIdx >= 0) {
        seedVec = catalogIndex.vectorAt(rowIdx);
        const e = catalogIndex.entryAt(rowIdx).meta;
        seedMeta = {
          appid: e.appid, name: e.name, tags: e.tags, developers: e.developers,
          reviewPositivePct: e.reviewPositivePct, reviewTotal: e.reviewTotal,
        };
      }
    }

    if (seedVec && seedMeta) {
      // Unowned neighbours via the diversified MMR pick.
      const sims = similarGames(catalogIndex, seedVec, seedMeta, new Set(), Math.min(limit, 30));
      for (const s of sims) {
        const rowIdx = catalogIndex.findIndexByAppid(s.appid);
        const e = rowIdx >= 0 ? catalogIndex.entryAt(rowIdx).meta : null;
        cards.push({
          key: `c:${s.appid}`,
          gameId: null,
          appid: s.appid,
          name: s.name,
          owned: false,
          wishlisted: false,
          tags: s.tags.slice(0, 6),
          genres: e?.genres.slice(0, 6) || [],
          positivePercent: s.reviewPositivePct,
          totalReviews: s.reviewTotal,
          playtimeHours: null,
          hltbMain: null,
          fit: s.similarity,
          description: e?.description || "",
          releaseDate: e?.releaseDate || "",
          developers: e?.developers || [],
          headerUrl: headerUrl(s.appid, e?.headerImage || ""),
        });
      }

      // Owned neighbours by raw dot product.
      if (wantOwned) {
        const simsOwned: { row: (typeof ownedLib)[number]; sim: number }[] = [];
        for (const r of ownedLib) {
          if (seedGameId != null && r.id === seedGameId) continue;
          if (seedAppid != null && r.steam_appid === seedAppid) continue;
          const v = vectors.get(r.id);
          if (!v) continue;
          simsOwned.push({ row: r, sim: dot(seedVec, v) });
        }
        simsOwned.sort((a, b) => b.sim - a.sim);
        for (const { row: r, sim } of simsOwned.slice(0, Math.min(limit, 20))) {
          cards.push({
            key: `g:${r.id}`,
            gameId: r.id,
            appid: r.steam_appid,
            name: r.name,
            owned: true,
            wishlisted: false,
            tags: signalTags(r).slice(0, 6),
            genres: parseTags(r.steam_genres).slice(0, 6),
            positivePercent: r.positive_percent || 0,
            totalReviews: r.total_reviews || 0,
            playtimeHours: (r.playtime_forever || 0) / 60,
            hltbMain: r.hltb_main ?? null,
            fit: sim,
            description: "",
            releaseDate: "",
            developers: parseDevs(r.developers),
            headerUrl: headerUrl(r.steam_appid, ""),
          });
        }
      }
    }
  }

  // De-dup by card key (a similar-seed card can overlap the plain feeds).
  const seen = new Set<string>();
  const unique = cards.filter((c) => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });

  const blended = blendOrder(
    unique.map((card) => ({ card, score: card.fit })),
    randomness,
  ).map((w) => w.card);

  return NextResponse.json({
    total: Math.min(blended.length, limit),
    pool: blended.length,
    hasTasteVector: hasTaste,
    cards: blended.slice(0, limit),
  });
}
