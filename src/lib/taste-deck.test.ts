import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBounce, gameWeight } from "./taste.ts";
import type { GameSignal } from "./taste.ts";

const NOW = 1_756_684_800;
const SECS_PER_DAY = 86_400;

function baseSig(overrides: Partial<GameSignal> = {}): GameSignal {
  return {
    appid: 1,
    name: "Game",
    hours: 64,
    hours2weeks: 0,
    rtimeLastPlayed: NOW,
    achPct: null,
    category: "IN_PROGRESS",
    hltbMainHours: null,
    vector: null,
    tags: ["Action"],
    ...overrides,
  };
}

test("deck_loved_boosts_weight", () => {
  const plain = gameWeight(baseSig(), NOW);
  const loved = gameWeight(baseSig({ deckLoved: true }), NOW);
  const liked = gameWeight(baseSig({ deckLiked: true }), NOW);
  assert.ok(loved > plain, "loved > plain");
  assert.ok(liked > plain && liked < loved, "plain < liked < loved");
  assert.ok(Math.abs(loved / plain - 1.5) < 1e-9, "loved = 1.5x");
  assert.ok(Math.abs(liked / plain - 1.25) < 1e-9, "liked = 1.25x");
});

test("deck_disliked_counts_as_bounce_even_when_unplayed", () => {
  const sig = baseSig({ hours: 0, rtimeLastPlayed: 0, deckDisliked: true });
  assert.equal(detectBounce(sig, NOW), "bounced");
});

test("deck_disliked_overrides_completed", () => {
  // A user's explicit dislike matters even if they previously finished the game.
  const sig = baseSig({ hours: 100, category: "COMPLETED", deckDisliked: true });
  assert.equal(detectBounce(sig, NOW), "bounced");
});

test("deck_loved_does_not_affect_bounce", () => {
  const sig = baseSig({ hours: 0.2, rtimeLastPlayed: NOW - 200 * SECS_PER_DAY, deckLoved: true });
  assert.equal(detectBounce(sig, NOW), "bounced");
});
