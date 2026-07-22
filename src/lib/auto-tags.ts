import { Database } from "./sqlite";
import { extractYear } from "./release-tag";
import { steamDbScore } from "./types";

const AUTO_TAG_NAME = "auto";
const AUTO_TAG_COLOR = "#f97316";

/** Default score buckets — can be overridden via settings.score_buckets JSON */
const DEFAULT_BUCKETS = [
  { min: 95, label: "95-100%" },
  { min: 85, label: "85-94%" },
  { min: 75, label: "75-84%" },
  { min: 65, label: "65-74%" },
  { min: 50, label: "50-64%" },
  { min: 0, label: "0-49%" },
];

function getScoreBuckets(db: Database): { min: number; label: string }[] {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'score_buckets'").get() as { value: string } | undefined;
    if (row) return JSON.parse(row.value);
  } catch {}
  return DEFAULT_BUCKETS;
}

function getScoreSource(db: Database): "steam" | "steamdb" {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'score_source'").get() as { value: string } | undefined;
    if (row?.value === "steam") return "steam";
  } catch {}
  return "steamdb";
}

function getScoreBucket(pct: number, totalReviews: number, db: Database): string {
  const source = getScoreSource(db);
  const score = source === "steamdb" && totalReviews > 0
    ? steamDbScore(pct, totalReviews)
    : pct;
  if (score <= 0) return "No Score";
  const buckets = getScoreBuckets(db);
  for (const b of buckets) {
    if (score >= b.min) return b.label;
  }
  return "No Score";
}

/** Ensure the "auto" L0 tag exists and return its id */
function ensureAutoTag(db: Database): number {
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)").run(AUTO_TAG_NAME, AUTO_TAG_COLOR);
  return (db.prepare("SELECT id FROM tags WHERE name = ?").get(AUTO_TAG_NAME) as { id: number }).id;
}

/** Assign a game to an auto subtag. type = "release" | "sentiment" | "score" */
function assignAutoSubtag(db: Database, autoTagId: number, type: string, gameId: number, value: string) {
  // Check if subtag exists; if it exists with a different type, that's a name collision — skip
  const existing = db.prepare("SELECT id, type FROM subtags WHERE tag_id = ? AND name = ?").get(autoTagId, value) as { id: number; type: string } | undefined;
  let subId: number;
  if (existing) {
    if (existing.type !== type) return; // name collision across types, skip
    subId = existing.id;
  } else {
    db.prepare("INSERT INTO subtags (tag_id, name, type) VALUES (?, ?, ?)").run(autoTagId, value, type);
    subId = (db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?").get(autoTagId, value) as { id: number }).id;
  }
  // Remove old assignment for this type (find all subtags of this type under auto, delete game_tags for them)
  const typeSubIds = (db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND type = ?").all(autoTagId, type) as { id: number }[]).map(r => r.id);
  if (typeSubIds.length > 0) {
    db.prepare(`DELETE FROM game_tags WHERE game_id = ? AND tag_id = ? AND subtag_id IN (${typeSubIds.join(",")})`).run(gameId, autoTagId);
  }
  db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)").run(gameId, autoTagId, subId);
}

/** Auto-assign release year, sentiment, and score tags for a single game. */
/** Normalize sentiment — group "X user reviews" into "Too Few Reviews" */
function normalizeSentiment(s: string): string {
  if (/^\d+ user reviews?$/i.test(s)) return "Too Few Reviews";
  if (s === "No user reviews") return "No Reviews";
  return s;
}

export function assignAllAutoTags(db: Database, gameId: number, opts: {
  releaseDate?: string | null;
  sentiment?: string | null;
  positivePercent?: number;
  totalReviews?: number;
}) {
  const autoTagId = ensureAutoTag(db);
  if (opts.releaseDate) {
    assignAutoSubtag(db, autoTagId, "release", gameId, extractYear(opts.releaseDate));
  }
  if (opts.sentiment && opts.sentiment.trim()) {
    assignAutoSubtag(db, autoTagId, "sentiment", gameId, normalizeSentiment(opts.sentiment));
  }
  if (opts.totalReviews && opts.totalReviews > 0) {
    assignAutoSubtag(db, autoTagId, "score", gameId, getScoreBucket(opts.positivePercent || 0, opts.totalReviews, db));
  }
}

export { AUTO_TAG_NAME, getScoreBucket, ensureAutoTag };
