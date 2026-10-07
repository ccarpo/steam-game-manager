import { getDb } from "@/lib/db";
import { getAiConfig } from "@/lib/ai";
import { redirectAuthHint, splitBaseUrlCredentials } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/ai/pull?model=<name> — Ollama-only sugar around /api/pull.
 * Streams progress as SSE. Not part of the OpenAI spec, so it is gated on flavor.
 */
export async function POST(req: Request) {
  const model = new URL(req.url).searchParams.get("model")?.trim();
  const cfg = getAiConfig(getDb());
  const { base, basicAuth } = splitBaseUrlCredentials(cfg.baseUrl);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        if (!base) { send({ type: "error", message: "No AI base URL configured (Settings › AI)." }); controller.close(); return; }
        if (cfg.flavor !== "ollama") { send({ type: "error", message: "Model pulling is only available for the Ollama flavor." }); controller.close(); return; }
        if (!model) { send({ type: "error", message: "model query parameter required" }); controller.close(); return; }

        send({ type: "status", message: `Pulling ${model}...` });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
        else if (basicAuth) headers.Authorization = basicAuth;
        const res = await fetch(`${base}/api/pull`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model, stream: true }),
        });
        if (!res.ok || !res.body) {
          send({ type: "error", message: `Ollama /api/pull returned ${res.status}${redirectAuthHint(res, base)}` });
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let lastPct = -1;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let obj: { status?: string; completed?: number; total?: number; error?: string };
            try { obj = JSON.parse(line); } catch { continue; }
            if (obj.error) { send({ type: "error", message: obj.error }); continue; }
            if (obj.total && obj.completed) {
              const pct = Math.floor((obj.completed / obj.total) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                send({ type: "progress", current: pct, total: 100, name: obj.status || "downloading" });
              }
            } else if (obj.status) {
              send({ type: "status", message: obj.status });
            }
          }
        }
        send({ type: "done", message: `Pull finished for ${model}` });
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
