import { spawn } from "child_process";
import { getDb } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";
import { l2Normalize } from "@/lib/embeddings";
import { pushLog } from "@/lib/log-buffer";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * GET /api/sync/catalog — status: how many catalog rows and how many are embedded.
 */
export async function GET() {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) AS c FROM steam_catalog").get() as { c: number }).c;
  const embedded = (db.prepare(
    "SELECT COUNT(*) AS c FROM embeddings WHERE source = 'catalog'"
  ).get() as { c: number }).c;
  return Response.json({ total, embedded, missing: total - embedded });
}

/**
 * POST /api/sync/catalog?minReviews=100 — SSE stream.
 * Two steps: 1) Python script ingests metadata from data/catalog/games.json,
 * 2) Node embeds pending rows in batches against the configured Ollama model.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const minReviews = Math.max(0, parseInt(url.searchParams.get("minReviews") || "100", 10) || 100);
  const db = getDb();
  const provider = getAiProvider(db);

  const encoder = new TextEncoder();
  const script = path.join(process.cwd(), "scripts", "ingest_catalog.py");
  const dbPath = process.env.GM_DATA_DIR
    ? path.join(process.env.GM_DATA_DIR, "games.db")
    : path.join(process.cwd(), "data", "games.db");
  const catalogPath = process.env.GM_CATALOG_PATH
    || (process.env.GM_DATA_DIR
      ? path.join(process.env.GM_DATA_DIR, "catalog", "games.json")
      : path.join(process.cwd(), "data", "catalog", "games.json"));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        if (!provider) {
          send({ type: "error", message: "No AI provider configured (Settings › AI)." });
          controller.close();
          return;
        }

        send({ type: "status", message: `Importing catalog metadata (min ${minReviews} reviews)...` });

        await new Promise<void>((resolve, reject) => {
          const proc = spawn("python3", [script, "--db", dbPath, "--catalog", catalogPath, "--min-reviews", String(minReviews)], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let buf = "";
          proc.stdout.on("data", (chunk: Buffer) => {
            buf += chunk.toString("utf8");
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const obj = JSON.parse(line);
                send(obj);
                if (obj.type === "error") pushLog("ERROR", `catalog ingest: ${obj.message}`);
              } catch { /* ignore non-JSON lines */ }
            }
          });
          proc.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8").trim();
            if (text) pushLog("ERROR", `catalog ingest stderr: ${text}`);
          });
          proc.on("error", reject);
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Catalog import exited with code ${code}`));
          });
        });

        // Step 2: embed any catalog rows that do not yet have a current vector for this model.
        const model = provider.config.embedModel;
        const pending = db.prepare(
          `SELECT c.appid, c.name, c.embed_text, c.text_hash
           FROM steam_catalog c
           WHERE (positive + negative) >= ?
             AND NOT EXISTS (
               SELECT 1 FROM embeddings e
               WHERE e.source = 'catalog' AND e.key = c.appid AND e.model = ? AND e.text_hash = c.text_hash
             )
           ORDER BY (c.positive + c.negative) DESC`
        ).all(minReviews, model) as { appid: number; name: string; embed_text: string; text_hash: string }[];

        const totalPending = pending.length;
        if (totalPending === 0) {
          send({ type: "done", message: "Catalog import complete — all rows already embedded." });
          controller.close();
          return;
        }

        send({ type: "status", message: `Embedding ${totalPending} catalog rows with ${model}...` });

        const upsert = db.prepare(
          `INSERT INTO embeddings (source, key, model, dim, text_hash, vector, created_at)
           VALUES ('catalog', ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(source, key) DO UPDATE SET
             model = excluded.model, dim = excluded.dim, text_hash = excluded.text_hash,
             vector = excluded.vector, created_at = excluded.created_at`
        );

        const BATCH = 32;
        let embedded = 0;
        for (let i = 0; i < pending.length; i += BATCH) {
          const batch = pending.slice(i, i + BATCH);
          const vectors = await provider.embed(batch.map((b) => b.embed_text));
          const tx = db.transaction(() => {
            for (let j = 0; j < batch.length; j++) {
              const vec = l2Normalize(vectors[j]);
              upsert.run(batch[j].appid, model, vec.length, batch[j].text_hash, Buffer.from(vec.buffer));
              embedded++;
            }
          });
          tx();
          send({
            type: "progress",
            current: embedded,
            total: totalPending,
            name: batch[batch.length - 1].name,
          });
        }

        send({ type: "done", message: `Catalog import complete — ${embedded} rows embedded.`, embedded });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
        pushLog("ERROR", `catalog sync failed: ${message}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
