// Assembles taste-engine inputs from the database and exposes profile/scoring
// helpers for the API routes. Keeps taste.ts itself pure and testable.

import { Database } from "./sqlite";
import { Category } from "./classifier";
import { blobToVector } from "./embeddings";
import {
  CandidateMeta, GameSignal, ScoredCandidate, TasteProfile,
  computeProfile, reasonFor, scoreCandidate,
} from "./taste";

export interface LibraryRow {
  id: number;
  name: string;
  steam_appid: number | null;
  playtime_forever: number;
  playtime_2weeks: number;
  rtime_last_played: number;
  community_tags: string | null;
  steam_genres: string | null;
  positive_percent: number;
  total_reviews: number;
  developers: string | null;
  category: Category | null;
  ach_total: number | null;
  ach_achieved: number | null;
  ach_status: string | null;
  hltb_main: number | null;
}

const LIBRARY_SELECT = `
  SELECT DISTINCT g.id, g.name, g.steam_appid, g.playtime_forever, g.playtime_2weeks,
         g.rtime_last_played, g.community_tags, g.steam_genres, g.positive_percent,
         g.total_reviews, g.developers,
         COALESCE(c.override_category, c.category) AS category,
         a.total AS ach_total, a.achieved AS ach_achieved, a.status AS ach_status,
         h.main_hours AS hltb_main
  FROM games g
  JOIN game_tags gt ON gt.game_id = g.id
  JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
  JOIN subtags s ON s.id = gt.subtag_id AND s.name = ?
  LEFT JOIN game_classification c ON c.game_id = g.id
  LEFT JOIN steam_achievements a ON a.appid = g.steam_appid
  LEFT JOIN hltb h ON h.appid = g.steam_appid
  WHERE g.steam_appid IS NOT NULL`;

export function parseTags(json: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return [];
    if (typeof arr[0] === "string") return arr as string[];
    return (arr as { name?: string }[]).map((t) => t.name || "").filter(Boolean);
  } catch { return []; }
}

export function fetchLibrary(db: Database, subtag: "owned" | "wishlist"): LibraryRow[] {
  return db.prepare(`${LIBRARY_SELECT} ORDER BY g.name`).all(subtag) as LibraryRow[];
}

/** Vectors for the current embed model, keyed by game id. */
export function fetchVectors(db: Database, model: string): Map<number, Float32Array> {
  const rows = db.prepare(
    "SELECT key, vector FROM embeddings WHERE source = 'game' AND model = ?"
  ).all(model) as { key: number; vector: Uint8Array }[];
  const out = new Map<number, Float32Array>();
  for (const r of rows) out.set(r.key, blobToVector(r.vector));
  return out;
}

/** Tags used for taste: community tags first, genres as fallback/extension. */
export function signalTags(row: LibraryRow): string[] {
  const ctags = parseTags(row.community_tags);
  if (ctags.length > 0) return ctags;
  return parseTags(row.steam_genres);
}

export function toSignal(row: LibraryRow, vectors: Map<number, Float32Array>): GameSignal {
  const achPct = row.ach_status === "ok" && row.ach_total && row.ach_total > 0
    ? ((row.ach_achieved || 0) / row.ach_total) * 100
    : null;
  return {
    appid: row.steam_appid!,
    name: row.name,
    hours: (row.playtime_forever || 0) / 60,
    hours2weeks: (row.playtime_2weeks || 0) / 60,
    rtimeLastPlayed: row.rtime_last_played || 0,
    achPct,
    // Unclassified games behave like backlog entries rather than being dropped.
    category: row.category ?? "IN_PROGRESS",
    hltbMainHours: row.hltb_main ?? null,
    vector: vectors.get(row.id) ?? null,
    tags: signalTags(row),
  };
}

export interface ProfileBundle {
  profile: TasteProfile;
  signals: GameSignal[];
  /** appid → library row, for resolving names/images in API responses. */
  byAppid: Map<number, LibraryRow>;
  model: string;
  withVectors: number;
  totalOwned: number;
}

/** Computes the taste profile from scratch (cheap: a few ms for ~2k games). */
export function buildProfile(db: Database, model: string, now = Math.floor(Date.now() / 1000)): ProfileBundle {
  const owned = fetchLibrary(db, "owned");
  const vectors = fetchVectors(db, model);
  const signals = owned.map((r) => toSignal(r, vectors));
  const byAppid = new Map(owned.map((r) => [r.steam_appid!, r]));
  return {
    profile: computeProfile(signals, now),
    signals,
    byAppid,
    model,
    withVectors: signals.filter((s) => s.vector).length,
    totalOwned: owned.length,
  };
}

export function toCandidateMeta(row: LibraryRow): CandidateMeta {
  let developers: string[] = [];
  try {
    const d = JSON.parse(row.developers || "[]");
    if (Array.isArray(d)) developers = d.filter((x): x is string => typeof x === "string");
  } catch { /* comma-separated legacy values are not worth salvaging here */ }
  return {
    appid: row.steam_appid!,
    name: row.name,
    tags: signalTags(row),
    developers,
    reviewPositivePct: row.positive_percent || 0,
    reviewTotal: row.total_reviews || 0,
  };
}

export interface ScoredLibraryGame extends ScoredCandidate {
  id: number;
  appid: number;
  name: string;
  reason: string;
  tags: string[];
  hltbMain: number | null;
  positivePercent: number;
  totalReviews: number;
}

/**
 * Scores a set of library rows (wishlist or owned) against the profile.
 * Rows without a vector are skipped — they have no direction to compare.
 */
export function scoreLibraryRows(
  bundle: ProfileBundle,
  rows: LibraryRow[],
  vectors: Map<number, Float32Array>,
): { scored: ScoredLibraryGame[]; missingVectors: number } {
  const out: ScoredLibraryGame[] = [];
  let missingVectors = 0;
  for (const row of rows) {
    const vec = vectors.get(row.id);
    if (!vec) { missingVectors++; continue; }
    const tags = signalTags(row);
    const s = scoreCandidate(bundle.profile, vec, row.positive_percent || 0, row.total_reviews || 0);
    out.push({
      ...s,
      id: row.id,
      appid: row.steam_appid!,
      name: row.name,
      reason: reasonFor(bundle.profile, vec, tags),
      tags: tags.slice(0, 5),
      hltbMain: row.hltb_main ?? null,
      positivePercent: row.positive_percent || 0,
      totalReviews: row.total_reviews || 0,
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { scored: out, missingVectors };
}
