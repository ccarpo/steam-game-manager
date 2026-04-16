import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PREF_KEYS = [
  "gm_filters", "gm_default_filters", "gm_view", "gm_cols",
  "gm_sidebar", "gm_sidebar_width", "gm_sidebar_layout", "gm_sidebar_split",
];

/** GET: return all UI prefs from settings table */
export async function GET() {
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const prefs: Record<string, string> = {};
  for (const key of PREF_KEYS) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`pref_${key}`) as { value: string } | undefined;
    if (row) prefs[key] = row.value;
  }
  return NextResponse.json(prefs);
}

/** PUT: save a UI pref to settings table */
export async function PUT(req: NextRequest) {
  const { key, value } = await req.json();
  if (!PREF_KEYS.includes(key)) return NextResponse.json({ error: "Invalid pref key" }, { status: 400 });
  const db = getDb();
  db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`pref_${key}`, typeof value === "string" ? value : JSON.stringify(value));
  return NextResponse.json({ ok: true });
}

/** DELETE: clear all UI prefs */
export async function DELETE() {
  const db = getDb();
  for (const key of PREF_KEYS) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(`pref_${key}`);
  }
  return NextResponse.json({ ok: true });
}
