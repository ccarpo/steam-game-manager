// Catalog index for Phase 4 discovery and "more like this".
// Loads selected unowned catalog vectors into memory once and answers nearest-neighbour
// queries with exact dot products. The metadata stays in SQLite; vectors are cached in
// Float32Arrays for speed.

import { Database } from "./sqlite.ts";
import { blobToVector } from "./embeddings.ts";
import { FlatIndex } from "./vector-index.ts";
import { catalogMeta, type CatalogEntry, type CatalogFilters } from "./catalog-types.ts";
export type { CatalogEntry, CatalogFilters } from "./catalog-types.ts";
export { catalogMeta };

const CATALOG_SELECT = `
  SELECT appid, name, release_date, tags_json, genres_json, description,
         developers_json, publishers_json, positive, negative,
         (positive + negative) AS total_reviews, header_image, embed_text, text_hash
  FROM steam_catalog
  WHERE (positive + negative) >= ?`;

function parseJsonList(s: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch { /* fall through */ }
  return [];
}

export function loadCatalog(db: Database, filters: CatalogFilters = {}): CatalogEntry[] {
  const rows = db.prepare(
    `${CATALOG_SELECT} ORDER BY total_reviews DESC`
  ).all(filters.minReviews ?? 100) as {
    appid: number; name: string; release_date: string; tags_json: string | null; genres_json: string | null;
    description: string | null; developers_json: string | null; publishers_json: string | null;
    positive: number; negative: number; total_reviews: number; header_image: string | null;
    embed_text: string; text_hash: string;
  }[];
  const exclude = filters.excludeAppids;
  return rows
    .filter((r) => !exclude?.has(r.appid))
    .map((r) => ({
      appid: r.appid,
      name: r.name,
      releaseDate: r.release_date,
      tags: parseJsonList(r.tags_json),
      genres: parseJsonList(r.genres_json),
      description: r.description || "",
      developers: parseJsonList(r.developers_json),
      publishers: parseJsonList(r.publishers_json),
      positive: r.positive,
      negative: r.negative,
      totalReviews: r.total_reviews,
      reviewPositivePct: r.total_reviews > 0 ? Math.round((r.positive / r.total_reviews) * 100) : 0,
      reviewTotal: r.total_reviews,
      headerImage: r.header_image || "",
      embedText: r.embed_text,
      textHash: r.text_hash,
    }));
}

/** Loads the catalog index for a model, optionally excluding appids. */
export function buildCatalogIndex(
  db: Database,
  model: string,
  filters: CatalogFilters = {},
): FlatIndex<CatalogEntry> {
  const entries = loadCatalog(db, filters);
  const rows = db.prepare(
    "SELECT key, vector FROM embeddings WHERE source = 'catalog' AND model = ?"
  ).all(model) as { key: number; vector: Uint8Array }[];
  const vectors = new Map<number, Float32Array>();
  for (const r of rows) vectors.set(r.key, blobToVector(r.vector));
  const indexed = entries
    .filter((e) => vectors.has(e.appid))
    .map((e) => ({ row: e.appid, meta: e, vector: vectors.get(e.appid)! }));
  return new FlatIndex<CatalogEntry>(indexed);
}

/** Counts catalog rows and how many already have vectors for the current model. */
export function catalogStatus(db: Database, model: string, minReviews = 100): {
  total: number;
  embedded: number;
  missing: number;
} {
  const total = (db.prepare(
    "SELECT COUNT(*) AS c FROM steam_catalog WHERE (positive + negative) >= ?"
  ).get(minReviews) as { c: number }).c;
  const embedded = (db.prepare(
    "SELECT COUNT(*) AS c FROM embeddings WHERE source = 'catalog' AND model = ?"
  ).get(model) as { c: number }).c;
  return { total, embedded, missing: total - embedded };
}
