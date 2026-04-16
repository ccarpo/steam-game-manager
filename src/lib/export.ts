import Database from "better-sqlite3";

// ── TXT export ──

type GameInfo = {
  id: number; name: string; steam_appid: number | null;
  notes: string; added_at: string | null;
  metas: string[]; genres: string[];
};

function writeName(lines: string[], g: { name: string; steam_appid: number | null; notes: string }, indent: string, inNos = false) {
  const prefix = inNos || !g.steam_appid ? "--- " : "";
  lines.push(`${indent}${prefix}${g.name}`);
  if (g.notes?.trim()) lines.push(`${indent}\t--- note: ${g.notes.trim()}`);
}

export function generateTxt(db: Database.Database): string {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.steam_appid, g.notes, g.added_at,
           t.name as tag_name, s.name as subtag_name, s.type as subtag_type
    FROM games g
    LEFT JOIN game_tags gt ON gt.game_id = g.id
    LEFT JOIN tags t ON t.id = gt.tag_id
    LEFT JOIN subtags s ON s.id = gt.subtag_id
    ORDER BY t.name, g.id ASC
  `).all() as { id: number; name: string; steam_appid: number | null; notes: string; added_at: string | null; tag_name: string | null; subtag_name: string | null; subtag_type: string | null }[];

  const tagMap = new Map<string, Map<number, GameInfo>>();
  const untaggedMap = new Map<number, GameInfo>();

  for (const r of rows) {
    if (!r.tag_name) {
      if (!untaggedMap.has(r.id)) untaggedMap.set(r.id, { id: r.id, name: r.name, steam_appid: r.steam_appid, notes: r.notes, added_at: r.added_at, metas: [], genres: [] });
      continue;
    }
    if (!tagMap.has(r.tag_name)) tagMap.set(r.tag_name, new Map());
    const gMap = tagMap.get(r.tag_name)!;
    if (!gMap.has(r.id)) gMap.set(r.id, { id: r.id, name: r.name, steam_appid: r.steam_appid, notes: r.notes, added_at: r.added_at, metas: [], genres: [] });
    const entry = gMap.get(r.id)!;
    if (r.subtag_name) {
      if (r.subtag_type === "meta") { if (!entry.metas.includes(r.subtag_name)) entry.metas.push(r.subtag_name); }
      else { if (!entry.genres.includes(r.subtag_name)) entry.genres.push(r.subtag_name); }
    }
  }

  const lines: string[] = [];
  for (const [tagName, gMap] of tagMap) {
    lines.push(`--- ${tagName}`);
    const all = Array.from(gMap.values());
    all.sort((a, b) => { const ad = a.added_at || "", bd = b.added_at || ""; if (ad && bd) return bd.localeCompare(ad); if (ad) return -1; if (bd) return 1; return b.id - a.id; });
    const plain = all.filter(g => g.metas.length === 0 && g.genres.length === 0);
    for (const g of plain) writeName(lines, g, "\t");
    const withMeta = all.filter(g => g.metas.length > 0);
    const metaSections = new Map<string, GameInfo[]>();
    for (const g of withMeta) { const k = g.metas[0]; if (!metaSections.has(k)) metaSections.set(k, []); metaSections.get(k)!.push(g); }
    for (const mk of Array.from(metaSections.keys()).sort()) {
      lines.push(`\t--- ${mk}`);
      const metaIsNos = mk === "not_on_steam";
      const games = metaSections.get(mk)!;
      const withGenre = games.filter(g => g.genres.length > 0);
      const noGenre = games.filter(g => g.genres.length === 0);
      const genreGroups = new Map<string, GameInfo[]>();
      for (const g of withGenre) { const k = g.genres[0]; if (!genreGroups.has(k)) genreGroups.set(k, []); genreGroups.get(k)!.push(g); }
      for (const gk of Array.from(genreGroups.keys()).sort()) { lines.push(`\t\t--- ${gk}`); for (const g of genreGroups.get(gk)!) writeName(lines, g, "\t\t\t", metaIsNos || gk === "not_on_steam"); }
      for (const g of noGenre) writeName(lines, g, "\t\t", metaIsNos);
    }
    const genreOnly = all.filter(g => g.metas.length === 0 && g.genres.length > 0);
    const genreSections = new Map<string, GameInfo[]>();
    for (const g of genreOnly) { const k = g.genres[0]; if (!genreSections.has(k)) genreSections.set(k, []); genreSections.get(k)!.push(g); }
    for (const gk of Array.from(genreSections.keys()).sort()) { lines.push(`\t--- ${gk}`); for (const g of genreSections.get(gk)!) writeName(lines, g, "\t\t", gk === "not_on_steam"); }
  }
  if (untaggedMap.size > 0) { lines.push(`--- untagged`); for (const g of untaggedMap.values()) writeName(lines, g, "\t"); }
  return lines.join("\n") + "\n";
}

// ── CSV export ──

const ALL_COLS = [
  "id", "name", "steam_appid", "notes", "added_at", "l0", "genres", "meta",
  "description", "developers", "publishers", "release_date",
  "review_sentiment", "positive_percent", "total_reviews", "metacritic_score",
  "steam_genres", "steam_features", "community_tags",
  "wishlist_date", "steam_image_url",
  "user_rating", "queue_position",
] as const;
const DEFAULT_COLS = ["id", "name", "steam_appid", "notes", "added_at", "l0", "genres", "meta", "user_rating", "queue_position"];

type GameRow = {
  id: number; name: string; steam_appid: number | null; notes: string;
  added_at: string | null; tag_name: string | null;
  genres: string | null; meta: string | null;
  description: string; developers: string; publishers: string;
  release_date: string; review_sentiment: string;
  positive_percent: number; total_reviews: number; metacritic_score: number;
  steam_genres: string; steam_features: string; community_tags: string;
  wishlist_date: string | null; steam_image_url: string | null;
  user_rating: number | null; queue_position: number | null;
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function colVal(row: GameRow, col: string): string {
  switch (col) {
    case "id": return String(row.id);
    case "name": return esc(row.name);
    case "steam_appid": return row.steam_appid ? String(row.steam_appid) : "";
    case "notes": return esc(row.notes);
    case "added_at": return row.added_at || "";
    case "l0": return esc(row.tag_name);
    case "genres": return esc(row.genres);
    case "meta": return esc(row.meta);
    case "description": return esc(row.description);
    case "developers": { const d = row.developers; return esc(d?.startsWith("[") ? JSON.parse(d).join(", ") : d); }
    case "publishers": { const p = row.publishers; return esc(p?.startsWith("[") ? JSON.parse(p).join(", ") : p); }
    case "release_date": return esc(row.release_date);
    case "review_sentiment": return esc(row.review_sentiment);
    case "positive_percent": return row.positive_percent ? String(row.positive_percent) : "";
    case "total_reviews": return row.total_reviews ? String(row.total_reviews) : "";
    case "metacritic_score": return row.metacritic_score ? String(row.metacritic_score) : "";
    case "steam_genres": return esc(row.steam_genres === "[]" ? "" : row.steam_genres);
    case "steam_features": return esc(row.steam_features === "[]" ? "" : row.steam_features);
    case "community_tags": { const ct = row.community_tags; if (!ct || ct === "[]") return ""; try { const arr = JSON.parse(ct); if (arr.length > 0 && typeof arr[0] === "object") return esc(arr.map((t: { name: string }) => t.name).join(", ")); return esc(ct); } catch { return esc(ct); } }
    case "wishlist_date": return row.wishlist_date || "";
    case "steam_image_url": return esc(row.steam_image_url);
    case "user_rating": return row.user_rating ? String(row.user_rating) : "";
    case "queue_position": return row.queue_position ? String(row.queue_position) : "";
    default: return "";
  }
}

export function generateCsv(db: Database.Database): string {
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'csv_export_columns'").get() as { value: string } | undefined;
  const mainCols = settingRow ? JSON.parse(settingRow.value) as string[] : DEFAULT_COLS;

  const rows = db.prepare(`
    SELECT g.id, g.name, g.steam_appid, g.notes, g.added_at,
           g.description, g.developers, g.publishers, g.release_date,
           g.review_sentiment, g.positive_percent, g.total_reviews, g.metacritic_score,
           g.steam_genres, g.steam_features, g.community_tags,
           g.wishlist_date, g.steam_image_url,
           g.user_rating, g.queue_position, g.rec_score,
           t.name as tag_name,
           GROUP_CONCAT(CASE WHEN s.type = 'genre' THEN s.name END, '|') as genres,
           GROUP_CONCAT(CASE WHEN s.type = 'meta' THEN s.name END, '|') as meta
    FROM games g
    LEFT JOIN game_tags gt ON gt.game_id = g.id
    LEFT JOIN tags t ON t.id = gt.tag_id
    LEFT JOIN subtags s ON s.id = gt.subtag_id
    GROUP BY g.id, gt.tag_id
    ORDER BY g.id, t.name
  `).all() as GameRow[];

  const steamRows = rows.filter(r => r.steam_appid != null);
  const nosIds = new Set(rows.filter(r => r.steam_appid == null).map(r => r.id));
  const nosRows = rows.filter(r => nosIds.has(r.id));

  const csvLines: string[] = [];
  csvLines.push(mainCols.join(","));
  for (const row of steamRows) csvLines.push(mainCols.map(c => colVal(row, c)).join(","));

  if (nosRows.length > 0) {
    csvLines.push("");
    csvLines.push("#NOT_ON_STEAM");
    const nosCols = Array.from(ALL_COLS);
    csvLines.push(nosCols.join(","));
    for (const row of nosRows) csvLines.push(nosCols.map(c => colVal(row, c)).join(","));
  }

  return csvLines.join("\n") + "\n";
}
