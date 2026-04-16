import { getDb } from "@/lib/db";
import { assignAllAutoTags } from "@/lib/auto-tags";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const db = getDb();

        // Find games with TBA/unknown release dates
        const games = db.prepare(`
          SELECT id, name, steam_appid, release_date FROM games
          WHERE steam_appid IS NOT NULL AND (
            release_date IS NULL OR release_date = '' OR
            LOWER(release_date) IN ('coming soon', 'to be announced', 'tba') OR
            release_date GLOB 'Q[1-4] [0-9]*' OR
            release_date NOT GLOB '*[0-9][0-9], [0-9]*'
          )
          ORDER BY name
        `).all() as { id: number; name: string; steam_appid: number; release_date: string | null }[];

        send({ type: "status", message: `Found ${games.length} games with TBA/partial release dates` });

        if (games.length === 0) {
          send({ type: "done", updated: 0, total: 0 });
          controller.close();
          return;
        }

        let updated = 0;
        let unchanged = 0;
        let failed = 0;

        for (let i = 0; i < games.length; i++) {
          const g = games[i];
          try {
            const res = await fetch(
              `https://store.steampowered.com/api/appdetails?appids=${g.steam_appid}&l=english`
            );
            if (!res.ok) { failed++; continue; }
            const raw = await res.json() as Record<string, { success: boolean; data?: Record<string, unknown> }>;
            const data = raw?.[String(g.steam_appid)];
            if (!data?.success || !data.data) { failed++; continue; }

            const d = data.data;
            const newDate = (d.release_date as { date?: string })?.date || "";
            const oldDate = g.release_date || "";

            if (newDate && newDate !== oldDate) {
              // Update release date + other metadata that may have changed
              const name = (d.name as string) || null;
              const desc = (d.short_description as string) || "";
              const genres = ((d.genres as { description: string }[]) || []).map(x => x.description);
              const feats = ((d.categories as { description: string }[]) || []).map(x => x.description);
              const devs = JSON.stringify((d.developers as string[]) || []);
              const pubs = JSON.stringify((d.publishers as string[]) || []);
              const mc = (d.metacritic as { score?: number })?.score || 0;

              db.prepare(`
                UPDATE games SET
                  name = COALESCE(?, name), description = ?, release_date = ?,
                  steam_genres = ?, steam_features = ?,
                  developers = ?, publishers = ?, metacritic_score = ?,
                  updated_at = datetime('now')
                WHERE id = ?
              `).run(name, desc, newDate, JSON.stringify(genres), JSON.stringify(feats), devs, pubs, mc, g.id);

              assignAllAutoTags(db, g.id, { releaseDate: newDate });
              updated++;
              send({ type: "progress", current: i + 1, total: games.length, name: g.name, oldDate, newDate });
            } else {
              unchanged++;
            }
          } catch {
            failed++;
          }

          // Rate limit: 200ms between requests
          if (i < games.length - 1) await sleep(200);
        }

        audit("SYNC_TBA", `checked=${games.length} updated=${updated} unchanged=${unchanged} failed=${failed}`);
        send({ type: "done", total: games.length, updated, unchanged, failed,
          message: `TBA refresh: ${updated} updated, ${unchanged} unchanged, ${failed} failed` });
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
