import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/sortdeck/undo — reverses a decision recorded this session.
 * { gameId, tagId, subtagId, inserted } — `inserted` means the games row was
 * created by the decision and is deleted outright (cascades to game_tags).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    gameId?: number; tagId?: number; subtagId?: number; inserted?: boolean;
    /** Optional second tag assignment to also remove (e.g. steam>wishlist on an existing row). */
    extraTag?: { tagId: number; subtagId: number } | null;
  } | null;
  if (!body?.gameId) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }

  const db = getDb();
  const game = db.prepare("SELECT name FROM games WHERE id = ?").get(body.gameId) as { name: string } | undefined;

  if (body.inserted) {
    db.prepare("DELETE FROM games WHERE id = ?").run(body.gameId);
    audit("SORT_UNDO", `removed inserted row ${game?.name || body.gameId}`);
    return NextResponse.json({ ok: true });
  }

  if (body.tagId && body.subtagId) {
    db.prepare("DELETE FROM game_tags WHERE game_id = ? AND tag_id = ? AND subtag_id = ?")
      .run(body.gameId, body.tagId, body.subtagId);
    audit("SORT_UNDO", `unassigned tag on ${game?.name || body.gameId}`);
  }
  if (body.extraTag?.tagId && body.extraTag?.subtagId) {
    db.prepare("DELETE FROM game_tags WHERE game_id = ? AND tag_id = ? AND subtag_id = ?")
      .run(body.gameId, body.extraTag.tagId, body.extraTag.subtagId);
  }

  return NextResponse.json({ ok: true });
}
