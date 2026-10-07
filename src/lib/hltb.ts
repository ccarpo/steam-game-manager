// HowLongToBeat client — port of gamekeeper's hltb.rs.
// Pure helpers + fetch-based client; no `@/` imports (runs under `node --test`).

const HLTB_BASE = "https://howlongtobeat.com";
const HLTB_API_PATH = "api/search/site"; // was api/find until ~Sept 2025 site rework
const HLTB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HltbError extends Error {
  kind: "auth" | "rate" | "network" | "parse";
  constructor(kind: "auth" | "rate" | "network" | "parse", message: string) {
    super(message);
    this.kind = kind;
    this.name = "HltbError";
  }
}

/** Normalize a game title for HLTB matching. Lowercase, strip ™/®/©, remove edition suffixes. */
export function normalizeTitle(title: string): string {
  let s = title.toLowerCase();
  for (const ch of ["™", "®", "©"]) s = s.split(ch).join("");
  const suffixes = [
    " game of the year edition", " goty edition", " special edition",
    " definitive edition", " complete edition", " deluxe edition",
    " ultimate edition", " enhanced edition", " remastered", " hd",
    " - digital edition",
  ];
  for (const suffix of suffixes) {
    if (s.endsWith(suffix)) s = s.slice(0, s.length - suffix.length);
  }
  return s.split(/\s+/).filter(Boolean).join(" ");
}

function levenshtein(a: string, b: string): number {
  const ac = [...a], bc = [...b];
  const m = ac.length, n = bc.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = ac[i - 1] === bc[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** Similarity ratio 0–1 between two strings (Levenshtein-based). */
export function similarity(a: string, b: string): number {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (al === bl) return 1.0;
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshtein(al, bl) / maxLen;
}

/** HLTB seconds → hours rounded to 1 decimal; null for <= 0. */
export function secondsToHours(seconds: number): number | null {
  if (seconds <= 0) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

export interface HltbSearchResult {
  gameId: number;
  gameName: string;
  compMain: number;
  compPlus: number;
  comp100: number;
}

export interface HltbEntry {
  hltb_id: number | null;
  hltb_name: string | null;
  main_hours: number | null;
  extra_hours: number | null;
  completionist_hours: number | null;
  match_status: "matched" | "no_match";
}

interface HltbAuth { token: string; hpKey: string; hpVal: string }

async function fetchAuth(): Promise<HltbAuth> {
  const initUrl = `${HLTB_BASE}/${HLTB_API_PATH}/init?t=${Date.now()}`;
  let res: Response;
  try {
    res = await fetch(initUrl, {
      headers: { "User-Agent": HLTB_UA, Referer: `${HLTB_BASE}/` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new HltbError("network", `init fetch failed: ${e}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !ct.includes("json")) {
    throw new HltbError("network", `init returned ${res.status} ${ct || "non-json"}`);
  }
  const json = await res.json().catch(() => null) as { token?: string; hpKey?: string; hpVal?: string } | null;
  if (!json?.token || !json.hpKey || !json.hpVal) {
    throw new HltbError("parse", "init response missing token/hpKey/hpVal");
  }
  return { token: json.token, hpKey: json.hpKey, hpVal: json.hpVal };
}

export class HltbClient {
  private auth: HltbAuth | null = null;
  private readonly searchUrl = `${HLTB_BASE}/${HLTB_API_PATH}/`;

  private constructor() {}

  static async create(): Promise<HltbClient> {
    const client = new HltbClient();
    try {
      client.auth = await fetchAuth();
    } catch (e) {
      if (e instanceof HltbError && e.kind === "parse") throw e;
      throw new HltbError("network", `HowLongToBeat unreachable (blocked or API changed): ${e instanceof Error ? e.message : e}`);
    }
    return client;
  }

  async refreshAuth() {
    try { this.auth = await fetchAuth(); } catch { this.auth = null; }
  }

  /** Search HLTB, returns up to `size` raw results (seconds). */
  async search(title: string, size = 5): Promise<HltbSearchResult[]> {
    if (!this.auth) {
      await this.refreshAuth();
      if (!this.auth) throw new HltbError("network", "No auth token");
    }
    const auth = this.auth;
    const searchTerms = title.split(/\s+/).filter(Boolean);
    const body: Record<string, unknown> = {
      searchType: "games",
      searchTerms,
      searchPage: 1,
      size,
      searchOptions: {
        games: {
          userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main",
          rangeTime: { min: 0, max: 0 },
          gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
          rangeYear: { max: "", min: "" }, modifier: "",
        },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "", sort: 0, randomizer: 0,
      },
      useCache: true,
    };
    body[auth.hpKey] = auth.hpVal;

    let res: Response;
    try {
      res = await fetch(this.searchUrl, {
        method: "POST",
        headers: {
          "User-Agent": HLTB_UA,
          Referer: `${HLTB_BASE}/`,
          "Content-Type": "application/json",
          Accept: "*/*",
          origin: HLTB_BASE,
          "x-auth-token": auth.token,
          "x-hp-key": auth.hpKey,
          "x-hp-val": auth.hpVal,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new HltbError("network", String(e));
    }

    if (res.status === 403) throw new HltbError("auth", "auth expired");
    if (res.status === 429) throw new HltbError("rate", "rate limited");
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) throw new HltbError("network", `HTTP ${res.status}`);
    if (!ct.includes("json")) throw new HltbError("network", `non-JSON response (${ct || "html"}) — likely Cloudflare block`);

    const data = await res.json().catch(() => null) as { data?: { game_id?: number; game_name?: string; comp_main?: number; comp_plus?: number; comp_100?: number }[] } | null;
    if (!data || !Array.isArray(data.data)) throw new HltbError("parse", "search response missing data array");

    return data.data.map((r) => ({
      gameId: r.game_id ?? 0,
      gameName: r.game_name ?? "",
      compMain: r.comp_main ?? 0,
      compPlus: r.comp_plus ?? 0,
      comp100: r.comp_100 ?? 0,
    }));
  }
}

/** Search HLTB for a single game; accept first result if normalized similarity ≥ 0.7. */
export async function matchGame(client: HltbClient, steamTitle: string): Promise<HltbEntry> {
  const normalized = normalizeTitle(steamTitle);
  const results = await client.search(normalized);
  const first = results[0];
  if (!first) {
    return { hltb_id: null, hltb_name: null, main_hours: null, extra_hours: null, completionist_hours: null, match_status: "no_match" };
  }
  const sim = similarity(normalized, normalizeTitle(first.gameName));
  if (sim < 0.7) {
    return { hltb_id: null, hltb_name: null, main_hours: null, extra_hours: null, completionist_hours: null, match_status: "no_match" };
  }
  return {
    hltb_id: first.gameId,
    hltb_name: first.gameName,
    main_hours: secondsToHours(first.compMain),
    extra_hours: secondsToHours(first.compPlus),
    completionist_hours: secondsToHours(first.comp100),
    match_status: "matched",
  };
}
