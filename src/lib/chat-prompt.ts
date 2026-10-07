// Renders the system prompt for the "What should I play next?" chat.
// Pure and import-free so it stays testable under plain `node --test`.

function fmtHours(h: number | null | undefined): string {
  if (h == null) return "?";
  return h < 10 ? h.toFixed(1) : String(Math.round(h));
}

function line(name: string, extra: string[]): string {
  const bits = extra.filter(Boolean);
  return `- ${name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

// ---------------------------------------------------------------------------
// Pure rendering
// ---------------------------------------------------------------------------

export interface ChatContextInput {
  topTags: { tag: string; weight: number }[];
  defining: { name: string; hoursPlayed: number; completed: boolean }[];
  antiClusters: { label: string; bounced: { name: string; playtimeHours: number }[] }[];
  recent: { name: string; recentHours: number; totalHours: number }[];
  inProgress: { name: string; hoursIn: number; hltb: number | null }[];
  unstartedPicks: { name: string; fit: number; hltb: number | null; tags: string[] }[];
  shortGames: { name: string; hltb: number; fit: number }[];
  wishlistPicks: { name: string; fit: number; hltb: number | null }[];
  counts: {
    owned: number; unstarted: number; wishlist: number;
    withHltb: number; confidence: string;
  };
}

export function formatChatContext(input: ChatContextInput): string {
  const sections: string[] = [];

  sections.push(
    "You are a personal game-librarian assistant embedded in the user's local Steam library manager. " +
    "You answer questions like \"what should I play tonight?\", \"something short\", \"a co-op game\", " +
    "\"did I like games like X?\" using ONLY the library data below. " +
    "Recommend games from the lists; you may mention other owned games only if named in the data. " +
    "Never invent games, hours, or review scores. If the data doesn't cover the question, say so plainly. " +
    "Keep answers concise; when recommending, name the game, the fit, and the time-to-beat when known."
  );

  if (input.topTags.length > 0) {
    sections.push(
      "TASTE SIGNATURE (tags weighted by actual playtime):\n" +
      input.topTags.slice(0, 12).map((t) => `- ${t.tag} ${Math.round(t.weight * 100)}`).join("\n")
    );
  }

  if (input.defining.length > 0) {
    sections.push(
      "DEFINING GAMES (what this player actually loves):\n" +
      input.defining.map((d) => line(d.name, [
        `${fmtHours(d.hoursPlayed)}h played`,
        d.completed ? "completed" : "",
      ])).join("\n")
    );
  }

  if (input.antiClusters.length > 0) {
    sections.push(
      "GAMES THE PLAYER BOUNCES OFF (avoid recommending similar):\n" +
      input.antiClusters.map((c) =>
        `- ${c.label}: dropped ${c.bounced.slice(0, 4).map((b) => `${b.name} after ${b.playtimeHours.toFixed(1)}h`).join(", ")}`
      ).join("\n")
    );
  }

  if (input.recent.length > 0) {
    sections.push(
      "PLAYED IN THE LAST 2 WEEKS:\n" +
      input.recent.map((r) => line(r.name, [
        `${fmtHours(r.recentHours)}h recently`,
        `${fmtHours(r.totalHours)}h total`,
      ])).join("\n")
    );
  }

  if (input.inProgress.length > 0) {
    sections.push(
      "IN PROGRESS (started, not finished):\n" +
      input.inProgress.map((r) => line(r.name, [
        `${fmtHours(r.hoursIn)}h in`,
        r.hltb != null ? `~${fmtHours(r.hltb)}h to beat` : "",
      ])).join("\n")
    );
  }

  if (input.unstartedPicks.length > 0) {
    sections.push(
      "TOP UNSTARTED PICKS (owned, never played, ranked by fit — score 0-100):\n" +
      input.unstartedPicks.map((g) => line(g.name, [
        `fit ${g.fit}`,
        g.hltb != null ? `~${fmtHours(g.hltb)}h` : "length unknown",
        g.tags.slice(0, 3).join("/"),
      ])).join("\n")
    );
  }

  if (input.shortGames.length > 0) {
    sections.push(
      "SHORT GAMES (owned, unstarted, ≤8h to beat):\n" +
      input.shortGames.map((g) => line(g.name, [
        `~${fmtHours(g.hltb)}h`, `fit ${g.fit}`,
      ])).join("\n")
    );
  }

  if (input.wishlistPicks.length > 0) {
    sections.push(
      "WISHLIST TOP PICKS (not owned yet, ranked by fit):\n" +
      input.wishlistPicks.map((g) => line(g.name, [
        `fit ${g.fit}`,
        g.hltb != null ? `~${fmtHours(g.hltb)}h` : "",
      ])).join("\n")
    );
  }

  const c = input.counts;
  sections.push(
    `LIBRARY SIZE: ${c.owned} owned (${c.unstarted} never played), ${c.wishlist} wishlisted, ` +
    `${c.withHltb} with completion-time data. Taste confidence: ${c.confidence}.`
  );

  return sections.join("\n\n");
}

