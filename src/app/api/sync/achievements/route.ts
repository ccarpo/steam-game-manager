import { getDb, getSteamCredentials } from "@/lib/db";
import { classifyGames } from "@/lib/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SKIP_TYPES = new Set(["dlc", "music", "video", "demo", "advertising"]);
const MAX_RATE_RETRIES = 5;

/**
 * POST /api/sync/achievements?mode=missing|stale|all&limit=N
 * Fetches player achievements per owned game into steam_achievements.
 *   missing = no row yet or status 'error'
 *   stale   = missing + rows whose playtime_at_fetch != games.playtime_forever
 *   all     = every owned game with a steam_appid
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
        const { steamId, apiKey } = getSteamCredentials(db);
        if (!steamId || !apiKey) { send({ type: "error", message: "Steam credentials not configured. Go to Settings." }); controller.close(); return; }

        let games = db.prepare(
          `SELECT g.id, g.name, g.steam_appid, g.playtime_forever, g.app_type,
                  a.status AS ach_status, a.playtime_at_fetch
           FROM games g
           JOIN game_tags gt ON gt.game_id = g.id
           JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
           JOIN subtags s ON s.id = gt.subtag_id AND s.name = 'owned'
           LEFT JOIN steam_achievements a ON a.appid = g.steam_appid
           WHERE g.steam_appid IS NOT NULL
           ORDER BY g.name`
        ).all() as {
          id: number; name: string; steam_appid: number; playtime_forever: number;
          app_type: string; ach_status: string | null; playtime_at_fetch: number | null;
        }[];

        games = games.filter((g) => !SKIP_TYPES.has((g.app_type || "").toLowerCase()));
        if (mode === "missing") {
          games = games.filter((g) => g.ach_status === null || g.ach_status === "error");
        } else if (mode === "stale") {
          games = games.filter((g) => g.ach_status === null || g.ach_status === "error" || g.playtime_at_fetch !== g.playtime_forever);
        }
        if (limit > 0) games = games.slice(0, limit);

        send({ type: "status", message: `${games.length} games to fetch achievements for (mode: ${mode})` });
        if (games.length === 0) {
          send({ type: "done", ok: 0, none: 0, errors: 0, message: "Nothing to fetch." });
          controller.close();
          return;
        }

        const upsert = db.prepare(
          `INSERT INTO steam_achievements (appid, total, achieved, names_achieved, playtime_at_fetch, fetched_at, status)
           VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
           ON CONFLICT(appid) DO UPDATE SET
             total = excluded.total, achieved = excluded.achieved,
             names_achieved = excluded.names_achieved, playtime_at_fetch = excluded.playtime_at_fetch,
             fetched_at = excluded.fetched_at, status = excluded.status`
        );

        let ok = 0, none = 0, errors = 0;
        const touchedIds: number[] = [];

        let rateRetries = 0;
        for (let i = 0; i < games.length; i++) {
          const g = games[i];
          try {
            const res = await fetch(
              `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${g.steam_appid}&key=${apiKey}&steamid=${steamId}&l=english`
            );
            if (res.status === 403) {
              send({ type: "error", message: "Steam profile is private or key lacks access (HTTP 403). Make game details public and retry." });
              controller.close();
              return;
            }
            if (res.status === 429) {
              if (++rateRetries > MAX_RATE_RETRIES) {
                send({ type: "error", message: `Steam kept rate limiting (429) after ${MAX_RATE_RETRIES} retries — stopping. Re-run later to resume.` });
                controller.close();
                return;
              }
              send({ type: "status", message: `Rate limited (429), pausing 60s... (retry ${rateRetries}/${MAX_RATE_RETRIES})` });
              await sleep(60000);
              i--;
              continue;
            }
            rateRetries = 0;
            const data = res.ok || res.status === 400 ? await res.json().catch(() => null) as {
              playerstats?: { success?: boolean; achievements?: { apiname: string; achieved: number; name?: string }[] };
            } | null : null;
            const ps = data?.playerstats;
            if (res.status === 400 || ps?.success === false || (res.ok && ps && !ps.achievements)) {
              upsert.run(g.steam_appid, 0, 0, "[]", g.playtime_forever, "none");
              none++; touchedIds.push(g.id);
            } else if (!ps?.achievements) {
              upsert.run(g.steam_appid, 0, 0, "[]", g.playtime_forever, "error");
              errors++; touchedIds.push(g.id);
            } else {
              const list = ps.achievements;
              const earned = list.filter((a) => a.achieved === 1);
              const names = earned.map((a) => a.name || a.apiname);
              upsert.run(g.steam_appid, list.length, earned.length, JSON.stringify(names), g.playtime_forever, "ok");
              ok++; touchedIds.push(g.id);
            }
          } catch {
            upsert.run(g.steam_appid, 0, 0, "[]", g.playtime_forever, "error");
            errors++; touchedIds.push(g.id);
          }
          send({ type: "progress", current: i + 1, total: games.length, ok, fail: errors, name: g.name });
          await sleep(500);
        }

        if (touchedIds.length > 0) {
          try {
            const res = classifyGames(db, { gameIds: touchedIds });
            send({ type: "status", message: `Classified ${res.classified} games (${Object.entries(res.byCategory).map(([k, v]) => `${k}: ${v}`).join(", ")})` });
          } catch (e) { send({ type: "status", message: `Classification skipped: ${e}` }); }
        }

        send({ type: "done", ok, none, errors, message: `Achievements sync: ${ok} ok, ${none} no stats, ${errors} errors` });
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
