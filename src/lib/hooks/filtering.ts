"use client";

import { GameWithTags, GameTag, steamDbScore } from "../types";
import { safeJsonParse, splitCompanies } from "../utils";

export interface Filters {
  search?: string;
  includeTags?: number[];
  excludeTags?: number[];
  includeSubtags?: number[];
  excludeSubtags?: number[];
  includeGenres?: string[];
  excludeGenres?: string[];
  includeFeatures?: string[];
  excludeFeatures?: string[];
  includeCommunityTags?: string[];
  excludeCommunityTags?: string[];
  includeDevelopers?: string[];
  excludeDevelopers?: string[];
  includePublishers?: string[];
  excludePublishers?: string[];
  sort?: string;
  sorts?: { key: string; dir: "asc" | "desc" }[];
  dir?: "asc" | "desc";
  untagged?: boolean;
  withNotes?: boolean;
  withRating?: boolean;
  metadataMissing?: boolean;
  hideWishlistOnly?: boolean;
  filterMode?: "AND" | "OR";
  customTagMode?: "AND" | "OR";
  scoreMin?: number;
  scoreMax?: number;
  reviewsMin?: number;
  reviewsMax?: number;
  minCommunityTags?: number;
  minGenres?: number;
}

// --- Dynamic counts ---
export function computeDynamicCounts(games: GameWithTags[]) {
  const genreCounts = new Map<string, number>();
  const featureCounts = new Map<string, number>();
  const communityTagCounts = new Map<string, number>();
  const customTagCounts = new Map<number, number>();
  const subtagCounts = new Map<number, number>();
  const developerCounts = new Map<string, number>();
  const publisherCounts = new Map<string, number>();

  for (const game of games) {
    for (const g of safeJsonParse(game.steam_genres)) genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    for (const f of safeJsonParse(game.steam_features)) featureCounts.set(f, (featureCounts.get(f) || 0) + 1);
    for (const t of safeJsonParse(game.community_tags)) communityTagCounts.set(t, (communityTagCounts.get(t) || 0) + 1);
    if (game.developers) {
      for (const d of splitCompanies(game.developers))
        developerCounts.set(d, (developerCounts.get(d) || 0) + 1);
    }
    if (game.publishers) {
      for (const p of splitCompanies(game.publishers))
        publisherCounts.set(p, (publisherCounts.get(p) || 0) + 1);
    }
    if (game.tags) {
      for (const t of game.tags) {
        customTagCounts.set(t.tag_id, (customTagCounts.get(t.tag_id) || 0) + 1);
        if (t.subtag_id) subtagCounts.set(t.subtag_id, (subtagCounts.get(t.subtag_id) || 0) + 1);
      }
    }
  }
  return { genreCounts, featureCounts, communityTagCounts, customTagCounts, subtagCounts, developerCounts, publisherCounts };
}

// --- Search helpers ---
/** Fuzzy match: all chars of query appear in order in target */
function fuzzyMatch(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Parse prefix search like "note:foo" or "appid:123". Returns { field, value } or null for plain search. */
function parseSearchPrefix(query: string): { field: string; value: string } | null {
  const m = query.match(/^(note|notes|appid|dev|developer):(.+)/i);
  if (!m) return null;
  const field = m[1].toLowerCase();
  return { field: field === "notes" ? "note" : field === "developer" ? "dev" : field, value: m[2].trim() };
}

/** Score a game against search query. Lower = better match, 0 = no match. */
export function searchScore(game: GameWithTags, query: string): number {
  const prefix = parseSearchPrefix(query);

  if (prefix) {
    const v = prefix.value.toLowerCase();
    if (!v) return 0;
    if (prefix.field === "note") {
      const notes = (game.notes || "").toLowerCase();
      if (notes.includes(v)) return 1;
      return 0;
    }
    if (prefix.field === "appid") {
      const appid = String(game.steam_appid || "");
      if (appid === v) return 1;
      if (appid.startsWith(v)) return 2;
      return 0;
    }
    if (prefix.field === "dev") {
      const dev = (game.developers || "").toLowerCase();
      if (dev.includes(v)) return 1;
      return 0;
    }
    return 0;
  }

  const q = query.toLowerCase();
  const name = game.name.toLowerCase();

  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (q.length >= 3 && fuzzyMatch(q, name)) return 3;
  return 0;
}

export function filterGames(allGames: GameWithTags[], filters: Filters): GameWithTags[] {
  const {
    search, includeTags = [], excludeTags = [], includeSubtags = [], excludeSubtags = [],
    includeGenres = [], excludeGenres = [], includeFeatures = [], excludeFeatures = [],
    includeCommunityTags = [], excludeCommunityTags = [],
    includeDevelopers = [], excludeDevelopers = [],
    includePublishers = [], excludePublishers = [],
    untagged, withNotes, withRating, metadataMissing, hideWishlistOnly, filterMode = "AND",
    customTagMode = "AND",
  } = filters;

  return allGames.filter((game) => {
    const gameTags: GameTag[] = game.tags || [];
    const gameTagIds = new Set(gameTags.map((t) => t.tag_id));
    const gameSubtagIds = new Set(gameTags.filter((t) => t.subtag_id).map((t) => t.subtag_id!));
    const genres = safeJsonParse(game.steam_genres);
    const features = safeJsonParse(game.steam_features);
    const ctags = safeJsonParse(game.community_tags);

    if (excludeTags.some((id) => gameTagIds.has(id))) return false;
    if (excludeSubtags.some((id) => gameSubtagIds.has(id))) return false;
    if (excludeGenres.some((g) => genres.includes(g))) return false;
    if (excludeFeatures.some((f) => features.includes(f))) return false;
    if (excludeCommunityTags.some((t) => ctags.includes(t))) return false;

    const devs = game.developers ? splitCompanies(game.developers) : [];
    const pubs = game.publishers ? splitCompanies(game.publishers) : [];
    if (excludeDevelopers.some((d) => devs.includes(d))) return false;
    if (excludePublishers.some((p) => pubs.includes(p))) return false;

    if (withNotes && !(game.notes && game.notes.trim())) return false;
    if (filters.withRating && game.user_rating == null) return false;
    if (metadataMissing && !game.metadata_missing) return false;

    if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
      const score = game.total_reviews > 0 ? steamDbScore(game.positive_percent, game.total_reviews) : 0;
      if (filters.scoreMin !== undefined && score < filters.scoreMin) return false;
      if (filters.scoreMax !== undefined && score > filters.scoreMax) return false;
    }

    if (filters.reviewsMin !== undefined && (game.total_reviews || 0) < filters.reviewsMin) return false;
    if (filters.reviewsMax !== undefined && (game.total_reviews || 0) > filters.reviewsMax) return false;

    if (filters.minCommunityTags !== undefined) {
      if (ctags.length < filters.minCommunityTags) return false;
    }

    if (filters.minGenres !== undefined) {
      if (genres.length < filters.minGenres) return false;
    }

    if (hideWishlistOnly && gameTags.length > 0 && gameTags.every((t) => t.tag_name === "steam")) return false;
    if (untagged && gameTags.length > 0) return false;

    if (search) {
      if (searchScore(game, search) === 0) return false;
    }

    const checks: boolean[] = [];

    const customChecks: boolean[] = [];
    if (customTagMode === "AND") {
      for (const id of includeTags) customChecks.push(gameTagIds.has(id));
      for (const id of includeSubtags) customChecks.push(gameSubtagIds.has(id));
    } else {
      if (includeTags.length > 0 || includeSubtags.length > 0) {
        customChecks.push(
          includeTags.some((id) => gameTagIds.has(id)) ||
          includeSubtags.some((id) => gameSubtagIds.has(id))
        );
      }
    }
    if (customChecks.length > 0) {
      checks.push(customChecks.every(Boolean));
    }

    if (filterMode === "AND") {
      for (const g of includeGenres) checks.push(genres.includes(g));
      for (const f of includeFeatures) checks.push(features.includes(f));
      for (const t of includeCommunityTags) checks.push(ctags.includes(t));
      for (const d of includeDevelopers) checks.push(devs.includes(d));
      for (const p of includePublishers) checks.push(pubs.includes(p));
    } else {
      if (includeGenres.length > 0) checks.push(includeGenres.some((g) => genres.includes(g)));
      if (includeFeatures.length > 0) checks.push(includeFeatures.some((f) => features.includes(f)));
      if (includeCommunityTags.length > 0) checks.push(includeCommunityTags.some((t) => ctags.includes(t)));
      if (includeDevelopers.length > 0) checks.push(includeDevelopers.some((d) => devs.includes(d)));
      if (includePublishers.length > 0) checks.push(includePublishers.some((p) => pubs.includes(p)));
    }

    if (checks.length === 0) return true;
    return filterMode === "AND" ? checks.every(Boolean) : checks.some(Boolean);
  });
}

function safeFirst(json: string | null | undefined): string {
  if (!json) return "";
  try { const arr = JSON.parse(json); return Array.isArray(arr) ? arr.join(", ").toLowerCase() : ""; } catch { return ""; }
}

/** Parse "20 Nov, 2025", "Nov 20, 2025", "June 2026", "Q3 2026" style dates into a sortable timestamp. */
function parseReleaseDate(s: string): number {
  if (!s) return 0;
  const low = s.toLowerCase().trim();
  if (low === "coming soon" || low === "to be announced" || low === "tba") return 32503680000000;
  const qm = low.match(/^q([1-4])\s+(\d{4})$/);
  if (qm) return new Date(Number(qm[2]), (Number(qm[1]) - 1) * 3, 1).getTime();
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const m = s.match(/^(\d{1,2})\s+(\w+),?\s+(\d{4})$/);
  if (m) {
    const d2 = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
    if (!isNaN(d2.getTime())) return d2.getTime();
  }
  return 0;
}

function compareBySortKey(a: GameWithTags, b: GameWithTags, sort: string, d: number): number {
  switch (sort) {
    case "name": return d * a.name.localeCompare(b.name);
    case "added_at": {
      const av = a.added_at || "", bv = b.added_at || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "updated_at": return d * (a.updated_at.localeCompare(b.updated_at));
    case "rating": case "score": {
      const av = a.positive_percent || 0, bv = b.positive_percent || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "reviews": case "reviewCount": {
      const av = a.total_reviews || 0, bv = b.total_reviews || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "release_date": case "release": {
      const av = parseReleaseDate(a.release_date || ""), bv = parseReleaseDate(b.release_date || "");
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "metacritic": {
      const av = a.metacritic_score || 0, bv = b.metacritic_score || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "steamdb": {
      const av = a.total_reviews > 0 ? steamDbScore(a.positive_percent, a.total_reviews) : 0;
      const bv = b.total_reviews > 0 ? steamDbScore(b.positive_percent, b.total_reviews) : 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "sentiment": {
      const av = a.review_sentiment || "", bv = b.review_sentiment || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "wishlist_date": {
      const av = a.wishlist_date || "", bv = b.wishlist_date || "";
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "tag": case "tags": {
      const aTag = (a.tags || []).map(t => t.tag_name).join(", ").toLowerCase();
      const bTag = (b.tags || []).map(t => t.tag_name).join(", ").toLowerCase();
      if (!aTag && !bTag) return 0; if (!aTag) return 1; if (!bTag) return -1;
      if (aTag !== bTag) return d * aTag.localeCompare(bTag);
      const aSub = (a.tags || []).map(t => t.subtag_name || "").join(", ").toLowerCase();
      const bSub = (b.tags || []).map(t => t.subtag_name || "").join(", ").toLowerCase();
      if (aSub !== bSub) return d * aSub.localeCompare(bSub);
      return a.name.localeCompare(b.name);
    }
    case "genre": case "genres": {
      const aG = safeFirst(a.steam_genres), bG = safeFirst(b.steam_genres);
      if (!aG && !bG) return 0; if (!aG) return 1; if (!bG) return -1;
      if (aG !== bG) return d * aG.localeCompare(bG);
      return a.name.localeCompare(b.name);
    }
    case "community_tag": case "community": {
      const aC = safeFirst(a.community_tags), bC = safeFirst(b.community_tags);
      if (!aC && !bC) return 0; if (!aC) return 1; if (!bC) return -1;
      if (aC !== bC) return d * aC.localeCompare(bC);
      return a.name.localeCompare(b.name);
    }
    case "features": {
      const aF = safeFirst(a.steam_features), bF = safeFirst(b.steam_features);
      if (!aF && !bF) return 0; if (!aF) return 1; if (!bF) return -1;
      if (aF !== bF) return d * aF.localeCompare(bF);
      return a.name.localeCompare(b.name);
    }
    case "developers": {
      const av = (a.developers || "").toLowerCase(), bv = (b.developers || "").toLowerCase();
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "publishers": {
      const av = (a.publishers || "").toLowerCase(), bv = (b.publishers || "").toLowerCase();
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * av.localeCompare(bv);
    }
    case "appid": {
      const av = a.steam_appid || 0, bv = b.steam_appid || 0;
      if (!av && !bv) return 0; if (!av) return 1; if (!bv) return -1;
      return d * (av - bv);
    }
    case "curation": {
      const av = a.queue_position, bv = b.queue_position;
      if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
      return d * (av - bv);
    }
    case "user_rating": {
      const av = a.user_rating, bv = b.user_rating;
      if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
      return d * (av - bv);
    }
    default: return d * a.name.localeCompare(b.name);
  }
}

export function sortGames(games: GameWithTags[], sort?: string, dir?: "asc" | "desc", sorts?: { key: string; dir: "asc" | "desc" }[]): GameWithTags[] {
  const entries = sorts && sorts.length > 0 ? sorts : sort ? [{ key: sort, dir: dir || "asc" as const }] : [{ key: "name", dir: dir || "asc" as const }];
  const sorted = [...games];
  sorted.sort((a, b) => {
    for (const entry of entries) {
      const cmp = compareBySortKey(a, b, entry.key, entry.dir === "desc" ? -1 : 1);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
  return sorted;
}

// Fisher-Yates shuffle with a numeric seed (deterministic)
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
