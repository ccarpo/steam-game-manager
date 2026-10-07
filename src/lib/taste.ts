// Taste engine core — TypeScript port of gamekeeper's taste.rs.
// Taste vector, bounce detection, anti-clusters, candidate scoring, deterministic
// reasons and "more like this". Formulas are specced; change them only together
// with their tests in taste.test.ts.
// No `@/` imports: must run under plain `node --test`.

import type { Category } from "./classifier.ts";

const SECS_PER_DAY = 86_400;
const SECS_PER_YEAR = 365.25 * 86_400;

/** One owned game with every signal the taste engine needs. */
export interface GameSignal {
  appid: number;
  name: string;
  hours: number;
  hours2weeks: number;
  /** Unix seconds of last session; 0 = never/unknown. */
  rtimeLastPlayed: number;
  /** Achievement completion 0-100 when known. */
  achPct: number | null;
  category: Category;
  hltbMainHours: number | null;
  /** Embedding vector; null = contributes no direction. */
  vector: Float32Array | null;
  /** Community tags in vote order. */
  tags: string[];
  /** Explicit deck>loved / deck>liked lift. */
  deckLoved?: boolean;
  deckLiked?: boolean;
  /** Explicit deck>not_for_me — counts as a bounce for anti-cluster purposes. */
  deckDisliked?: boolean;
}

export interface TagAffinity {
  tag: string;
  /** Normalized 0-1 (top tag = 1.0). */
  weight: number;
  exampleAppids: number[];
}

export interface AnchorGame {
  appid: number;
  name: string;
  weight: number;
  vector: Float32Array | null;
}

export interface BouncedGame {
  appid: number;
  name: string;
  playtimeHours: number;
  lastPlayed: number;
  kind: "bounced" | "abandoned";
}

export interface AntiCluster {
  /** Highest-signal tag, e.g. "Competitive FPS". */
  label: string;
  tags: string[];
  bounced: BouncedGame[];
  /** 0-1, saturates at 6 effective bounces. */
  strength: number;
  vector: Float32Array;
}

export interface TasteProfile {
  vector: Float32Array;
  topTags: TagAffinity[];
  anchorGames: AnchorGame[];
  antiClusters: AntiCluster[];
  /** Games contributing meaningful signal (w >= 0.05). */
  signalCount: number;
  confidence: "low" | "medium" | "high";
  computedAt: number;
}

// ---------------------------------------------------------------------------
// Weights & bounce detection
// ---------------------------------------------------------------------------

/** w(g) = base * status * recency * current * deckBoost */
export function gameWeight(sig: GameSignal, now: number): number {
  const base = Math.log(1 + sig.hours) / Math.log(1 + 64);
  let status: number;
  if (sig.category === "NOT_A_GAME") status = 0;
  else if (sig.category === "COMPLETED") status = 1.5;
  else status = 1 + 0.3 * Math.min((sig.achPct ?? 0) / 100, 1);

  // Deck ratings are softer than playtime/completion but still shift the taste vector.
  const deckBoost = sig.deckLoved ? 1.5 : sig.deckLiked ? 1.25 : 1;

  let recency: number;
  if (sig.rtimeLastPlayed === 0) {
    recency = 0.75;
  } else {
    const years = Math.max(0, now - sig.rtimeLastPlayed) / SECS_PER_YEAR;
    recency = 0.5 + 0.5 * Math.exp(-years / 2);
  }
  const current = sig.hours2weeks > 0 ? 1.25 : 1.0;
  return base * status * recency * current * deckBoost;
}

export type BounceKind = "none" | "bounced" | "abandoned";

export function detectBounce(sig: GameSignal, now: number): BounceKind {
  // Explicit deck dislike is a bounce regardless of completion status.
  if (sig.deckDisliked) return "bounced";
  if (sig.category === "COMPLETED" || sig.category === "NOT_A_GAME") return "none";
  // Never-played games are neutral: you can't bounce off what you never launched.
  if (sig.rtimeLastPlayed === 0) return "none";
  const daysSince = Math.floor(Math.max(0, now - sig.rtimeLastPlayed) / SECS_PER_DAY);

  // A short game actually finished (playtime covers HLTB main) is not a bounce.
  const finishedShort = sig.hltbMainHours != null && sig.hltbMainHours <= sig.hours + 1;

  if (sig.hours >= 0.2 && sig.hours <= 2.0 && daysSince > 180 && sig.hours2weeks === 0 && !finishedShort) {
    return "bounced";
  }
  if (sig.hours > 2.0 && sig.hours <= 10.0 && daysSince > 365
      && sig.hltbMainHours != null && sig.hours < 0.25 * sig.hltbMainHours) {
    return "abandoned";
  }
  return "none";
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

function l2NormalizeInPlace(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function inferDim(signals: GameSignal[]): number {
  for (const s of signals) if (s.vector) return s.vector.length;
  return 0;
}

// ---------------------------------------------------------------------------
// Profile computation
// ---------------------------------------------------------------------------

export function computeProfile(signals: GameSignal[], now: number): TasteProfile {
  const dim = inferDim(signals);
  const weights = new Map<number, number>();
  const bounceKinds = new Map<number, BounceKind>();
  for (const sig of signals) {
    weights.set(sig.appid, gameWeight(sig, now));
    bounceKinds.set(sig.appid, detectBounce(sig, now));
  }

  // Taste vector: weighted sum over non-bounced games with vectors.
  const t = new Float32Array(dim);
  for (const sig of signals) {
    if (bounceKinds.get(sig.appid) !== "none") continue;
    const w = weights.get(sig.appid)!;
    if (w <= 0) continue;
    if (!sig.vector) continue;
    const n = Math.min(dim, sig.vector.length);
    for (let i = 0; i < n; i++) t[i] += w * sig.vector[i];
  }
  l2NormalizeInPlace(t);

  const signalCount = signals.filter((s) => weights.get(s.appid)! >= 0.05).length;
  const confidence: TasteProfile["confidence"] =
    signalCount < 8 ? "low" : signalCount < 20 ? "medium" : "high";

  // Tag affinities: sum w(g) per tag over non-bounced games.
  const tagWeight = new Map<string, number>();
  const tagExamples = new Map<string, { w: number; appid: number }[]>();
  for (const sig of signals) {
    if (bounceKinds.get(sig.appid) !== "none") continue;
    const w = weights.get(sig.appid)!;
    if (w < 0.05) continue;
    for (const tag of sig.tags.slice(0, 10)) {
      tagWeight.set(tag, (tagWeight.get(tag) || 0) + w);
      if (!tagExamples.has(tag)) tagExamples.set(tag, []);
      tagExamples.get(tag)!.push({ w, appid: sig.appid });
    }
  }
  const maxTagW = Math.max(1e-9, ...[...tagWeight.values(), 0]);
  const topTags: TagAffinity[] = [...tagWeight.entries()].map(([tag, w]) => {
    const ex = [...(tagExamples.get(tag) || [])].sort((a, b) => b.w - a.w);
    return { tag, weight: w / maxTagW, exampleAppids: ex.slice(0, 3).map((e) => e.appid) };
  });
  topTags.sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag));
  topTags.length = Math.min(topTags.length, 12);

  // Anchors: top-10 by weight among non-bounced games. Unlike gamekeeper (whose
  // vectors ship with the catalog) a vector is NOT required here, so "defining
  // games" still works before any embedding run. reasonFor() skips vectorless
  // anchors on its own.
  const anchorGames: AnchorGame[] = signals
    .filter((s) => bounceKinds.get(s.appid) === "none" && weights.get(s.appid)! > 0)
    .map((s) => ({ appid: s.appid, name: s.name, weight: weights.get(s.appid)!, vector: s.vector }));
  anchorGames.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  anchorGames.length = Math.min(anchorGames.length, 10);

  const antiClusters = buildAntiClusters(signals, weights, bounceKinds, dim);

  return { vector: t, topTags, anchorGames, antiClusters, signalCount, confidence, computedAt: now };
}

/**
 * Guards added on top of gamekeeper's rule, because its dominance ratio assumes a
 * small, mostly-played library. In a large backlog `engaged` (w >= 0.3) is near
 * zero for almost every tag, so the ratio passes for anything with 2+ bounces and
 * you get nonsense mega-clusters like "Indie (147 games)".
 */
const ANTI_MAX_PREVALENCE = 0.25; // generic descriptors ("Action", "Indie") can't be labels
const ANTI_MIN_LIFT = 1.5;        // must bounce 1.5x the library's own baseline rate
const ANTI_MAX_CLUSTER_TAGS = 6;  // keep merged labels meaningful
/**
 * Both extra guards need a library big enough to *have* a baseline. Below this
 * they are skipped and the original gamekeeper rule applies unchanged — in a
 * 5-game library every tag is "100% prevalent" and nothing can show lift.
 */
const ANTI_MIN_LIBRARY = 50;

/** A game counts as "launched" once it has a real session behind it. */
function isLaunched(sig: GameSignal): boolean {
  return sig.rtimeLastPlayed > 0 && sig.hours >= 0.2;
}

function buildAntiClusters(
  signals: GameSignal[],
  weights: Map<number, number>,
  bounceKinds: Map<number, BounceKind>,
  dim: number,
): AntiCluster[] {
  // n(t): 1.0 per bounce, 0.5 per abandon, over each bounced game's top-5 tags.
  const tagN = new Map<string, number>();
  const tagGames = new Map<string, Set<number>>();
  const bouncedSigs = signals.filter((s) => bounceKinds.get(s.appid) !== "none");

  for (const sig of bouncedSigs) {
    const contribution = bounceKinds.get(sig.appid) === "bounced" ? 1.0 : 0.5;
    for (const tag of sig.tags.slice(0, 5)) {
      tagN.set(tag, (tagN.get(tag) || 0) + contribution);
      if (!tagGames.has(tag)) tagGames.set(tag, new Set());
      tagGames.get(tag)!.add(sig.appid);
    }
  }

  // engaged(t): owned, non-bounced games with tag t and w >= 0.3.
  const engaged = new Map<string, number>();
  for (const sig of signals) {
    if (bounceKinds.get(sig.appid) !== "none") continue;
    if (weights.get(sig.appid)! < 0.3) continue;
    for (const tag of sig.tags.slice(0, 10)) engaged.set(tag, (engaged.get(tag) || 0) + 1);
  }

  // Prevalence + per-tag launch counts, for the discriminative guards below.
  const tagged = signals.filter((s) => s.tags.length > 0).length;
  const launchedTotal = signals.filter(isLaunched).length;
  const bouncedTotal = bouncedSigs.length;
  const baselineRate = launchedTotal > 0 ? bouncedTotal / launchedTotal : 0;
  const tagOwned = new Map<string, number>();
  const tagLaunched = new Map<string, number>();
  for (const sig of signals) {
    const launched = isLaunched(sig);
    for (const tag of sig.tags.slice(0, 10)) {
      tagOwned.set(tag, (tagOwned.get(tag) || 0) + 1);
      if (launched) tagLaunched.set(tag, (tagLaunched.get(tag) || 0) + 1);
    }
  }
  // Only trust these once the library is big enough to have a baseline.
  const usePrevalence = tagged >= ANTI_MIN_LIBRARY;
  const useLift = launchedTotal >= ANTI_MIN_LIBRARY && baselineRate > 0;

  // Anti-tags: n >= 2, dominance ratio >= 0.6, not a generic descriptor, and
  // (in a library with a real baseline) bouncing well above that baseline.
  const antiTags = [...tagN.entries()]
    .filter(([tag, n]) => {
      const e = engaged.get(tag) || 0;
      if (n < 2.0 || n / (n + e) < 0.6) return false;
      if (usePrevalence && (tagOwned.get(tag) || 0) / tagged >= ANTI_MAX_PREVALENCE) return false;
      if (useLift) {
        const launchedWithTag = tagLaunched.get(tag) || 0;
        if (launchedWithTag === 0) return false;
        if ((n / launchedWithTag) / baselineRate < ANTI_MIN_LIFT) return false;
      }
      return true;
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Merge anti-tags whose bounced-game sets overlap >= 50% into clusters.
  const clusters: { tags: string[]; games: Set<number> }[] = [];
  for (const [tag] of antiTags) {
    const games = tagGames.get(tag)!;
    let merged = false;
    for (const c of clusters) {
      let inter = 0;
      for (const g of games) if (c.games.has(g)) inter++;
      const smaller = Math.max(1, Math.min(games.size, c.games.size));
      if (inter / smaller >= 0.5 && c.tags.length < ANTI_MAX_CLUSTER_TAGS) {
        c.tags.push(tag);
        for (const g of games) c.games.add(g);
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ tags: [tag], games: new Set(games) });
  }

  const byAppid = new Map(signals.map((s) => [s.appid, s]));
  return clusters.map(({ tags, games }) => {
    let nCluster = 0;
    const bounced: BouncedGame[] = [];
    const vecSum = new Float32Array(dim);
    for (const appid of games) {
      const sig = byAppid.get(appid)!;
      const kind = bounceKinds.get(appid)!;
      nCluster += kind === "bounced" ? 1.0 : kind === "abandoned" ? 0.5 : 0;
      bounced.push({
        appid: sig.appid,
        name: sig.name,
        playtimeHours: sig.hours,
        lastPlayed: sig.rtimeLastPlayed,
        kind: kind === "abandoned" ? "abandoned" : "bounced",
      });
      if (sig.vector) {
        const n = Math.min(dim, sig.vector.length);
        for (let i = 0; i < n; i++) vecSum[i] += sig.vector[i];
      }
    }
    l2NormalizeInPlace(vecSum);
    bounced.sort((a, b) => a.name.localeCompare(b.name));
    return {
      label: tags[0],
      tags: [...tags],
      bounced,
      strength: Math.min(nCluster / 6.0, 1.0),
      vector: vecSum,
    };
  });
}

// ---------------------------------------------------------------------------
// Candidate scoring (Discover / wishlist)
// ---------------------------------------------------------------------------

export interface ScoredCandidate {
  score: number;
  sim: number;
  quality: number;
  warning: string | null;
}

export function scoreCandidate(
  profile: TasteProfile,
  candidateVec: Float32Array,
  reviewPositivePct: number,
  reviewTotal: number,
): ScoredCandidate {
  const sim = Math.min(1, Math.max(0, dot(profile.vector, candidateVec)));
  const positive = reviewTotal * reviewPositivePct / 100;
  const quality = (positive + 10) / (reviewTotal + 20);

  let penalty = 0;
  let warning: string | null = null;
  for (const cluster of profile.antiClusters) {
    const d = dot(cluster.vector, candidateVec);
    const p = cluster.strength * 0.35 * (Math.max(d - 0.45, 0) / 0.55);
    if (p > penalty) penalty = p;
    if (d >= 0.55 && cluster.strength >= 0.5 && warning === null) {
      const n = cluster.bounced.length;
      warning = `You've bounced off ${n} ${cluster.label} game${n === 1 ? "" : "s"} — this looks like one`;
    }
  }

  const [ws, wq] = profile.signalCount < 15 ? [0.5, 0.5] : [0.75, 0.25];
  return { score: ws * sim + wq * quality - penalty, sim, quality, warning };
}

/**
 * Deterministic reason string: top-2 anchors by dot (among anchors with w >= 0.3)
 * plus tag intersection with the user's top tags.
 */
export function reasonFor(
  profile: TasteProfile,
  candidateVec: Float32Array,
  candidateTags: string[],
): string {
  const scoredAnchors = profile.anchorGames
    .filter((a) => a.weight >= 0.3 && a.vector)
    .map((a) => ({ a, d: dot(a.vector!, candidateVec) }))
    .sort((x, y) => y.d - x.d);

  let anchorPart = "";
  if (scoredAnchors.length === 1) anchorPart = `Because you played ${scoredAnchors[0].a.name}`;
  else if (scoredAnchors.length >= 2) anchorPart = `Because you played ${scoredAnchors[0].a.name} and ${scoredAnchors[1].a.name}`;

  const userTags = new Set(profile.topTags.map((t) => t.tag));
  const shared = candidateTags.slice(0, 8).filter((t) => userTags.has(t)).slice(0, 2);

  if (anchorPart && shared.length) return `${anchorPart} · ${shared.join(", ")}`;
  if (anchorPart) return anchorPart;
  if (shared.length) return shared.join(", ");
  return "Matches your library's overall profile";
}

// ---------------------------------------------------------------------------
// "More like this"
// ---------------------------------------------------------------------------

/** Lowercase, strip ™®©, cut subtitle after ":" or "–". */
export function normalizeName(name: string): string {
  const cleaned = [...name].filter((c) => c !== "™" && c !== "®" && c !== "©").join("");
  const head = cleaned.split(/[:–]/)[0] ?? cleaned;
  return head.trim().toLowerCase();
}

function isStopword(t: string): boolean {
  return t === "the" || t === "of" || t === "a" || t === "an" || t === "and";
}

function isNumericIsh(t: string): boolean {
  if (!t) return false;
  return /^[0-9]+$/.test(t) || /^[ivxlcdm]+$/.test(t);
}

/**
 * Same franchise: one normalized name prefixes the other, or the first two
 * MEANINGFUL tokens match (stopwords skipped — otherwise "Slay the Spire" and
 * "Slay the Princess" both reduce to "slay the" and false-positive). Numeric
 * second tokens ("3" vs "2") still count as the same franchise.
 */
export function sameFranchise(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na.startsWith(nb) || nb.startsWith(na)) return true;
  const ta = na.split(/\s+/).filter((t) => t && !isStopword(t)).slice(0, 2);
  const tb = nb.split(/\s+/).filter((t) => t && !isStopword(t)).slice(0, 2);
  if (ta.length < 2 || tb.length < 2 || ta[0] !== tb[0]) return false;
  return ta[1] === tb[1] || (isNumericIsh(ta[1]) && isNumericIsh(tb[1]));
}

export interface CandidateMeta {
  appid: number;
  name: string;
  tags: string[];
  developers: string[];
  reviewPositivePct: number;
  reviewTotal: number;
}

/** Minimal vector index contract — satisfied by the Phase 4 catalog index. */
export interface VectorIndex {
  /** Best `k` rows by dot product, filtered by `keep`. Sorted descending. */
  topMatches(query: Float32Array, k: number, keep?: (row: number, meta: CandidateMeta) => boolean): { row: number; sim: number }[];
  vectorAt(row: number): Float32Array;
  metaAt(row: number): CandidateMeta;
}

export interface SimilarGame {
  appid: number;
  name: string;
  similarity: number;
  tags: string[];
  reviewPositivePct: number;
  reviewTotal: number;
  /** Cross-genre find (primary tag differs from the source game's). */
  nonObvious: boolean;
  owned: boolean;
}

/**
 * Nearest neighbours excluding franchise/developer near-duplicates, diversified
 * with MMR (lambda = 0.75).
 */
export function similarGames(
  index: VectorIndex,
  sourceVec: Float32Array,
  sourceMeta: CandidateMeta,
  ownedAppids: Set<number>,
  k: number,
): SimilarGame[] {
  const sourceDev = new Set(sourceMeta.developers);
  const sourceLead = normalizeName(sourceMeta.name).split(/\s+/)[0] || "";

  const pool = index.topMatches(sourceVec, 200, (_row, m) => m.appid !== sourceMeta.appid);

  // Drop franchise + same-dev-same-leading-token near-duplicates.
  const filtered = pool.filter(({ row }) => {
    const m = index.metaAt(row);
    if (sameFranchise(m.name, sourceMeta.name)) return false;
    const sharesDev = m.developers.some((d) => sourceDev.has(d));
    const lead = normalizeName(m.name).split(/\s+/)[0] || "";
    return !(sharesDev && sourceLead && lead === sourceLead);
  });

  // MMR diversification.
  const lambda = 0.75;
  const selected: { row: number; sim: number }[] = [];
  const remaining = [...filtered];
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const { row, sim } = remaining[i];
      let maxSel = 0;
      for (const s of selected) {
        const d = dot(index.vectorAt(row), index.vectorAt(s.row));
        if (d > maxSel) maxSel = d;
      }
      const mmr = lambda * sim - (1 - lambda) * maxSel;
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  const sourcePrimary = sourceMeta.tags[0] || "";
  return selected.map(({ row, sim }) => {
    const m = index.metaAt(row);
    return {
      appid: m.appid,
      name: m.name,
      similarity: sim,
      tags: m.tags.slice(0, 5),
      reviewPositivePct: m.reviewPositivePct,
      reviewTotal: m.reviewTotal,
      nonObvious: (m.tags[0] || "") !== sourcePrimary,
      owned: ownedAppids.has(m.appid),
    };
  });
}
