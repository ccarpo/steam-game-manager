// Edge-compatible JWT-style session helpers using Web Crypto (HMAC-SHA256).
// Works in both the Next.js Edge runtime (middleware) and Node.js route handlers.

export interface SessionPayload {
  sub: number;
  username: string;
  role: "reader" | "user" | "admin";
  exp: number;
}

const encoder = new TextEncoder();

function b64urlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  return new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", await getKey(secret), encoder.encode(signingInput));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const signingInput = `${header}.${body}`;
  const sigBytes = b64urlDecode(signature);
  const ok = await crypto.subtle.verify("HMAC", await getKey(secret), sigBytes as BufferSource, encoder.encode(signingInput));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}
