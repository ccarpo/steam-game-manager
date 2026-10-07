import { getDb } from "@/lib/db";
import { setOverride } from "@/lib/classify";
import { Category } from "@/lib/classifier";
import { NextRequest, NextResponse } from "next/server";

const VALID: Category[] = ["COMPLETED", "IN_PROGRESS", "ENDLESS", "NOT_A_GAME"];

// PUT /api/games/:id/classification { override: Category | null }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as { override?: Category | null };
  const override = body.override ?? null;
  if (override !== null && !VALID.includes(override)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  const db = getDb();
  const game = db.prepare("SELECT id FROM games WHERE id = ?").get(id);
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = setOverride(db, Number(id), override);
  return NextResponse.json(row ?? null);
}
