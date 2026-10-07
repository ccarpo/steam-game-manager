import { test } from "node:test";
import assert from "node:assert/strict";
import { modelMatches, normalizeBaseUrl, redactUrlCredentials, splitBaseUrlCredentials } from "./provider.ts";

test("normalize_base_url_strips_slash_and_v1", () => {
  assert.equal(normalizeBaseUrl("http://host:11434/"), "http://host:11434");
  assert.equal(normalizeBaseUrl("http://host:11434/v1"), "http://host:11434");
  assert.equal(normalizeBaseUrl("http://host:11434/v1/"), "http://host:11434");
  assert.equal(normalizeBaseUrl("  http://host:11434  "), "http://host:11434");
  assert.equal(normalizeBaseUrl(""), "");
});

test("split_base_url_credentials_moves_userinfo_to_header", () => {
  const { base, basicAuth } = splitBaseUrlCredentials("http://user:pass@ollama.example.net");
  assert.equal(base, "http://ollama.example.net");
  assert.equal(basicAuth, `Basic ${Buffer.from("user:pass").toString("base64")}`);
});

test("split_base_url_credentials_passthrough_without_userinfo", () => {
  const { base, basicAuth } = splitBaseUrlCredentials("https://ollama.example.net/v1");
  assert.equal(base, "https://ollama.example.net");
  assert.equal(basicAuth, "");
});

test("split_base_url_credentials_decodes_percent_escapes", () => {
  // A password containing "@" or ":" must be percent-encoded in a URL.
  const { basicAuth } = splitBaseUrlCredentials("http://user:p%40ss%3Aword@host");
  assert.equal(basicAuth, `Basic ${Buffer.from("user:p@ss:word").toString("base64")}`);
});

test("split_base_url_credentials_handles_username_only", () => {
  const { base, basicAuth } = splitBaseUrlCredentials("http://token@host:8080");
  assert.equal(base, "http://token@host:8080".replace("token@", ""));
  assert.equal(basicAuth, `Basic ${Buffer.from("token:").toString("base64")}`);
});

test("split_base_url_credentials_tolerates_non_absolute", () => {
  const { base, basicAuth } = splitBaseUrlCredentials("not a url");
  assert.equal(base, "not a url");
  assert.equal(basicAuth, "");
});

test("model_matches_ignores_implicit_latest_tag", () => {
  // Ollama's /v1/models answers "nomic-embed-text:latest" for `ollama pull nomic-embed-text`.
  assert.ok(modelMatches("nomic-embed-text:latest", "nomic-embed-text"));
  assert.ok(modelMatches("nomic-embed-text", "nomic-embed-text:latest"));
  assert.ok(modelMatches("qwen3:8b", "qwen3:8b"));
  // A real tag difference is still a mismatch.
  assert.ok(!modelMatches("qwen3:8b", "qwen3:14b"));
  assert.ok(!modelMatches("qwen3:8b", "qwen3"));
  assert.ok(!modelMatches("nomic-embed-text:latest", ""));
});

test("redact_url_credentials_masks_userinfo", () => {
  assert.equal(redactUrlCredentials("http://user:pass@ollama.example.net"), "http://***@ollama.example.net");
  assert.equal(redactUrlCredentials("https://user:pass@host:8080/v1"), "https://***@host:8080/v1");
  assert.equal(redactUrlCredentials("http://host:11434"), "http://host:11434");
  assert.equal(redactUrlCredentials(""), "");
  // A later @ in the path must not be mistaken for userinfo.
  assert.equal(redactUrlCredentials("http://host/x@y"), "http://host/x@y");
});
