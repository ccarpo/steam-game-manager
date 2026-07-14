import { GameWithTags } from "./types";

/** Parse a JSON array string, handling both string[] and {name:string}[] formats.
 *  Returns [] on any parse failure or non-array value. */
export function safeJsonParse(str: string | null | undefined): string[] {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed)) return [];
    if (parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null && "name" in parsed[0]) {
      return parsed.map((t: { name: string }) => t.name);
    }
    return parsed as string[];
  } catch {
    return [];
  }
}

/** Load a JSON-serialised value from localStorage. Returns fallback on any error. */
export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Persist a JSON-serialisable value to localStorage. No-op if unavailable. */
export function saveJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** Return the asset directory ID for a game (used in /api/assets/<id>/...). */
export function assetId(game: Pick<GameWithTags, "steam_appid" | "id">): string {
  return game.steam_appid ? String(game.steam_appid) : `manual_${game.id}`;
}

/** Format an ISO date string (YYYY-MM-DD) into a human-readable locale date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso ?? "";
  }
}

/** Split developer/publisher field — handles both JSON arrays and legacy comma-separated strings. */
export function splitCompanies(s: string): string[] {
  if (!s) return [];
  if (s.startsWith("[")) return safeJsonParse(s);
  // Legacy: protect suffixes like "Co., Ltd." before splitting on commas
  const protected_ = s.replace(/\b(Co|Inc|Ltd|Corp|S\.A|S\.L|LLC|GmbH)\.\s*,/gi, (_m, p1: string) => `${p1}.†`);
  return protected_.split(",").map((part) => part.replace(/†/g, ",").trim()).filter(Boolean);
}
