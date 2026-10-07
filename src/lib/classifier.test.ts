import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyByRules, confidenceFor } from "./classifier.ts";
import type { ClassifyInput, Achievements } from "./classifier.ts";

function game(over: Partial<ClassifyInput> = {}): ClassifyInput {
  return { name: "Some Game", playtimeHours: 0, achievements: null, store: null, ...over };
}
function store(appType = "game", genres: string[] = [], categories: string[] = []) {
  return { appType, genres, categories };
}
function ach(total: number, achieved: number, namesAchieved: string[] = []): Achievements {
  return { total, achieved, percentage: total > 0 ? (achieved / total) * 100 : 0, namesAchieved };
}

// ── Rust unit tests (ported 1:1) ──
test("not_a_game_by_type", () => {
  const r = classifyByRules(game({ name: "Some DLC", store: store("dlc") }));
  assert.equal(r.category, "NOT_A_GAME");
});

test("not_a_game_by_name", () => {
  const r = classifyByRules(game({ name: "Half-Life Dedicated Server" }));
  assert.equal(r.category, "NOT_A_GAME");
});

test("multiplayer_only", () => {
  const r = classifyByRules(game({ name: "Some Shooter", playtimeHours: 10, store: store("game", ["Action"], ["Multi-player"]) }));
  assert.equal(r.category, "ENDLESS");
});

test("unplayed_sp_is_backlog", () => {
  const r = classifyByRules(game({ name: "Portal 3", store: store("game", ["Puzzle"], ["Single-player"]) }));
  assert.equal(r.category, "IN_PROGRESS");
});

// ── One test per rule ──
test("rule1: steam type non-game", () => {
  for (const t of ["demo", "tool", "music", "dlc", "video", "hardware", "mod"]) {
    const r = classifyByRules(game({ store: store(t) }));
    assert.equal(r.category, "NOT_A_GAME");
    assert.equal(r.reason, `Steam type: ${t}`);
  }
});

test("rule2: name pattern", () => {
  const r = classifyByRules(game({ name: "Cool Game Soundtrack" }));
  assert.equal(r.category, "NOT_A_GAME");
  assert.match(r.reason, /^Name pattern: Soundtrack$/i);
});

test("rule3: story achievement", () => {
  const r = classifyByRules(game({ achievements: ach(10, 3, ["First Steps", "Beat the Game"]) }));
  assert.equal(r.category, "COMPLETED");
  assert.equal(r.reason, "Story achievement: Beat the Game");
});

test("rule4: high achievement pct", () => {
  const r = classifyByRules(game({ achievements: ach(10, 9) }));
  assert.equal(r.category, "COMPLETED");
  assert.equal(r.reason, "Achievement completion: 90%");
});

test("rule5: multiplayer-only", () => {
  const r = classifyByRules(game({ playtimeHours: 3, store: store("game", ["Action"], ["Multi-player", "Co-op"]) }));
  assert.equal(r.category, "ENDLESS");
  assert.equal(r.reason, "Multiplayer-only (no single-player)");
});

test("rule6: mmo genre", () => {
  const r = classifyByRules(game({ playtimeHours: 3, store: store("game", ["MMO"], ["Single-player", "Multi-player"]) }));
  assert.equal(r.category, "ENDLESS");
  assert.equal(r.reason, "MMO genre");
});

test("rule7: endless genre without SP", () => {
  const r = classifyByRules(game({ playtimeHours: 3, store: store("game", ["Racing", "Simulation"], ["Co-op"]) }));
  assert.equal(r.category, "ENDLESS");
  assert.equal(r.reason, "Genre: racing, simulation");
});

test("rule8a: 40% achievements + 5h", () => {
  const r = classifyByRules(game({ playtimeHours: 6, achievements: ach(20, 8), store: store("game", ["RPG"], ["Single-player"]) }));
  assert.equal(r.category, "COMPLETED");
  assert.equal(r.reason, "Likely completed (40% achievements, 6.0h played)");
});

test("rule8b: 20% achievements + 20h + SP", () => {
  const r = classifyByRules(game({ playtimeHours: 25, achievements: ach(50, 12), store: store("game", ["RPG"], ["Single-player"]) }));
  assert.equal(r.category, "COMPLETED");
  assert.equal(r.reason, "Likely completed (24% achievements, 25.0h played, single-player)");
});

test("rule9: SP + 15h + no achievements", () => {
  const r = classifyByRules(game({ playtimeHours: 16, store: store("game", ["RPG"], ["Single-player"]) }));
  assert.equal(r.category, "COMPLETED");
  assert.equal(r.reason, "Likely completed (single-player, 16.0h played)");
});

test("rule9b: SP + 20h + achievements tracked externally", () => {
  const r = classifyByRules(game({ playtimeHours: 22, achievements: ach(30, 0), store: store("game", ["RPG"], ["Single-player"]) }));
  assert.equal(r.category, "COMPLETED");
  assert.equal(r.reason, "Likely completed (single-player, 22.0h played, achievements tracked externally)");
});

test("rule10: endless genre with SP, no achievements", () => {
  const r = classifyByRules(game({ playtimeHours: 3, store: store("game", ["Strategy"], ["Single-player"]) }));
  assert.equal(r.category, "ENDLESS");
  assert.equal(r.reason, "Genre: strategy");
});

test("rule11: unplayed SP backlog", () => {
  const r = classifyByRules(game({ store: store("game", ["Puzzle"], ["Single-player"]) }));
  assert.equal(r.category, "IN_PROGRESS");
  assert.equal(r.reason, "Unplayed single-player game (backlog)");
});

test("rule12: unplayed no store info", () => {
  const r = classifyByRules(game());
  assert.equal(r.category, "IN_PROGRESS");
  assert.equal(r.reason, "Unplayed game (backlog)");
});

test("rule13: SP low playtime", () => {
  const r = classifyByRules(game({ playtimeHours: 4, store: store("game", ["Puzzle"], ["Single-player"]) }));
  assert.equal(r.category, "IN_PROGRESS");
  assert.equal(r.reason, "Single-player with low playtime (4h)");
});

test("rule14: played no signal", () => {
  const r = classifyByRules(game({ playtimeHours: 4, store: store("game", ["RPG"], []) }));
  assert.equal(r.category, "IN_PROGRESS");
  assert.equal(r.reason, "Played (4h) but no clear completion signal");
});

test("fallback: no signals at all", () => {
  const r = classifyByRules(game({ playtimeHours: 0, store: store("game", ["RPG"], []) }));
  assert.equal(r.category, "IN_PROGRESS");
  assert.equal(r.reason, "No classification signals — defaulted to In Progress");
});

test("confidence: Likely/default → MEDIUM, else HIGH", () => {
  assert.equal(confidenceFor("Rule: Likely completed (40% achievements, 6.0h played)"), "MEDIUM");
  assert.equal(confidenceFor("Rule: Unplayed game (backlog)"), "HIGH");
  assert.equal(confidenceFor("No classification signals — defaulted to In Progress"), "MEDIUM");
  assert.equal(confidenceFor("Rule: Steam type: dlc"), "HIGH");
});
