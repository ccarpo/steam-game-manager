import { getDb } from "@/lib/db";
import { getAiProvider } from "@/lib/ai";
import { embedGames, embeddingStatus } from "@/lib/embeddings";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/sync/embeddings — coverage stats
export function GET() {
  const db = getDb();
  const provider = getAiProvider(db);
  if (!provider) return NextResponse.json({ error: "No AI base URL configured (Settings › AI)." }, { status: 400 });
  const model = provider.config.embedModel;
  return NextResponse.json({ model, ...embeddingStatus(db, model) });
}

/** POST /api/sync/embeddings?mode=missing|all&limit=N — SSE progress. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "all" ? "all" : "missing";
  const limit = parseInt(url.searchParams.get("limit") || "0", 10) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const db = getDb();
        const provider = getAiProvider(db);
        if (!provider) {
          send({ type: "error", message: "No AI base URL configured (Settings › AI)." });
          controller.close();
          return;
        }
        const health = await provider.health();
        if (!health.ok) {
          send({ type: "error", message: `AI provider not usable: ${health.detail}` });
          controller.close();
          return;
        }
        send({ type: "status", message: `Provider OK (${health.latencyMs}ms) — embedding with ${provider.config.embedModel}` });

        const res = await embedGames(db, provider, {
          mode, limit,
          onStatus: (message) => send({ type: "status", message }),
          onProgress: (p) => send({ type: "progress", current: p.current, total: p.total, name: p.name, embedded: p.embedded }),
        });
        send({
          type: "done", ...res,
          message: `Embeddings: ${res.embedded} written, ${res.skipped} already current`,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
