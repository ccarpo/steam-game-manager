import { getDb } from "@/lib/db";
import { HltbClient, HltbError, matchGame } from "@/lib/hltb";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SKIP_TYPES = new Set(["dlc", "music", "video", "demo", "advertising", "tool"]);
const MAX_RETRIES = 3;

/**
 * POST /api/sync/hltb?mode=missing|nomatch|all&limit=N
 * Fetches HowLongToBeat completion times into the hltb table.
 * Candidates: steam_appid set, tagged steam>owned or steam>wishlist,
 * app_type not in dlc/music/video/demo/advertising/tool.
 * Order: IN_PROGRESS first, ENDLESS second, rest.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "missing";
  const limit = parseInt(url.searchParams.get("limit") || "0", 10) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const db = getDb();

        let games = db.prepare(
          `SELECT DISTINCT g.id, g.name, g.steam_appid, g.app_type,
                  h.match_status AS hltb_status,
                  COALESCE(c.override_category, c.category) AS category
           FROM games g
           JOIN game_tags gt ON gt.game_id = g.id
           JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
           JOIN subtags s ON s.id = gt.subtag_id AND s.name IN ('owned', 'wishlist')
           LEFT JOIN hltb h ON h.appid = g.steam_appid
           LEFT JOIN game_classification c ON c.game_id = g.id
           WHERE g.steam_appid IS NOT NULL`
        ).all() as {
          id: number; name: string; steam_appid: number; app_type: string;
          hltb_status: string | null; category: string | null;
        }[];

        games = games.filter((g) => !SKIP_TYPES.has((g.app_type || "").toLowerCase()));
        if (mode === "missing") {
          games = games.filter((g) => g.hltb_status === null);
        } else if (mode === "nomatch") {
          games = games.filter((g) => g.hltb_status === null || g.hltb_status === "no_match");
        }
        const prio = (c: string | null) => c === "IN_PROGRESS" ? 0 : c === "ENDLESS" ? 1 : 2;
        games.sort((a, b) => prio(a.category) - prio(b.category) || a.name.localeCompare(b.name));
        if (limit > 0) games = games.slice(0, limit);

        send({ type: "status", message: `${games.length} games to fetch HLTB data for (mode: ${mode})` });
        if (games.length === 0) {
          send({ type: "done", matched: 0, noMatch: 0, errors: 0, message: "Nothing to fetch." });
          controller.close();
          return;
        }

        let client: HltbClient;
        try {
          client = await HltbClient.create();
        } catch (e) {
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
          controller.close();
          return;
        }
        send({ type: "status", message: "HLTB auth handshake OK" });

        const upsert = db.prepare(
          `INSERT INTO hltb (appid, hltb_id, hltb_name, main_hours, extra_hours, completionist_hours, match_status, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(appid) DO UPDATE SET
             hltb_id = excluded.hltb_id, hltb_name = excluded.hltb_name,
             main_hours = excluded.main_hours, extra_hours = excluded.extra_hours,
             completionist_hours = excluded.completionist_hours,
             match_status = excluded.match_status, fetched_at = excluded.fetched_at`
        );

        let matched = 0, noMatch = 0, errors = 0;
        let backoff = 1000;

        for (let i = 0; i < games.length; i++) {
          const g = games[i];
          let retries = 0;
          const entry = await (async () => {
            for (;;) {
              try {
                return await matchGame(client, g.name);
              } catch (e) {
                if (e instanceof HltbError && e.kind === "auth") {
                  await client.refreshAuth();
                  if (++retries > MAX_RETRIES) return null;
                  continue;
                }
                if (e instanceof HltbError && e.kind === "rate") {
                  if (++retries > MAX_RETRIES) return null;
                  await sleep(backoff);
                  backoff = Math.min(backoff * 2, 10000);
                  continue;
                }
                if (e instanceof HltbError && e.kind === "network") {
                  if (++retries > MAX_RETRIES) return null;
                  await sleep(1000);
                  continue;
                }
                return null; // parse error — give up, don't write a row
              }
            }
          })();

          if (entry) {
            upsert.run(g.steam_appid, entry.hltb_id, entry.hltb_name, entry.main_hours, entry.extra_hours, entry.completionist_hours, entry.match_status);
            if (entry.match_status === "matched") matched++; else noMatch++;
            backoff = 1000;
          } else {
            errors++;
          }

          send({ type: "progress", current: i + 1, total: games.length, matched, name: g.name });
          if (i < games.length - 1) await sleep(333);
        }

        send({ type: "done", matched, noMatch, errors, message: `HLTB sync: ${matched} matched, ${noMatch} no match, ${errors} errors` });
      } catch (err) {
        send({ type: "error", message: String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
