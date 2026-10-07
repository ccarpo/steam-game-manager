import { test } from "node:test";
import assert from "node:assert/strict";
import { blendOrder } from "./sortdeck.ts";

function items(n: number): { name: string; score: number }[] {
  return Array.from({ length: n }, (_, i) => ({ name: `g${i}`, score: (n - i) / n }));
}

test("blendOrder_randomness_zero_keeps_ranked_order", () => {
  const out = blendOrder(items(50), 0, () => 0.999);
  for (let i = 0; i < out.length - 1; i++) {
    assert.ok(out[i].score >= out[i + 1].score, `position ${i} out of order`);
  }
});

test("blendOrder_randomness_one_is_a_permutation_only", () => {
  const src = items(50);
  // Deterministic-ish rng still produces a shuffle because rank contributes 0.
  const out = blendOrder(src, 1, () => Math.random());
  assert.equal(out.length, src.length);
  assert.deepEqual(new Set(out.map((g) => g.name)), new Set(src.map((g) => g.name)));
  // Vanishingly unlikely to be perfectly ranked: check it actually moved.
  const moved = out.filter((g, i) => src.indexOf(g) !== i).length;
  assert.ok(moved > 30, `only ${moved} items moved`);
});

test("blendOrder_mid_mixes_but_biases_toward_rank", () => {
  const src = items(100);
  // Fixed rng → deterministic result; the top-10 should lean low-rank.
  let x = 42;
  const rng = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = blendOrder(src, 0.5, rng);
  const top10RankSum = out.slice(0, 10).reduce((s, g) => s + src.indexOf(g), 0);
  // Ranked top-10 sum is 45; pure shuffle average is ~495. Mixed should sit far below shuffle.
  assert.ok(top10RankSum < 300, `top10 rank sum ${top10RankSum} looks unblended`);
  assert.deepEqual(new Set(out.map((g) => g.name)), new Set(src.map((g) => g.name)));
});

test("blendOrder_edge_cases", () => {
  assert.deepEqual(blendOrder([], 0.5), []);
  const one = [{ name: "x", score: 1 }];
  assert.deepEqual(blendOrder(one, 1, () => 0.5), one);
  // Out-of-range randomness clamps instead of corrupting order.
  const out = blendOrder(items(5), 3, () => 0);
  assert.equal(out.length, 5);
});
