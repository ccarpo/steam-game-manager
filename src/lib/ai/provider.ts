// AI provider abstraction. One implementation (openai-compatible) covers Ollama,
// LM Studio, vLLM, OpenAI and OpenRouter — swapping engines = changing base URL/model.
// No `@/` imports: must stay runnable under plain `node --test`.

export interface AiConfig {
  /** Base URL without the trailing /v1, e.g. http://192.168.1.50:5005 */
  baseUrl: string;
  apiKey: string;
  embedModel: string;
  chatModel: string;
  /** "openai" = spec-only; "ollama" enables /api/tags + /api/pull sugar. */
  flavor: "openai" | "ollama";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object response when supported. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface HealthResult {
  /** Reachable *and* ready to embed — embeddings gate taste, similarity and discover. */
  ok: boolean;
  detail: string;
  /** Round-trip time of the probe in ms, when it succeeded. */
  latencyMs?: number;
  /** Per-capability readiness: a missing chat model must not block embedding work. */
  embedOk?: boolean;
  chatOk?: boolean;
  models?: string[];
}

export interface AiProvider {
  readonly config: AiConfig;
  /** Embeds texts in order; returns one vector per input. */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
  chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string>;
  listModels(): Promise<string[]>;
  health(): Promise<HealthResult>;
}

export class AiError extends Error {
  kind: "config" | "network" | "http" | "parse";
  status?: number;
  constructor(kind: AiError["kind"], message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.name = "AiError";
  }
}

/** Strip trailing slashes and an accidental trailing /v1 so we can append paths safely. */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw || "").trim().replace(/\/+$/, "");
  if (s.endsWith("/v1")) s = s.slice(0, -3);
  return s;
}

export function isConfigured(cfg: AiConfig): boolean {
  return normalizeBaseUrl(cfg.baseUrl).length > 0;
}

/**
 * Ollama's /v1/models reports `name:latest` while people configure the bare `name`
 * (and `ollama pull nomic-embed-text` stores it tagged), so compare tag-insensitively
 * when either side omits the implicit `:latest`.
 */
export function modelMatches(available: string, wanted: string): boolean {
  const strip = (s: string) => s.trim().replace(/:latest$/, "");
  return strip(available) === strip(wanted);
}

/**
 * Masks `user:pass@` so a base URL is safe to put in API responses, logs and the UI.
 * Credentials in the URL are common for reverse-proxied Ollama instances.
 */
export function redactUrlCredentials(raw: string): string {
  return (raw || "").replace(/^([a-zA-Z][\w+.-]*:\/\/)[^/@\s]*@/, "$1***@");
}

/**
 * Splits `http://user:pass@host` into a credential-free base URL plus a ready-to-use
 * `Authorization` value. Node's fetch refuses any URL carrying credentials
 * ("Request cannot be constructed from a URL that includes credentials"), so a reverse
 * proxy using HTTP Basic auth can only be reached by moving them into the header.
 */
export function splitBaseUrlCredentials(raw: string): { base: string; basicAuth: string } {
  const base = normalizeBaseUrl(raw);
  if (!base) return { base: "", basicAuth: "" };
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return { base, basicAuth: "" }; // not absolute; let fetch report it
  }
  if (!u.username && !u.password) return { base, basicAuth: "" };
  const creds = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
  u.username = "";
  u.password = "";
  return {
    base: normalizeBaseUrl(u.toString()),
    basicAuth: `Basic ${Buffer.from(creds).toString("base64")}`,
  };
}

/**
 * Explains the most common silent failure: an http→https redirect. Both fetch and the
 * browser drop `Authorization` when the origin changes, so the upgraded request arrives
 * unauthenticated and the proxy answers 401/403.
 */
export function redirectAuthHint(res: Response, requestedBase: string): string {
  if (!res.redirected || (res.status !== 401 && res.status !== 403)) return "";
  let target = "";
  try {
    const u = new URL(res.url);
    target = `${u.protocol}//${u.host}`;
  } catch {
    target = res.url;
  }
  return ` The server redirected to ${target}; credentials are not forwarded across a scheme/host change — set the base URL to ${target} directly instead of ${requestedBase}.`;
}
