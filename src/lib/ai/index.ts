import { Database } from "../sqlite";
import { getSetting } from "../settings";
import { AiConfig, AiProvider, isConfigured } from "./provider";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export const AI_DEFAULTS = {
  embedModel: "nomic-embed-text",
  chatModel: "qwen3:8b",
  flavor: "ollama" as const,
};

export function getAiConfig(db: Database): AiConfig {
  return {
    baseUrl: getSetting(db, "ai_base_url", ""),
    apiKey: getSetting(db, "ai_api_key", ""),
    embedModel: getSetting(db, "ai_embed_model", AI_DEFAULTS.embedModel),
    chatModel: getSetting(db, "ai_chat_model", AI_DEFAULTS.chatModel),
    flavor: getSetting(db, "ai_flavor", AI_DEFAULTS.flavor) === "openai" ? "openai" : "ollama",
  };
}

/** Returns null when no base URL is set, so callers can fall back deterministically. */
export function getAiProvider(db: Database): AiProvider | null {
  const cfg = getAiConfig(db);
  if (!isConfigured(cfg)) return null;
  return new OpenAiCompatibleProvider(cfg);
}

export { AiError, isConfigured, normalizeBaseUrl } from "./provider";
export type { AiConfig, AiProvider, ChatMessage, ChatOpts, HealthResult } from "./provider";
