import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogMeta } from "./catalog-types.ts";
import type { CatalogEntry } from "./catalog-types.ts";
import { FlatIndex } from "./vector-index.ts";

function vec(values: number[]): Float32Array {
  return Float32Array.from(values);
}

function makeEntry(appid: number, name: string, tags: string[] = []): CatalogEntry {
  return {
    appid, name, tags, genres: [], description: "", developers: ["dev"], publishers: [],
    positive: 100, negative: 10, totalReviews: 110, reviewPositivePct: 91, reviewTotal: 110,
    releaseDate: "", headerImage: "",
    embedText: name, textHash: name,
  };
}

function buildIndex(entries: CatalogEntry[], vectors: Map<number, Float32Array>): FlatIndex<CatalogEntry> {
  const indexed = entries
    .filter((e) => vectors.has(e.appid))
    .map((e) => ({ row: e.appid, meta: e, vector: vectors.get(e.appid)! }));
  return new FlatIndex<CatalogEntry>(indexed);
}

test("catalog_index_top_matches_returns_nearest", () => {
  const entries: CatalogEntry[] = [
    makeEntry(1, "A", ["Action"]),
    makeEntry(2, "B", ["Action", "RPG"]),
    makeEntry(3, "C", ["Puzzle"]),
  ];
  const vectors = new Map<number, Float32Array>([
    [1, vec([1, 0, 0])],
    [2, vec([0.9, 0.1, 0])],
    [3, vec([0, 0, 1])],
  ]);
  const idx = buildIndex(entries, vectors);
  const q = vec([1, 0, 0]);
  const res = idx.topMatches(q, 2);
  assert.equal(res.length, 2);
  assert.equal(idx.entryAt(res[0].row).meta.appid, 1);
  assert.equal(idx.entryAt(res[1].row).meta.appid, 2);
});

test("catalog_index_excludes_filtered_rows", () => {
  const entries: CatalogEntry[] = [
    makeEntry(1, "A"),
    makeEntry(2, "B"),
    makeEntry(3, "C"),
  ];
  const vectors = new Map<number, Float32Array>([
    [1, vec([1, 0])],
    [2, vec([0.8, 0.2])],
    [3, vec([0.6, 0.4])],
  ]);
  const idx = buildIndex(entries, vectors);
  const res = idx.topMatches(vec([1, 0]), 2, (_row, meta) => meta.appid !== 1);
  assert.equal(res.length, 2);
  assert.equal(idx.entryAt(res[0].row).meta.appid, 2);
});

test("catalog_index_empty_when_no_vectors", () => {
  const idx = buildIndex([makeEntry(1, "A")], new Map());
  assert.equal(idx.size, 0);
  const res = idx.topMatches(vec([1, 0]), 5);
  assert.equal(res.length, 0);
});

test("catalog_meta_prefers_tags_over_genres", () => {
  const e = makeEntry(10, "Z", ["Shooter", "Action"]);
  e.genres = ["RPG"];
  const m = catalogMeta(e);
  assert.deepEqual(m.tags, ["Shooter", "Action"]);
});

test("catalog_meta_falls_back_to_genres", () => {
  const e = makeEntry(10, "Z", []);
  e.genres = ["RPG"];
  const m = catalogMeta(e);
  assert.deepEqual(m.tags, ["RPG"]);
});
