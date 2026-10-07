// Generic flat Float32 vector index. No DB imports so it can be unit-tested directly
// under Node's type-stripping runner without pulling in Next.js/sqlite deps.

import type { CandidateMeta, VectorIndex } from "./taste.ts";

export interface IndexEntry<T = CandidateMeta> {
  row: number;
  vector: Float32Array;
  meta: T;
}

/**
 * In-memory vector index over a flat list of entries.
 * Loads vectors into a single Float32Array matrix. Query cost is O(n * dim) and
 * acceptable up to ~60k rows with 768 dimensions.
 */
export class FlatIndex<T extends CandidateMeta> implements VectorIndex {
  private entries: IndexEntry<T>[] = [];
  private matrix: Float32Array | null = null;
  private dim = 0;

  constructor(entries: IndexEntry<T>[]) {
    for (const e of entries) {
      if (this.dim === 0) this.dim = e.vector.length;
      if (e.vector.length !== this.dim || this.dim === 0) continue;
      this.entries.push(e);
    }
    if (this.entries.length === 0) {
      this.matrix = null;
      return;
    }
    this.matrix = new Float32Array(this.entries.length * this.dim);
    for (let i = 0; i < this.entries.length; i++) {
      this.matrix.set(this.entries[i].vector, i * this.dim);
    }
  }

  get size(): number {
    return this.entries.length;
  }

  private vectorAtIndex(i: number): Float32Array {
    return this.matrix!.subarray(i * this.dim, (i + 1) * this.dim);
  }

  vectorAt(row: number): Float32Array {
    return this.vectorAtIndex(row);
  }

  metaAt(row: number): CandidateMeta {
    return this.entries[row].meta;
  }

  entryAt(row: number): IndexEntry<T> {
    return this.entries[row];
  }

  /** Row index of the entry whose meta.appid matches, or -1. Linear scan — one-off lookups only. */
  findIndexByAppid(appid: number): number {
    return this.entries.findIndex((e) => e.meta.appid === appid);
  }

  topMatches(query: Float32Array, k: number, keep?: (row: number, meta: CandidateMeta) => boolean): { row: number; sim: number }[] {
    if (!this.matrix || this.dim === 0 || query.length !== this.dim) return [];
    const scores: { row: number; sim: number }[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      if (keep && !keep(i, this.entries[i].meta)) continue;
      let sim = 0;
      const off = i * this.dim;
      for (let j = 0; j < this.dim; j++) sim += this.matrix[off + j] * query[j];
      scores.push({ row: i, sim });
    }
    scores.sort((a, b) => b.sim - a.sim || a.row - b.row);
    return scores.slice(0, k);
  }
}
