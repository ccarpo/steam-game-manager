import { getDb, ensureSteamTag, getSteamCredentials } from "@/lib/db";
import { classifyGames } from "@/lib/classify";

async function fetchJsonWithRetry(url: string, retries = 3): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const text = await res.text();
      let data: unknown = undefined;
      if (text.trim()) {
        try { data = JSON.parse(text); } catch { /* not JSON */ }
      }
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      return { ok: true, status: res.status, data };
    } catch (e) {
      if (i === retries - 1) return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
      await new Promise((r) => setTimeout(r, (i + 1) * 1000));
    }
  }
  return { ok: false, status: 0, error: "retry exhausted" };
}

export const dynamic = "force-dynamic";

export async function POST() {
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

        send({ type: "status", message: "Fetching owned games from Steam..." });

        const ownedRes = await fetchJsonWithRetry(
          `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
        );
        if (!ownedRes.ok) {
          send({ type: "error", message: `Steam API error: ${ownedRes.status} ${ownedRes.error || ""}` });
          controller.close();
          return;
        }

        const data = (ownedRes.data || {}) as {
          response?: {
            game_count?: number;
            games?: { appid: number; name: string; playtime_forever?: number; playtime_2weeks?: number; rtime_last_played?: number }[];
          };
        };
        const games = data?.response?.games || [];
        send({ type: "status", message: `Found ${games.length} owned games` });

        if (games.length === 0) {
          send({ type: "done", added: 0, existing: 0, message: "No owned games found." });
          controller.close();
          return;
        }

        // Ensure steam tag with subtags
        const { tagId, subtags } = ensureSteamTag(db);
        const ownedSubId = subtags.owned;

        // Fetch wishlist data to get wishlist_date for owned games.
        // This endpoint can return a malformed stream, so we retry and fall back
        // to continuing without dates rather than aborting the owned sync.
        send({ type: "status", message: "Fetching wishlist for date matching..." });
        const wishlistDates = new Map<number, string>();
        let wishlistError = "";
        try {
          const wlRes = await fetchJsonWithRetry(
            `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}&key=${apiKey}`
          );
          if (wlRes.ok) {
            const wlData = (wlRes.data || {}) as { response?: { items?: { appid: number; date_added: number }[] } };
            for (const item of wlData?.response?.items || []) {
              if (item.date_added) {
                wishlistDates.set(item.appid, new Date(item.date_added * 1000).toISOString().split("T")[0]);
              }
            }
          } else {
            wishlistError = wlRes.error || `HTTP ${wlRes.status}`;
          }
        } catch (e) {
          wishlistError = e instanceof Error ? e.message : String(e);
        }
        send({
          type: "status",
          message: wishlistError
            ? `Wishlist date fetch failed (${wishlistError}); continuing without dates.`
            : `Wishlist dates: ${wishlistDates.size} entries`,
        });

        const findGame = db.prepare("SELECT id FROM games WHERE steam_appid = ?");
        const insGame = db.prepare("INSERT INTO games (name, steam_appid, wishlist_date, added_at, playtime_forever, playtime_2weeks, rtime_last_played) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const insGT = db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)");
        const updateWishDate = db.prepare("UPDATE games SET wishlist_date = ? WHERE id = ? AND (wishlist_date IS NULL OR wishlist_date = '')");
        const updatePlaytime = db.prepare("UPDATE games SET playtime_forever = ?, playtime_2weeks = ?, rtime_last_played = ? WHERE id = ?");

        let added = 0, existing = 0, tagged = 0;
        const today = new Date().toISOString().split("T")[0];

        for (let i = 0; i < games.length; i++) {
          const g = games[i];
          const wishDate = wishlistDates.get(g.appid) || null;
          const ex = findGame.get(g.appid) as { id: number } | undefined;
          if (ex) {
            existing++;
            const r = insGT.run(ex.id, tagId, ownedSubId);
            if (r.changes > 0) tagged++;
            // Backfill wishlist_date if we have it and game doesn't
            if (wishDate) updateWishDate.run(wishDate, ex.id);
            updatePlaytime.run(g.playtime_forever || 0, g.playtime_2weeks || 0, g.rtime_last_played || 0, ex.id);
          } else {
            const gameId = Number(insGame.run(g.name, g.appid, wishDate, today, g.playtime_forever || 0, g.playtime_2weeks || 0, g.rtime_last_played || 0).lastInsertRowid);
            insGT.run(gameId, tagId, ownedSubId);
            added++;
            tagged++;
          }

          if ((i + 1) % 10 === 0 || i === games.length - 1) {
            send({ type: "progress", current: i + 1, total: games.length, added, existing });
          }
        }

        try {
          const res = classifyGames(db, { mode: "new" });
          send({ type: "status", message: `Classified ${res.classified} games (${Object.entries(res.byCategory).map(([k, v]) => `${k}: ${v}`).join(", ")})` });
        } catch (e) { send({ type: "status", message: `Classification skipped: ${e}` }); }

        send({
          type: "done",
          added,
          existing,
          tagged,
          message: `Owned games sync complete: ${added} new, ${existing} already in DB, ${tagged} newly tagged as "owned"`,
        });
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
