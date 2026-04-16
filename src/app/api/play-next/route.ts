import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";
import { steamDbScore } from "@/lib/types";

export const dynamic = "force-dynamic";

interface GameRow {
  id: number; name: string; steam_appid: number | null;
  positive_percent: number; total_reviews: number;
  release_date: string; added_at: string | null;
  steam_genres: string; community_tags: string; developers: string;
  user_rating: number | null;
  queue_position: number | null;
}

function safeJsonParse(s: string | null): string[] {
  if (!s) return [];
  try { const p = JSON.parse(s); if (!Array.isArray(p)) return []; return p.length > 0 && typeof p[0] === "object" ? p.map((t: { name: string }) => t.name) : p; } catch { return []; }
}

/** Parse community tags with counts — handles both ["tag"] and [{name,count}] formats */
function parseCtagsWithCounts(s: string | null): { name: string; count: number }[] {
  if (!s) return [];
  try {
    const p = JSON.parse(s);
    if (!Array.isArray(p) || p.length === 0) return [];
    if (typeof p[0] === "string") return p.map((name: string) => ({ name, count: 0 }));
    return p.map((t: { name: string; count?: number }) => ({ name: t.name, count: t.count || 0 }));
  } catch { return []; }
}

function parseDev(s: string): string[] {
  if (!s) return [];
  return s.startsWith("[") ? safeJsonParse(s) : s.split(",").map(x => x.trim()).filter(Boolean);
}

function parseYear(rd: string): number {
  if (!rd) return 0;
  const m = rd.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0]) : 0;
}

/** Build preference profile from played games, weighted by user_rating */
function buildProfile(playedGames: GameRow[], ctagWeightMode: "count" | "inverse") {
  const genreFreq = new Map<string, number>();
  const devFreq = new Map<string, number>();
  const ctagFreq = new Map<string, number>();

  for (const g of playedGames) {
    // user_rating 1-10 → multiplier 0.1-1.0. Unrated = 0.5 (neutral)
    const w = g.user_rating ? g.user_rating / 10 : 0.5;
    for (const genre of safeJsonParse(g.steam_genres)) genreFreq.set(genre, (genreFreq.get(genre) || 0) + w);
    for (const d of parseDev(g.developers)) devFreq.set(d, (devFreq.get(d) || 0) + w);
    for (const t of safeJsonParse(g.community_tags)) ctagFreq.set(t, (ctagFreq.get(t) || 0) + w);
  }

  const normalize = (m: Map<string, number>) => {
    const max = Math.max(...m.values(), 1);
    const out = new Map<string, number>();
    for (const [k, v] of m) out.set(k, v / max);
    return out;
  };

  // For community tags: weight by vote count or inverse
  // "count" mode: popular tags get higher weight (more users agree = stronger signal)
  // "inverse" mode: rare tags get higher weight (more distinctive)
  const normalizedCtags = normalize(ctagFreq);
  // We don't have per-tag vote counts from played games here, so we use frequency as proxy

  return {
    genres: normalize(genreFreq),
    devs: normalize(devFreq),
    ctags: normalizedCtags,
    ctagWeightMode,
  };
}

interface Weights {
  genreMatch: number;  // Steam genres
  devMatch: number;    // Developer/publisher match
  ctagMatch: number;   // Community tags
  score: number;       // Score quality
  maturity: number;    // Release maturity
  waiting: number;     // Time in library
  ratedMatch: number;  // Similarity to user-rated games
}

const DEFAULT_WEIGHTS: Weights = { genreMatch: 0.25, devMatch: 0.05, ctagMatch: 0.20, score: 0.20, maturity: 0.15, waiting: 0.15, ratedMatch: 0 };

function scoreGame(
  game: GameRow,
  profile: ReturnType<typeof buildProfile>,
  weights: Weights,
  now: number,
  scoreSource: "steam" | "steamdb",
  sweetSpot: { min: number; max: number } = { min: 70, max: 85 },
  tagIdf: Map<string, number> = new Map(),
  ratedProfiles: { genres: Set<string>; ctags: Set<string>; weight: number }[] = [],
  waitingCapDays: number = 365,
) {
  const breakdown: Record<string, number> = {};

  // 1. Steam genre match
  const genres = safeJsonParse(game.steam_genres);
  let gScore = 0;
  for (const g of genres) gScore += profile.genres.get(g) || 0;
  breakdown.genreMatch = genres.length > 0 ? gScore / genres.length : 0;

  // 2. Developer/publisher match
  const devs = parseDev(game.developers);
  let dScore = 0;
  for (const d of devs) dScore += profile.devs.get(d) || 0;
  breakdown.devMatch = devs.length > 0 ? Math.min(1, dScore / devs.length) : 0;

  // 3. Community tag match — weighted by vote count, optionally with IDF
  const ctagsWithCounts = parseCtagsWithCounts(game.community_tags);
  let cScore = 0, cWeightSum = 0;
  const useIdf = tagIdf.size > 0; // IDF available = use it (configurable via caller)
  for (const t of ctagsWithCounts) {
    const profileMatch = profile.ctags.get(t.name) || 0;
    const countWeight = t.count > 0 ? Math.min(1, t.count / 2000) : 0.1; // no count data = low confidence
    const idf = useIdf ? (tagIdf.get(t.name) || 0.5) : 1;
    const w = countWeight * idf;
    cScore += profileMatch * w;
    cWeightSum += w;
  }
  breakdown.ctagMatch = cWeightSum > 0 ? Math.min(1, cScore / cWeightSum) : 0;

  // 4. Score quality — configurable sweet spot
  const rawScore = scoreSource === "steamdb" && game.total_reviews > 0
    ? steamDbScore(game.positive_percent, game.total_reviews)
    : game.positive_percent;
  if (rawScore >= sweetSpot.min && rawScore <= sweetSpot.max) breakdown.score = 1.0;
  else if (rawScore > sweetSpot.max && rawScore <= 95) breakdown.score = 0.85;
  else if (rawScore > 95) breakdown.score = 0.75;
  else if (rawScore >= 50) breakdown.score = 0.5;
  else if (rawScore > 0) breakdown.score = 0.2;
  else breakdown.score = 0.1;

  // 4. Release maturity — older = more polished
  const year = parseYear(game.release_date);
  const currentYear = new Date().getFullYear();
  if (year > 0) breakdown.maturity = Math.min(1, (currentYear - year) / 5);
  else breakdown.maturity = 0.3;

  // 5. Waiting time — longer in library = nudge
  if (game.added_at) {
    const days = (now - new Date(game.added_at).getTime()) / (1000 * 60 * 60 * 24);
    breakdown.waiting = Math.min(1, days / waitingCapDays);
  } else breakdown.waiting = 0.5;

  // 7. Rated match — similarity to user-rated games, weighted by rating
  if (ratedProfiles.length > 0) {
    const gameGenres = new Set(safeJsonParse(game.steam_genres));
    const gameCtags = new Set(safeJsonParse(game.community_tags));
    let matchSum = 0, weightSum = 0;
    for (const rp of ratedProfiles) {
      // Per-rated-game: what fraction of its tags does the candidate share?
      let overlap = 0, rpTotal = 0;
      for (const g of rp.genres) { rpTotal++; if (gameGenres.has(g)) overlap++; }
      for (const t of rp.ctags) { rpTotal++; if (gameCtags.has(t)) overlap++; }
      const sim = rpTotal > 0 ? overlap / rpTotal : 0;
      // Weight by rating squared for stronger differentiation (rating 9 → 81, rating 5 → 25)
      const w = rp.weight * rp.weight;
      matchSum += sim * w;
      weightSum += w;
    }
    breakdown.ratedMatch = weightSum > 0 ? matchSum / weightSum : 0;
  } else {
    breakdown.ratedMatch = 0;
  }

  const total =
    breakdown.genreMatch * weights.genreMatch +
    breakdown.devMatch * weights.devMatch +
    breakdown.ctagMatch * weights.ctagMatch +
    breakdown.score * weights.score +
    breakdown.maturity * weights.maturity +
    breakdown.waiting * weights.waiting +
    breakdown.ratedMatch * weights.ratedMatch;

  return { total: Math.round(total * 100) / 100, breakdown };
}

export async function GET() {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  const getSetting = (key: string, fallback: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || fallback;
  };

  // Load weights (user enters any numbers, we normalize)
  let weights: Weights & { priority: number } = { ...DEFAULT_WEIGHTS, priority: 0.15 };
  try {
    const rawStr = getSetting("rec_weights", "");
    if (rawStr) {
      const raw = JSON.parse(rawStr) as Record<string, number>;
      const sum = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
      weights = {
        genreMatch: (raw.genreMatch || 0) / sum,
        devMatch: (raw.devMatch || 0) / sum,
        ctagMatch: (raw.ctagMatch || 0) / sum,
        score: (raw.score || 0) / sum,
        maturity: (raw.maturity || 0) / sum,
        waiting: (raw.waiting || 0) / sum,
        ratedMatch: (raw.ratedMatch || 0) / sum,
        priority: (raw.priority || 0) / sum,
      };
    }
  } catch {}

  const scoreSource = getSetting("score_source", "steamdb") === "steam" ? "steam" as const : "steamdb" as const;
  const ctagWeightMode = getSetting("rec_ctag_mode", "count") === "inverse" ? "inverse" as const : "count" as const;

  // Three categories
  let playedSubtags = ["done", "played_elsewhere"];
  try { playedSubtags = JSON.parse(getSetting("rec_played", '["done","played_elsewhere"]')); } catch {}

  let priorityConfig: { subtag: string; boost: number }[] = [{ subtag: "next", boost: 30 }, { subtag: "franchise", boost: 20 }];
  try { priorityConfig = JSON.parse(getSetting("rec_priority", "[]")); } catch {}

  let excludeSubtags = ["hide", "not_my_type"];
  try { excludeSubtags = JSON.parse(getSetting("rec_exclude", '["hide","not_my_type"]')); } catch {}

  // Load all games + tags (as tag>subtag pairs for matching)
  const allGames = db.prepare("SELECT id, name, steam_appid, positive_percent, total_reviews, release_date, added_at, steam_genres, community_tags, developers, user_rating, queue_position FROM games").all() as GameRow[];

  const gameTagPairs = new Map<number, string[]>(); // "tag>subtag" pairs per game
  const tagRows = db.prepare(`
    SELECT gt.game_id, t.name as tag_name, s.name as subtag_name
    FROM game_tags gt JOIN tags t ON t.id = gt.tag_id LEFT JOIN subtags s ON s.id = gt.subtag_id
  `).all() as { game_id: number; tag_name: string; subtag_name: string | null }[];
  for (const r of tagRows) {
    if (!gameTagPairs.has(r.game_id)) gameTagPairs.set(r.game_id, []);
    const pair = r.subtag_name ? `${r.tag_name}>${r.subtag_name}` : r.tag_name;
    gameTagPairs.get(r.game_id)!.push(pair);
    // Also add bare subtag name for backward compat with old configs
    if (r.subtag_name) gameTagPairs.get(r.game_id)!.push(r.subtag_name);
  }

  // Categorize games: played (training), excluded, unsure, candidates
  const played: GameRow[] = [];
  const gameCategory = new Map<number, string>(); // id → "played" | "excluded" | "unsure" | "candidate"

  const maxBoost = Math.max(...priorityConfig.map(p => p.boost), 1);
  const prioMap = new Map(priorityConfig.map(p => [p.subtag, p.boost / maxBoost]));

  for (const g of allGames) {
    const pairs = gameTagPairs.get(g.id) || [];
    if (pairs.some(p => excludeSubtags.includes(p))) { gameCategory.set(g.id, "excluded"); }
    else if (pairs.some(p => playedSubtags.includes(p))) { played.push(g); gameCategory.set(g.id, "played"); }
    else if (pairs.some(p => p.endsWith(">unsure") || p === "unsure")) { gameCategory.set(g.id, "unsure"); }
    else { gameCategory.set(g.id, "candidate"); }
  }

  // Include all user-rated games in training (configurable)
  let useAllRated = false;
  try { useAllRated = getSetting("rec_use_all_rated", "0") === "1"; } catch {}

  const trainingGames = useAllRated
    ? allGames.filter(g => {
        const cat = gameCategory.get(g.id);
        return cat === "played" || (g.user_rating != null && cat !== "excluded");
      })
    : played;

  const profile = buildProfile(trainingGames, ctagWeightMode);

  // Apply genre preferences (boost/penalty) to profile
  let genrePrefs: { tag: string; value: number }[] = [];
  try { genrePrefs = JSON.parse(getSetting("rec_genre_prefs", "[]")); } catch {}
  if (genrePrefs.length > 0) {
    const maxPref = Math.max(...genrePrefs.map(p => Math.abs(p.value)), 1);
    for (const pref of genrePrefs) {
      const normalized = pref.value / maxPref; // -1 to 1
      // Apply to both genres and ctags profiles
      const current = profile.genres.get(pref.tag) || profile.ctags.get(pref.tag) || 0;
      const adjusted = Math.max(0, Math.min(1, current + normalized));
      profile.genres.set(pref.tag, adjusted);
      profile.ctags.set(pref.tag, adjusted);
    }
  }

  const now = Date.now();

  let sweetSpot = { min: 70, max: 85 };
  try { const ss = getSetting("rec_sweet_spot", ""); if (ss) sweetSpot = JSON.parse(ss); } catch {}

  const waitingCapDays = parseInt(getSetting("rec_waiting_cap", "1825")) || 1825;

  // Compute IDF — only when ctagWeightMode is "inverse"
  const tagIdf = new Map<string, number>();
  if (ctagWeightMode === "inverse") {
    const tagDocCount = new Map<string, number>();
    for (const g of allGames) {
      for (const t of safeJsonParse(g.community_tags)) tagDocCount.set(t, (tagDocCount.get(t) || 0) + 1);
    }
    const totalDocs = allGames.length || 1;
    for (const [tag, count] of tagDocCount) {
      tagIdf.set(tag, Math.min(1, Math.log(totalDocs / count) / Math.log(totalDocs)));
    }
  }

  // Build per-game profiles for ratedMatch signal (user-rated + curated games)
  const ratedOrCurated = allGames.filter(g => gameCategory.get(g.id) !== "excluded" &&
    ((g.user_rating != null && g.user_rating > 0) || (g.queue_position != null)));
  // Normalize curation: position 1 = highest weight, max position = lowest
  const maxQueuePos = Math.max(...ratedOrCurated.map(g => g.queue_position ?? 0), 1);
  const ratedProfiles = ratedOrCurated.map(g => {
    // Combine both signals: user_rating (0.1-1.0) and curation (inverted, 0.2-1.0)
    const ratingW = g.user_rating ? g.user_rating / 10 : 0;
    const curationW = g.queue_position != null ? Math.max(0.2, 1 - (g.queue_position - 1) / maxQueuePos) : 0;
    // Take the max of both — if a game has both, the stronger signal wins
    const weight = Math.max(ratingW, curationW) || 0.5;
    return {
      genres: new Set(safeJsonParse(g.steam_genres)),
      ctags: new Set(safeJsonParse(g.community_tags)),
      weight,
    };
  }).filter(p => p.weight > 0);

  const scoreWithPrio = (g: GameRow) => {
    const base = scoreGame(g, profile, weights, now, scoreSource, sweetSpot, tagIdf, ratedProfiles, waitingCapDays);
    const pairs = gameTagPairs.get(g.id) || [];
    let prioBoost = 0;
    for (const p of pairs) { prioBoost = Math.max(prioBoost, prioMap.get(p) || 0); }
    base.breakdown.priority = prioBoost;
    base.total = Math.round((base.total + prioBoost * weights.priority) * 100) / 100;
    return base;
  };

  const SIGNAL_LABELS: Record<string, string> = {
    genreMatch: "Genre match", devMatch: "Dev/Pub match", ctagMatch: "Community tags",
    score: "Score quality", maturity: "Mature/polished", waiting: "Long in library",
    ratedMatch: "⭐📋 Personal match", priority: "Priority tag",
  };

  const getReasons = (breakdown: Record<string, number>): string[] => {
    return Object.entries(breakdown)
      .sort((a, b) => {
        const order = ["genreMatch", "devMatch", "ctagMatch", "score", "maturity", "waiting", "ratedMatch", "priority"];
        return order.indexOf(a[0]) - order.indexOf(b[0]);
      })
      .map(([k, v]) => {
        const w = (weights as unknown as Record<string, number>)[k] || 0;
        const contribution = Math.round(v * w * 100);
        return `${SIGNAL_LABELS[k] || k}: ${Math.round(v * 100)}% (→${contribution})`;
      });
  };

  // Score ALL games
  const allScored = allGames.map(g => {
    const s = scoreWithPrio(g);
    const cat = gameCategory.get(g.id) || "candidate";
    return { id: g.id, name: g.name, steam_appid: g.steam_appid, category: cat, ...s, reasons: getReasons(s.breakdown) };
  });

  allScored.sort((a, b) => b.total - a.total);

  return NextResponse.json({
    games: allScored,
    profile: {
      playedCount: played.length,
      genres: [...profile.genres.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, weight: Math.round(v * 100) })),
      devs: [...profile.devs.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, weight: Math.round(v * 100) })),
      ctags: [...profile.ctags.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, weight: Math.round(v * 100) })),
    },
    weights,
    config: { scoreSource, ctagWeightMode, excludeSubtags, sweetSpot },
  });
}
