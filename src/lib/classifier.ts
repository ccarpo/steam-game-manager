// Pure rule-based classifier — port of gamekeeper's classifier.rs.
// No `@/` imports: must run under plain `node --test`.

export type Category = "COMPLETED" | "IN_PROGRESS" | "ENDLESS" | "NOT_A_GAME";

export const CATEGORY_LABEL: Record<Category, string> = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  ENDLESS: "Endless",
  NOT_A_GAME: "Not a Game",
};

export const CATEGORY_COLOR: Record<Category, string> = {
  COMPLETED: "#4ade80",
  IN_PROGRESS: "#fbbf24",
  ENDLESS: "#3b82f6",
  NOT_A_GAME: "#6b7280",
};

export const RULES_VERSION = 1;

export interface Achievements {
  total: number;
  achieved: number;
  percentage: number;
  namesAchieved: string[];
}

export interface ClassifyInput {
  name: string;
  playtimeHours: number;
  achievements: Achievements | null;
  store: { appType: string; genres: string[]; categories: string[] } | null;
}

export const NOT_A_GAME_NAME_PATTERN = /\b(dedicated server|soundtrack|ost\b|sdk\b|benchmark|demo\b|teaser|playable teaser|tech demo|modding tool|level editor|map editor|wallpaper engine|rpg maker|game maker|vr home|steamvr|test server|public test)\b/i;

const COMPLETION_ACHIEVEMENT_PATTERN = /(final.?boss|last.?boss|beat.?the.?game|the.?end|credits|end.?credits|complete.?the.?game|finish.?the.?game|game.?complete|chapter.?\d+.?complete|act.?\d+.?complete|epilogue|finale|platinum|true.?ending|good.?ending|bad.?ending|beat.?campaign|campaign.?complete|story.?complete)/i;

const NON_GAME_TYPES = new Set(["demo", "tool", "music", "dlc", "video", "hardware", "mod"]);
const ENDLESS_GENRES = new Set(["simulation", "strategy", "casual", "sports", "racing"]);

export function classifyByRules(input: ClassifyInput): { category: Category; reason: string } {
  const name = input.name;
  const playtime = input.playtimeHours;
  const ach = input.achievements;

  const storeType = input.store ? input.store.appType.toLowerCase() : "";
  const genres = input.store ? input.store.genres.map((s) => s.toLowerCase()) : [];
  const categories = input.store ? input.store.categories.map((s) => s.toLowerCase()) : [];

  // Rule 1: Steam type indicates non-game
  if (NON_GAME_TYPES.has(storeType)) {
    return { category: "NOT_A_GAME", reason: `Steam type: ${storeType}` };
  }

  // Rule 2: Name patterns
  const m = name.match(NOT_A_GAME_NAME_PATTERN);
  if (m) {
    return { category: "NOT_A_GAME", reason: `Name pattern: ${m[0]}` };
  }

  if (ach) {
    // Rule 3: Story-completion achievements earned
    for (const achName of ach.namesAchieved) {
      if (COMPLETION_ACHIEVEMENT_PATTERN.test(achName)) {
        return { category: "COMPLETED", reason: `Story achievement: ${achName}` };
      }
    }
    // Rule 4: High achievement percentage
    if (ach.percentage >= 80.0) {
      return { category: "COMPLETED", reason: `Achievement completion: ${ach.percentage}%` };
    }
  }

  // Rule 5: Multiplayer-only
  const hasMp = categories.some((c) => c.includes("multi-player") || c.includes("multiplayer"));
  const hasSp = categories.some((c) => c.includes("single-player"));
  if (hasMp && !hasSp) {
    return { category: "ENDLESS", reason: "Multiplayer-only (no single-player)" };
  }

  // Rule 6: MMO genre
  if (genres.some((g) => g.includes("mmo"))) {
    return { category: "ENDLESS", reason: "MMO genre" };
  }

  // Rule 7: Sandbox/strategy/simulation genres with no SP
  if (genres.length > 0 && !hasSp) {
    const matched = genres.filter((g) => ENDLESS_GENRES.has(g)).sort();
    if (matched.length > 0) {
      return { category: "ENDLESS", reason: `Genre: ${[...new Set(matched)].join(", ")}` };
    }
  }

  // Rule 8: Achievement % with significant playtime suggests completion (tiered)
  if (ach) {
    if (ach.percentage >= 40.0 && playtime >= 5.0) {
      return { category: "COMPLETED", reason: `Likely completed (${ach.percentage}% achievements, ${playtime.toFixed(1)}h played)` };
    }
    if (ach.percentage >= 20.0 && playtime >= 20.0 && hasSp) {
      return { category: "COMPLETED", reason: `Likely completed (${ach.percentage}% achievements, ${playtime.toFixed(1)}h played, single-player)` };
    }
  }

  // Rule 9: Significant playtime with single-player suggests completion
  if (hasSp && playtime >= 15.0 && !ach) {
    return { category: "COMPLETED", reason: `Likely completed (single-player, ${playtime.toFixed(1)}h played)` };
  }

  // Rule 9b: Very high playtime with no achievements earned → tracked externally
  if (hasSp && playtime >= 20.0 && ach) {
    if (ach.achieved === 0 && ach.total > 0) {
      return { category: "COMPLETED", reason: `Likely completed (single-player, ${playtime.toFixed(1)}h played, achievements tracked externally)` };
    }
  }

  // Rule 10: Endless genres (even with SP) → ENDLESS if no achievements
  if (genres.length > 0 && !ach) {
    const matched = genres.filter((g) => ENDLESS_GENRES.has(g)).sort();
    if (matched.length > 0) {
      return { category: "ENDLESS", reason: `Genre: ${[...new Set(matched)].join(", ")}` };
    }
  }

  // Rule 11: Unplayed with single-player → backlog
  if (playtime === 0.0 && hasSp) {
    return { category: "IN_PROGRESS", reason: "Unplayed single-player game (backlog)" };
  }

  // Rule 12: Unplayed with no store info → default to IN_PROGRESS
  if (playtime === 0.0 && !input.store) {
    return { category: "IN_PROGRESS", reason: "Unplayed game (backlog)" };
  }

  // Rule 13: Low playtime with single-player → still in progress
  if (hasSp && playtime > 0.0 && playtime < 15.0) {
    return { category: "IN_PROGRESS", reason: `Single-player with low playtime (${playtime}h)` };
  }

  // Rule 14: Played but no other signals → default to IN_PROGRESS
  if (playtime > 0.0) {
    return { category: "IN_PROGRESS", reason: `Played (${playtime}h) but no clear completion signal` };
  }

  return { category: "IN_PROGRESS", reason: "No classification signals — defaulted to In Progress" };
}

export function confidenceFor(reason: string): "HIGH" | "MEDIUM" {
  return reason.includes("Likely") || reason.toLowerCase().includes("default") ? "MEDIUM" : "HIGH";
}
