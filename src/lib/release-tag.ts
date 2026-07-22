import { Database } from "./sqlite";

/** Extract year from release_date string. Returns "TBA" for unknown. */
export function extractYear(rd: string | null): string {
  if (!rd || !rd.trim()) return "TBA";
  const low = rd.toLowerCase().trim();
  if (low === "coming soon" || low === "to be announced" || low === "tba") return "TBA";
  const qm = low.match(/^q[1-4]\s+(\d{4})$/);
  if (qm) return qm[1];
  const ym = rd.match(/\b(19|20)\d{2}\b/);
  if (ym) return ym[0];
  return "TBA";
}

/** Auto-assign a single game to its release year subtag under the "release" tag.
 *  Creates the tag/subtag if needed. Safe to call repeatedly. */
export function assignReleaseYearTag(db: Database, gameId: number, releaseDate: string | null) {
  const yr = extractYear(releaseDate);
  // Ensure "release" tag
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES ('release', '#f97316')").run();
  const tag = db.prepare("SELECT id FROM tags WHERE name = 'release'").get() as { id: number };
  // Ensure subtag for this year
  db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, 'meta')").run(tag.id, yr);
  const sub = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?").get(tag.id, yr) as { id: number };
  // Remove any existing release tag for this game, then assign new one
  db.prepare("DELETE FROM game_tags WHERE game_id = ? AND tag_id = ?").run(gameId, tag.id);
  db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)").run(gameId, tag.id, sub.id);
}
