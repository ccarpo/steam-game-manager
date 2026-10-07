// Pure deck-ordering logic for the sort game. Import-free so it runs under
// plain `node --test`.

/**
 * Blends a ranked order with a random shuffle.
 * randomness = 0 → strictly by score (desc); 1 → pure shuffle; in between the
 * two are mixed per item: effective key = rankNorm * (1 - r) + rand * r.
 * Items keep their relative order for ties.
 */
export function blendOrder<T extends { score: number }>(
  items: T[],
  randomness: number,
  rng: () => number = Math.random,
): T[] {
  const r = Math.min(1, Math.max(0, randomness));
  const n = items.length;
  if (n === 0) return [];

  // rankNorm: best score → 0, worst → 1
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const keyed = sorted.map((item, i) => ({
    item,
    key: (n > 1 ? i / (n - 1) : 0) * (1 - r) + rng() * r,
  }));
  keyed.sort((a, b) => a.key - b.key);
  return keyed.map((k) => k.item);
}
