import { test } from "node:test";
import assert from "node:assert/strict";
import { formatChatContext } from "./chat-prompt.ts";
import type { ChatContextInput } from "./chat-prompt.ts";

function base(overrides: Partial<ChatContextInput> = {}): ChatContextInput {
  return {
    topTags: [],
    defining: [],
    antiClusters: [],
    recent: [],
    inProgress: [],
    unstartedPicks: [],
    shortGames: [],
    wishlistPicks: [],
    counts: { owned: 10, unstarted: 4, wishlist: 2, withHltb: 6, confidence: "medium" },
    ...overrides,
  };
}

test("chat_prompt_empty_library_still_gives_instructions_and_counts", () => {
  const prompt = formatChatContext(base());
  assert.match(prompt, /game-librarian/);
  assert.match(prompt, /Never invent games/);
  assert.match(prompt, /10 owned \(4 never played\), 2 wishlisted/);
  // No empty section headers.
  assert.doesNotMatch(prompt, /TASTE SIGNATURE/);
  assert.doesNotMatch(prompt, /UNSTARTED PICKS/);
});

test("chat_prompt_renders_all_sections", () => {
  const prompt = formatChatContext(base({
    topTags: [{ tag: "Co-op", weight: 1 }, { tag: "FPS", weight: 0.5 }],
    defining: [{ name: "Deep Rock", hoursPlayed: 123.4, completed: true }],
    antiClusters: [{
      label: "Match 3",
      bounced: [{ name: "Puzzle Game", playtimeHours: 0.75 }],
    }],
    recent: [{ name: "Factorio", recentHours: 12.2, totalHours: 400 }],
    inProgress: [{ name: "Hades II", hoursIn: 8.5, hltb: 24 }],
    unstartedPicks: [{ name: "Slay the Spire", fit: 82, hltb: null, tags: ["Roguelike", "Card"] }],
    shortGames: [{ name: "Firewatch", hltb: 4.3, fit: 71 }],
    wishlistPicks: [{ name: "Silksong", fit: 90, hltb: 25 }],
  }));

  for (const section of [
    "TASTE SIGNATURE", "DEFINING GAMES", "BOUNCES OFF", "LAST 2 WEEKS",
    "IN PROGRESS", "TOP UNSTARTED PICKS", "SHORT GAMES", "WISHLIST TOP PICKS",
  ]) {
    assert.match(prompt, new RegExp(section), `missing section ${section}`);
  }
  assert.match(prompt, /- Co-op 100/);
  assert.match(prompt, /Deep Rock \(123h played, completed\)/);
  assert.match(prompt, /Puzzle Game after 0\.8h/);
  assert.match(prompt, /Hades II \(8\.5h in, ~24h to beat\)/);
  assert.match(prompt, /Slay the Spire \(fit 82, length unknown/);
  assert.match(prompt, /Firewatch \(~4\.3h, fit 71\)/);
});

test("chat_prompt_caps_long_lists", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ tag: `T${i}`, weight: 1 - i * 0.01 }));
  const prompt = formatChatContext(base({ topTags: many }));
  assert.match(prompt, /- T11 /);
  assert.doesNotMatch(prompt, /- T12 /); // capped at 12
});
