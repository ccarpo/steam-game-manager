// OpenAI-compatible provider: /v1/embeddings, /v1/chat/completions, /v1/models.
// Works against Ollama, LM Studio, vLLM, OpenAI, OpenRouter.

import {
  AiConfig, AiError, AiProvider, ChatMessage, ChatOpts, HealthResult,
  modelMatches, redirectAuthHint, splitBaseUrlCredentials,
} from "./provider";

const EMBED_TIMEOUT_MS = 120_000; // big batches on CPU are slow
const CHAT_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 8_000;

export class OpenAiCompatibleProvider implements AiProvider {
  readonly config: AiConfig;
  private readonly base: string;
  private readonly basicAuth: string;

  constructor(config: AiConfig) {
    this.config = config;
    const { base, basicAuth } = splitBaseUrlCredentials(config.baseUrl);
    this.base = base;
    this.basicAuth = basicAuth;
    if (!this.base) throw new AiError("config", "AI base URL is not configured (Settings › AI).");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    // Only one Authorization header is possible: an explicit API key wins over
    // credentials embedded in the base URL.
    if (this.config.apiKey) h.Authorization = `Bearer ${this.config.apiKey}`;
    else if (this.basicAuth) h.Authorization = this.basicAuth;
    return h;
  }

  private async post(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new AiError("network", `${path} unreachable at ${this.base}: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AiError(
        "http",
        `${path} returned ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}${redirectAuthHint(res, this.base)}`,
        res.status,
      );
    }
    try {
      return await res.json();
    } catch {
      throw new AiError("parse", `${path} returned a non-JSON body`);
    }
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    if (!this.config.embedModel) throw new AiError("config", "No embedding model configured (Settings › AI).");
    const json = await this.post(
      "/v1/embeddings",
      { model: this.config.embedModel, input: texts },
      EMBED_TIMEOUT_MS,
      signal,
    ) as { data?: { embedding?: number[]; index?: number }[] };

    const data = json?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new AiError("parse", `embeddings returned ${data?.length ?? 0} vectors for ${texts.length} inputs`);
    }
    // Respect `index` when present — the spec allows out-of-order results.
    const out = new Array<Float32Array>(texts.length);
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const vec = row?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) throw new AiError("parse", "embeddings response contained an empty vector");
      const at = typeof row.index === "number" && row.index >= 0 && row.index < texts.length ? row.index : i;
      out[at] = Float32Array.from(vec);
    }
    for (let i = 0; i < out.length; i++) {
      if (!out[i]) throw new AiError("parse", `embeddings response missing vector at index ${i}`);
    }
    return out;
  }

  async chat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
    if (!this.config.chatModel) throw new AiError("config", "No chat model configured (Settings › AI).");
    const body: Record<string, unknown> = {
      model: this.config.chatModel,
      messages,
      stream: false,
      temperature: opts.temperature ?? 0.3,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: "json_object" };

    const json = await this.post("/v1/chat/completions", body, CHAT_TIMEOUT_MS, opts.signal) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new AiError("parse", "chat response had no message content");
    return content;
  }

  async listModels(): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/v1/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch (e) {
      throw new AiError("network", `/v1/models unreachable at ${this.base}: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) {
      throw new AiError("http", `/v1/models returned ${res.status}${redirectAuthHint(res, this.base)}`, res.status);
    }
    const json = await res.json().catch(() => null) as { data?: { id?: string }[] } | null;
    const ids = (json?.data || []).map((m) => m.id).filter((id): id is string => !!id);
    return ids.sort((a, b) => a.localeCompare(b));
  }

  async health(): Promise<HealthResult> {
    const started = Date.now();
    try {
      const models = await this.listModels();
      const latencyMs = Date.now() - started;
      const has = (want: string) => !!want && models.some((m) => modelMatches(m, want));
      const embedOk = has(this.config.embedModel);
      const chatOk = has(this.config.chatModel);

      const missing: string[] = [];
      if (!this.config.embedModel) missing.push("no embedding model configured");
      else if (!embedOk) missing.push(`embedding model "${this.config.embedModel}" not pulled`);
      if (this.config.chatModel && !chatOk) missing.push(`chat model "${this.config.chatModel}" not pulled`);

      const count = `${models.length} model${models.length === 1 ? "" : "s"}`;
      const detail = missing.length > 0
        ? `Reachable (${count}) but ${missing.join(" and ")}.`
        : `Reachable — ${count} available.`;
      // Only embeddings gate taste/similarity/discover; chat is reported separately so a
      // missing chat model does not make the whole provider look broken.
      return { ok: embedOk, latencyMs, detail, embedOk, chatOk, models };
    } catch (e) {
      return { ok: false, embedOk: false, chatOk: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}
