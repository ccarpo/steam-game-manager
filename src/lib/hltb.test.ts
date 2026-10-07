import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, secondsToHours, similarity } from "./hltb.ts";

test("normalize_title_basic", () => {
  assert.equal(normalizeTitle("DARK SOULS™ III"), "dark souls iii");
  assert.equal(normalizeTitle("The Witcher® 3"), "the witcher 3");
  assert.equal(normalizeTitle("Skyrim Special Edition"), "skyrim");
  assert.equal(normalizeTitle("Fallout 4 Game of the Year Edition"), "fallout 4");
  assert.equal(normalizeTitle("DOOM Eternal Deluxe Edition"), "doom eternal");
});

test("normalize_title_edge_cases", () => {
  assert.equal(normalizeTitle(""), "");
  assert.equal(normalizeTitle("  Portal  2  "), "portal 2");
  assert.equal(normalizeTitle("Half-Life 2"), "half-life 2");
  assert.equal(normalizeTitle("Final Fantasy VII Remake - Digital Edition"), "final fantasy vii remake");
});

test("seconds_to_hours", () => {
  assert.equal(secondsToHours(0), null);
  assert.equal(secondsToHours(-100), null);
  assert.equal(secondsToHours(3600), 1.0);
  assert.equal(secondsToHours(5400), 1.5);
  assert.equal(secondsToHours(45000), 12.5);
});

test("similarity", () => {
  assert.ok(Math.abs(similarity("dark souls iii", "dark souls iii") - 1.0) < 0.01);
  assert.ok(similarity("dark souls iii", "dark souls 3") > 0.7);
  assert.ok(similarity("portal", "portal") > 0.99);
  assert.ok(similarity("the witcher 3", "completely different game") < 0.5);
});

test("similarity_threshold", () => {
  const a = normalizeTitle("The Elder Scrolls V: Skyrim Special Edition");
  const b = normalizeTitle("The Elder Scrolls V: Skyrim");
  assert.ok(similarity(a, b) > 0.7);

  const c = normalizeTitle("DARK SOULS™ III");
  const d = normalizeTitle("Dark Souls III");
  assert.ok(similarity(c, d) > 0.99);

  assert.ok(similarity("portal 2", "call of duty") < 0.5);
});
