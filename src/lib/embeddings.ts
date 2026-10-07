import { createHash } from "crypto";
import { Database } from "./sqlite.ts";
import { AiProvider } from "./ai/index.ts";

/** Vectors are stored as little-endian Float32 blobs. */
export function vectorToBlob(v: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(v.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < v.length; i++) view.setFloat32(i * 4, v[i], true);
  return new Uint8Array(buf);
}

export function blobToVector(blob: Uint8Array): Float32Array {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const out = new Float32Array(blob.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export function textHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

function parseTagNames(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (typeof parsed[0] === "string") return parsed as string[];
      return (parsed as { name?: string }[]).map((t) => t.name || "").filter(Boolean);
    }
    // FronkonGames/Steam catalog stores tags as { "Tag": vote_count }.
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, number>)
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([name]) => name)
        .filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

export interface EmbedSource {
  name: string;
  community_tags: string | null;
  steam_genres: string | null;
  description: string | null;
}

/**
 * Composite embed text — same shape as gamekeeper's builder so library and
 * catalog vectors land in the same space: top-15 tags, genres, short description.
 */
export function buildEmbedText(g: EmbedSource): string {
  const tags = parseTagNames(g.community_tags).slice(0, 15);
  const genres = parseTagNames(g.steam_genres);
  const desc = (g.description || "").slice(0, 300);
  const parts: string[] = [];
  if (tags.length) parts.push(tags.join(", "));
  if (genres.length) parts.push(genres.join(", "));
  if (desc) parts.push(desc);
  // Fall back to the name so a metadata-less game still gets a usable vector.
  if (parts.length === 0) return g.name;
  return parts.join(". ");
}

export interface EmbedProgress {
  current: number;
  total: number;
  name: string;
  embedded: number;
  skipped: number;
}

const BATCH_SIZE = 32;

/**
 * Embeds owned + wishlist games into embeddings(source='game', key=game_id).
 * Rows whose text_hash and model already match are skipped, so this is resumable
 * and cheap to re-run after a partial sync.
 */
export async function embedGames(
  db: Database,
  provider: AiProvider,
  opts: {
    mode?: "missing" | "all";
    limit?: number;
    onProgress?: (p: EmbedProgress) => void;
    onStatus?: (msg: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ embedded: number; skipped: number; total: number }> {
  const mode = opts.mode || "missing";
  const model = provider.config.embedModel;

  const rows = db.prepare(
    `SELECT DISTINCT g.id, g.name, g.community_tags, g.steam_genres, g.description,
            e.text_hash AS have_hash, e.model AS have_model
     FROM games g
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
     JOIN subtags s ON s.id = gt.subtag_id AND s.name IN ('owned', 'wishlist')
     LEFT JOIN embeddings e ON e.source = 'game' AND e.key = g.id
     ORDER BY g.name`
  ).all() as {
    id: number; name: string; community_tags: string | null; steam_genres: string | null;
    description: string | null; have_hash: string | null; have_model: string | null;
  }[];

  const pending: { id: number; name: string; text: string; hash: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const text = buildEmbedText(r);
    const hash = textHash(text);
    const fresh = r.have_hash === hash && r.have_model === model;
    if (mode === "missing" && fresh) { skipped++; continue; }
    pending.push({ id: r.id, name: r.name, text, hash });
  }
  const total = opts.limit && opts.limit > 0 ? Math.min(pending.length, opts.limit) : pending.length;
  const work = pending.slice(0, total);

  opts.onStatus?.(`${total} games to embed with ${model} (${skipped} already current)`);

  const upsert = db.prepare(
    `INSERT INTO embeddings (source, key, model, dim, text_hash, vector, created_at)
     VALUES ('game', ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source, key) DO UPDATE SET
       model = excluded.model, dim = excluded.dim, text_hash = excluded.text_hash,
       vector = excluded.vector, created_at = excluded.created_at`
  );

  let embedded = 0;
  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    if (opts.signal?.aborted) break;
    const batch = work.slice(i, i + BATCH_SIZE);
    const vectors = await provider.embed(batch.map((b) => b.text), opts.signal);
    const tx = db.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const vec = l2Normalize(vectors[j]);
        upsert.run(batch[j].id, model, vec.length, batch[j].hash, vectorToBlob(vec));
        embedded++;
      }
    });
    tx();
    opts.onProgress?.({
      current: Math.min(i + batch.length, work.length),
      total: work.length,
      name: batch[batch.length - 1].name,
      embedded,
      skipped,
    });
  }

  return { embedded, skipped, total: work.length };
}

export interface StoredVector { key: number; vector: Float32Array }

/** Loads all vectors for a source that match the given model (mismatches are ignored). */
export function loadVectors(db: Database, source: string, model: string): Map<number, Float32Array> {
  const rows = db.prepare(
    "SELECT key, vector FROM embeddings WHERE source = ? AND model = ?"
  ).all(source, model) as { key: number; vector: Uint8Array }[];
  const out = new Map<number, Float32Array>();
  for (const r of rows) out.set(r.key, blobToVector(r.vector));
  return out;
}

/** Coverage stats for the Settings panel: how many vectors are current vs stale. */
export function embeddingStatus(db: Database, model: string): { current: number; stale: number; candidates: number } {
  const candidates = (db.prepare(
    `SELECT COUNT(DISTINCT g.id) AS c FROM games g
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
     JOIN subtags s ON s.id = gt.subtag_id AND s.name IN ('owned', 'wishlist')`
  ).get() as { c: number }).c;
  const current = (db.prepare(
    "SELECT COUNT(*) AS c FROM embeddings WHERE source = 'game' AND model = ?"
  ).get(model) as { c: number }).c;
  const stale = (db.prepare(
    "SELECT COUNT(*) AS c FROM embeddings WHERE source = 'game' AND model != ?"
  ).get(model) as { c: number }).c;
  return { current, stale, candidates };
}
