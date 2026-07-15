import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

type ShareTokenRow = { token: string; name: string; filter_json: string; created_at: string; expires_at: string | null };

// GET /api/share — list all tokens
export function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT token, name, filter_json, created_at, expires_at FROM share_tokens ORDER BY created_at DESC").all() as ShareTokenRow[];
  return NextResponse.json(rows);
}

// POST /api/share — create a new token
export async function POST(req: NextRequest) {
  const body = await req.json() as { name?: string; filter_json?: string; expires_in_days?: number };
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const filterJson = body.filter_json ?? "{}";
  const token = randomBytes(8).toString("hex"); // 16-char hex

  let expiresAt: string | null = null;
  if (body.expires_in_days && body.expires_in_days > 0) {
    const d = new Date();
    d.setDate(d.getDate() + body.expires_in_days);
    expiresAt = d.toISOString().split("T")[0];
  }

  const db = getDb();
  db.prepare("INSERT INTO share_tokens (token, name, filter_json, expires_at) VALUES (?, ?, ?, ?)").run(token, name, filterJson, expiresAt);

  return NextResponse.json({ token });
}
