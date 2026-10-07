import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeProfile, detectBounce, gameWeight, normalizeName, reasonFor,
  sameFranchise, scoreCandidate, similarGames,
} from "./taste.ts";
import type { AnchorGame, CandidateMeta, GameSignal, TasteProfile, VectorIndex } from "./taste.ts";
import type { Category } from "./classifier.ts";

const NOW = 1_756_684_800; // 2025-09-01-ish; exact value irrelevant
const SECS_PER_DAY = 86_400;
const DIM = 16;

function unitVec(axis: number): Float32Array {
  const v = new Float32Array(DIM);
  v[axis % DIM] = 1;
  return v;
}

function sig(appid: number, hours: number, category: Category): GameSignal {
  return {
    appid,
    name: `Game ${appid}`,
    hours,
    hours2weeks: 0,
    rtimeLastPlayed: NOW - 30 * SECS_PER_DAY,
    achPct: null,
    category,
    hltbMainHours: null,
    vector: unitVec(appid % DIM),
    tags: ["Action"],
  };
}

// ── weight formula ──
test("weight_formula_known_values", () => {
  // base: 0h → 0; 64h → 1.0. status: completed ×1.5. recency 30d ≈ ~0.98.
  assert.equal(gameWeight(sig(1, 0, "IN_PROGRESS"), NOW), 0);

  const s = sig(2, 64, "IN_PROGRESS");
  s.rtimeLastPlayed = NOW; // no decay
  assert.ok(Math.abs(gameWeight(s, NOW) - 1.0) < 1e-9, "64h fresh in-progress = 1.0");

  const c = sig(3, 64, "COMPLETED");
  c.rtimeLastPlayed = NOW;
  assert.ok(Math.abs(gameWeight(c, NOW) - 1.5) < 1e-9);

  // achievement tilt: 100% ach → ×1.3
  const a = sig(4, 64, "IN_PROGRESS");
  a.rtimeLastPlayed = NOW;
  a.achPct = 100;
  assert.ok(Math.abs(gameWeight(a, NOW) - 1.3) < 1e-9);

  // currently playing multiplier
  const p = sig(5, 64, "IN_PROGRESS");
  p.rtimeLastPlayed = NOW;
  p.hours2weeks = 3;
  assert.ok(Math.abs(gameWeight(p, NOW) - 1.25) < 1e-9);

  // recency floor: decades-old play still counts half
  const old = sig(6, 64, "IN_PROGRESS");
  old.rtimeLastPlayed = NOW - 40 * 365 * SECS_PER_DAY;
  const wOld = gameWeight(old, NOW);
  assert.ok(wOld > 0.49 && wOld < 0.55, `floor ~0.5, got ${wOld}`);

  // NOT_A_GAME contributes nothing
  assert.equal(gameWeight(sig(7, 100, "NOT_A_GAME"), NOW), 0);
});

// ── bounce detection ──
test("bounce_detection_boundaries", () => {
  const old = NOW - 200 * SECS_PER_DAY;

  const s = sig(1, 0.19, "IN_PROGRESS");
  s.rtimeLastPlayed = old;
  assert.equal(detectBounce(s, NOW), "none", "0.19h = never really launched");

  s.hours = 0.2;
  assert.equal(detectBounce(s, NOW), "bounced", "0.2h boundary");

  s.hours = 2.0;
  assert.equal(detectBounce(s, NOW), "bounced", "2.0h boundary");

  s.hours = 2.1;
  assert.equal(detectBounce(s, NOW), "none", "2.1h not bounced (no hltb → not abandoned)");

  // hltb exemption: 1.5h played, hltb main 2h → finished a short game
  const short = sig(2, 1.5, "IN_PROGRESS");
  short.rtimeLastPlayed = old;
  short.hltbMainHours = 2.0;
  assert.equal(detectBounce(short, NOW), "none", "finished short game");

  short.hltbMainHours = 10.0;
  assert.equal(detectBounce(short, NOW), "bounced", "1.5h into a 10h game");

  // recently played → not a bounce
  const recent = sig(3, 1.0, "IN_PROGRESS");
  recent.rtimeLastPlayed = NOW - 30 * SECS_PER_DAY;
  assert.equal(detectBounce(recent, NOW), "none");

  // abandoned: 5h into a 40h game, untouched for >1y
  const ab = sig(4, 5.0, "IN_PROGRESS");
  ab.rtimeLastPlayed = NOW - 400 * SECS_PER_DAY;
  ab.hltbMainHours = 40.0;
  assert.equal(detectBounce(ab, NOW), "abandoned");

  // completed games never bounce
  const done = sig(5, 1.0, "COMPLETED");
  done.rtimeLastPlayed = old;
  assert.equal(detectBounce(done, NOW), "none");

  // never launched → neutral even if ancient
  const never = sig(6, 0, "IN_PROGRESS");
  never.rtimeLastPlayed = 0;
  assert.equal(detectBounce(never, NOW), "none");
});

// ── anti-clusters ──
test("anti_cluster_engagement_normalization", () => {
  const old = NOW - 200 * SECS_PER_DAY;
  const signals: GameSignal[] = [];

  // 3 bounced FPS games
  for (let i = 0; i < 3; i++) {
    const s = sig(100 + i, 1.0, "IN_PROGRESS");
    s.rtimeLastPlayed = old;
    s.tags = ["FPS", "Shooter"];
    s.vector = unitVec(0);
    signals.push(s);
  }

  // Case A: no engaged FPS games → cluster forms
  const profile = computeProfile(signals, NOW);
  assert.equal(profile.antiClusters.length, 1, "one merged FPS cluster");
  assert.equal(profile.antiClusters[0].bounced.length, 3);
  assert.ok(Math.abs(profile.antiClusters[0].strength - 0.5) < 1e-9, "3 bounces / 6 = 0.5");

  // Case B: user also finished 30 FPS games → no anti-cluster
  for (let i = 0; i < 30; i++) {
    const s = sig(200 + i, 64.0, "COMPLETED");
    s.rtimeLastPlayed = NOW;
    s.tags = ["FPS", "Shooter"];
    s.vector = unitVec(1);
    signals.push(s);
  }
  const profileB = computeProfile(signals, NOW);
  assert.equal(profileB.antiClusters.length, 0, "engagement normalization must kill the FPS anti-cluster");
});

test("anti_cluster_ignores_generic_high_prevalence_tags", () => {
  const old = NOW - 200 * SECS_PER_DAY;
  const signals: GameSignal[] = [];
  // 4 bounced games sharing a generic descriptor that is on the whole library
  for (let i = 0; i < 4; i++) {
    const s = sig(300 + i, 1.0, "IN_PROGRESS");
    s.rtimeLastPlayed = old;
    s.tags = ["Indie"];
    signals.push(s);
  }
  // ...and 60 never-launched games carrying the same tag (a typical backlog).
  // Library must clear ANTI_MIN_LIBRARY for the prevalence guard to engage.
  for (let i = 0; i < 60; i++) {
    const s = sig(400 + i, 0, "IN_PROGRESS");
    s.rtimeLastPlayed = 0;
    s.tags = ["Indie"];
    signals.push(s);
  }
  const profile = computeProfile(signals, NOW);
  assert.equal(profile.antiClusters.length, 0,
    "a tag carried by most of the library is a descriptor, not a bounce pattern");
});

test("anti_cluster_requires_lift_over_baseline_in_large_library", () => {
  const old = NOW - 200 * SECS_PER_DAY;
  const signals: GameSignal[] = [];
  // 80 launched games, 40 of them bounced → baseline bounce rate 0.5.
  // "Sim" is spread evenly across both, so it carries no signal beyond baseline.
  for (let i = 0; i < 40; i++) {
    const b = sig(1000 + i, 1.0, "IN_PROGRESS");
    b.rtimeLastPlayed = old;
    b.tags = i < 10 ? ["Sim", "Niche"] : ["Sim"];
    signals.push(b);

    const k = sig(2000 + i, 40.0, "COMPLETED");
    k.rtimeLastPlayed = NOW - 10 * SECS_PER_DAY;
    k.tags = ["Sim"];
    signals.push(k);
  }
  const profile = computeProfile(signals, NOW);
  assert.ok(profile.antiClusters.every((c) => !c.tags.includes("Sim")),
    "a tag that bounces at the library's baseline rate is not an anti-cluster");
});

// ── scoring blend ──
test("tiny_library_blend", () => {
  const profile = computeProfile([sig(1, 64.0, "IN_PROGRESS")], NOW);
  assert.equal(profile.confidence, "low");
  assert.ok(profile.signalCount < 15);

  const v = unitVec(1);
  // T is unit_vec(1) for a single game, so sim = 1.
  const q = (800 + 10) / 1020;
  const small = scoreCandidate(profile, v, 80, 1000);
  assert.ok(Math.abs(small.score - (0.5 + 0.5 * q)) < 1e-6, "small library blends 50/50");

  // fake a big library
  profile.signalCount = 30;
  const big = scoreCandidate(profile, v, 80, 1000);
  assert.ok(Math.abs(big.score - (0.75 + 0.25 * q)) < 1e-6, "big library blends 75/25");
});

test("warning_emitted_for_anti_cluster_match", () => {
  const old = NOW - 200 * SECS_PER_DAY;
  const signals: GameSignal[] = [];
  for (let i = 0; i < 4; i++) {
    const s = sig(100 + i, 1.0, "IN_PROGRESS");
    s.rtimeLastPlayed = old;
    s.tags = ["Competitive"];
    s.vector = unitVec(7);
    signals.push(s);
  }
  // one loved game elsewhere so T isn't the anti direction
  const loved = sig(500, 64.0, "COMPLETED");
  loved.vector = unitVec(9);
  loved.tags = ["RPG"];
  signals.push(loved);

  const profile = computeProfile(signals, NOW);
  assert.equal(profile.antiClusters.length, 1);
  assert.ok(profile.antiClusters[0].strength >= 0.5);

  const scored = scoreCandidate(profile, unitVec(7), 90, 5000);
  assert.ok(scored.warning, "expected bounce warning");
  assert.match(scored.warning!, /bounced off 4/);

  // orthogonal candidate: no warning
  assert.equal(scoreCandidate(profile, unitVec(9), 90, 5000).warning, null);
});

test("anchors_do_not_require_vectors", () => {
  // Deviation from gamekeeper: its vectors ship with the catalog, ours need an
  // embedding run. Defining games must still work before that happens.
  const a = sig(1, 64.0, "COMPLETED");
  a.vector = null;
  const b = sig(2, 4.0, "IN_PROGRESS");
  b.vector = null;
  const profile = computeProfile([a, b], NOW);
  assert.equal(profile.anchorGames.length, 2, "vectorless games still anchor the profile");
  assert.equal(profile.anchorGames[0].appid, 1, "ordered by weight");
  // ...and reasonFor still degrades gracefully with no usable anchor vectors
  assert.equal(reasonFor(profile, unitVec(0), []), "Matches your library's overall profile");
});

// ── franchise / name helpers ──
test("franchise_filter", () => {
  assert.ok(sameFranchise("The Witcher® 3: Wild Hunt", "The Witcher 2"));
  assert.ok(sameFranchise("DARK SOULS™ III", "DARK SOULS™: REMASTERED"));
  assert.ok(sameFranchise("Half-Life 2", "Half-Life"));
  assert.ok(!sameFranchise("The Witcher 3", "The Elder Scrolls V"));
  assert.ok(!sameFranchise("Hades", "Dead Cells"));
  assert.ok(!sameFranchise("Portal 2", "Celeste"));
  // Stopword-blind compare must not merge unrelated "X the Y" titles
  assert.ok(!sameFranchise("Slay the Spire", "Slay the Princess"));
  assert.ok(!sameFranchise("Rise of Industry", "Rise of Nations"));
  // But real franchises with shared meaningful tokens still match
  assert.ok(sameFranchise("Assassin's Creed Origins", "Assassin's Creed Odyssey"));
  assert.ok(sameFranchise("Far Cry 3", "Far Cry Primal"));
});

test("normalize_name_variants", () => {
  assert.equal(normalizeName("The Witcher® 3: Wild Hunt"), "the witcher 3");
  assert.equal(normalizeName("Sekiro™: Shadows Die Twice"), "sekiro");
  assert.equal(normalizeName("Divinity – Original Sin"), "divinity");
});

// ── reasons ──
test("reason_for_names_anchors_and_shared_tags", () => {
  const anchorVec = unitVec(3);
  anchorVec[4] = 0.4;
  const anchor: AnchorGame = { appid: 1, name: "Hades", weight: 1.2, vector: anchorVec };
  const profile: TasteProfile = {
    vector: unitVec(3),
    topTags: [{ tag: "Roguelite", weight: 1.0, exampleAppids: [1] }],
    anchorGames: [anchor],
    antiClusters: [],
    signalCount: 20,
    confidence: "high",
    computedAt: NOW,
  };
  const reason = reasonFor(profile, unitVec(3), ["Roguelite", "Indie"]);
  assert.match(reason, /Hades/, "reason must cite the anchor");
  assert.match(reason, /Roguelite/, "reason must cite shared tag");

  const emptyProfile: TasteProfile = {
    vector: unitVec(0), topTags: [], anchorGames: [], antiClusters: [],
    signalCount: 3, confidence: "low", computedAt: NOW,
  };
  assert.equal(reasonFor(emptyProfile, unitVec(3), ["Puzzle"]), "Matches your library's overall profile");
});

// ── more like this ──
/** Tiny in-memory stand-in for the Phase 4 catalog index. */
function fakeIndex(entries: { meta: CandidateMeta; vector: Float32Array }[]): VectorIndex {
  return {
    topMatches(query, k, keep) {
      return entries
        .map((e, row) => ({ row, sim: e.vector.reduce((acc, x, i) => acc + x * (query[i] || 0), 0) }))
        .filter(({ row }) => !keep || keep(row, entries[row].meta))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k);
    },
    vectorAt: (row) => entries[row].vector,
    metaAt: (row) => entries[row].meta,
  };
}

function meta(appid: number, name: string, tags: string[], developers: string[] = []): CandidateMeta {
  return { appid, name, tags, developers, reviewPositivePct: 90, reviewTotal: 1000 };
}

test("similar_games_excludes_self_franchise_and_marks_owned", () => {
  const hadesVec = unitVec(0);
  const deadCellsVec = new Float32Array(DIM); deadCellsVec[0] = 0.9; deadCellsVec[1] = 0.44;
  const hades2Vec = unitVec(0); // same franchise, should be dropped
  const puzzleVec = unitVec(5);

  const index = fakeIndex([
    { meta: meta(1145360, "Hades", ["Roguelite", "Action"]), vector: hadesVec },
    { meta: meta(588650, "Dead Cells", ["Roguelite", "Metroidvania"]), vector: deadCellsVec },
    { meta: meta(1145361, "Hades II", ["Roguelite", "Action"]), vector: hades2Vec },
    { meta: meta(9999, "Baba Is You", ["Puzzle"]), vector: puzzleVec },
  ]);

  const source = meta(1145360, "Hades", ["Roguelite", "Action"]);
  const sims = similarGames(index, hadesVec, source, new Set([588650]), 5);

  assert.ok(sims.length > 0 && sims.length <= 5);
  assert.ok(sims.every((s) => s.appid !== 1145360), "never recommends itself");
  assert.ok(sims.every((s) => s.appid !== 1145361), "franchise sequels are filtered out");

  const dc = sims.find((s) => s.appid === 588650);
  assert.ok(dc, "Dead Cells should be a neighbour");
  assert.ok(dc!.owned, "owned games must be flagged");
  assert.equal(dc!.nonObvious, false, "same primary tag → obvious");

  const baba = sims.find((s) => s.appid === 9999);
  assert.ok(baba && baba.nonObvious, "cross-genre find is badged unexpected");
  assert.ok(sims[0].similarity > 0);
});

test("similar_games_drops_same_dev_same_leading_token", () => {
  const v = unitVec(0);
  const near = new Float32Array(DIM); near[0] = 0.99; near[1] = 0.14;
  const index = fakeIndex([
    { meta: meta(1, "Portal Stories", ["Puzzle"], ["Valve"]), vector: near },
    { meta: meta(2, "Celeste", ["Platformer"], ["Maddy Makes Games"]), vector: unitVec(2) },
  ]);
  const source = meta(3, "Portal 2", ["Puzzle"], ["Valve"]);
  const sims = similarGames(index, v, source, new Set(), 5);
  assert.ok(sims.every((s) => s.appid !== 1), "same dev + same leading token is a near-duplicate");
});
