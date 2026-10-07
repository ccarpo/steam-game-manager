// Builds the chat system-prompt context from the database: taste profile,
// candidate lists and library stats. The prompt itself is rendered by
// chat-prompt.ts, which stays import-free so it is testable under node --test.

import { Database } from "./sqlite";
import { buildProfile, fetchLibrary, fetchVectors, scoreLibraryRows } from "./taste-data";
import { formatChatContext } from "./chat-prompt";
import type { ChatContextInput } from "./chat-prompt";

const HOURS_EPS = 0.05; // ~3 minutes: Steam counts launcher idling as playtime

// ---------------------------------------------------------------------------
// DB assembly
// ---------------------------------------------------------------------------

export interface ChatContext {
  systemPrompt: string;
  /** Diagnostics for the API response/UI badge. */
  stats: {
    owned: number;
    unstarted: number;
    inProgress: number;
    withHltb: number;
    hasTasteVector: boolean;
    confidence: string;
  };
}

/**
 * Assembles the context block. Candidate lists are taste-scored when vectors
 * exist (so "top picks" reflect the profile), otherwise they fall back to
 * review-quality ordering — the chat must work before embeddings are run.
 */
export function buildChatContext(db: Database, model: string): ChatContext {
  const bundle = buildProfile(db, model);
  const vectors = fetchVectors(db, model);
  const owned = fetchLibrary(db, "owned");
  const wishlist = fetchLibrary(db, "wishlist");
  const p = bundle.profile;

  const unstarted = owned.filter((r) => (r.playtime_forever || 0) / 60 < HOURS_EPS && r.category !== "NOT_A_GAME");
  const inProgress = owned.filter(
    (r) => (r.playtime_forever || 0) / 60 >= HOURS_EPS && r.category === "IN_PROGRESS"
  );
  const recentlyPlayed = owned
    .filter((r) => (r.playtime_2weeks || 0) > 0)
    .sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))
    .slice(0, 8);

  // Score candidates against the taste vector when available.
  const scoredUnstarted = scoreLibraryRows(bundle, unstarted, vectors).scored.slice(0, 20);
  const scoredWishlist = scoreLibraryRows(bundle, wishlist, vectors).scored.slice(0, 12);
  const shortGames = scoredUnstarted
    .filter((g) => g.hltbMain != null && g.hltbMain <= 8)
    .slice(0, 12);

  const byAppid = new Map(owned.map((r) => [r.steam_appid, r]));
  const withHltb = owned.filter((r) => r.hltb_main != null).length;

  const input: ChatContextInput = {
    topTags: p.topTags,
    defining: p.anchorGames.slice(0, 8).map((a) => {
      const row = byAppid.get(a.appid);
      return {
        name: a.name,
        hoursPlayed: (row?.playtime_forever || 0) / 60,
        completed: row?.category === "COMPLETED",
      };
    }),
    antiClusters: p.antiClusters,
    recent: recentlyPlayed.map((r) => ({
      name: r.name,
      recentHours: (r.playtime_2weeks || 0) / 60,
      totalHours: (r.playtime_forever || 0) / 60,
    })),
    inProgress: [...inProgress]
      .sort((a, b) => (b.rtime_last_played || 0) - (a.rtime_last_played || 0))
      .slice(0, 15)
      .map((r) => ({ name: r.name, hoursIn: (r.playtime_forever || 0) / 60, hltb: r.hltb_main })),
    unstartedPicks: scoredUnstarted.map((g) => ({
      name: g.name, fit: Math.round(g.score * 100), hltb: g.hltbMain, tags: g.tags,
    })),
    shortGames: shortGames.map((g) => ({
      name: g.name, hltb: g.hltbMain!, fit: Math.round(g.score * 100),
    })),
    wishlistPicks: scoredWishlist.map((g) => ({
      name: g.name, fit: Math.round(g.score * 100), hltb: g.hltbMain,
    })),
    counts: {
      owned: owned.length,
      unstarted: unstarted.length,
      wishlist: wishlist.length,
      withHltb,
      confidence: p.confidence,
    },
  };

  return {
    systemPrompt: formatChatContext(input),
    stats: {
      owned: owned.length,
      unstarted: unstarted.length,
      inProgress: inProgress.length,
      withHltb,
      hasTasteVector: p.vector.some((x) => x !== 0),
      confidence: p.confidence,
    },
  };
}
