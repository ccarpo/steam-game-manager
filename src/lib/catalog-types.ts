// Pure type + helper for catalog entries. No database imports so it can be tested
// directly under Node's type-stripping runner.

import type { CandidateMeta } from "./taste.ts";

export interface CatalogFilters {
  /** Minimum total reviews to be considered high-enough quality. */
  minReviews?: number;
  /** Exclude these appids (e.g. owned + wishlist). */
  excludeAppids?: Set<number>;
}

export interface CatalogEntry {
  appid: number;
  name: string;
  tags: string[];
  genres: string[];
  description: string;
  developers: string[];
  publishers: string[];
  positive: number;
  negative: number;
  totalReviews: number;
  /** Cached review-positive percent so the entry itself satisfies CandidateMeta. */
  reviewPositivePct: number;
  /** Cached total review count so the entry itself satisfies CandidateMeta. */
  reviewTotal: number;
  releaseDate: string;
  headerImage: string;
  embedText: string;
  textHash: string;
}

export function catalogMeta(entry: CatalogEntry): CandidateMeta {
  return {
    appid: entry.appid,
    name: entry.name,
    tags: entry.tags.length ? entry.tags : entry.genres,
    developers: entry.developers,
    reviewPositivePct: entry.reviewPositivePct,
    reviewTotal: entry.reviewTotal,
  };
}
