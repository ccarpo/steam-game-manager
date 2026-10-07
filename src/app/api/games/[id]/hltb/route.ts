import { getDb } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

// PUT /api/games/:id/hltb — manual HLTB match override (or clear with hltb_id null)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as {
    hltb_id?: number | null; hltb_name?: string | null;
    main_hours?: number | null; extra_hours?: number | null; completionist_hours?: number | null;
  };
  const db = getDb();
  const game = db.prepare("SELECT id, name, steam_appid FROM games WHERE id = ?").get(id) as { id: number; name: string; steam_appid: number | null } | undefined;
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (game.steam_appid == null) return NextResponse.json({ error: "Game has no steam_appid" }, { status: 400 });

  const clear = body.hltb_id == null;
  db.prepare(
    `INSERT INTO hltb (appid, hltb_id, hltb_name, main_hours, extra_hours, completionist_hours, match_status, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(appid) DO UPDATE SET
       hltb_id = excluded.hltb_id, hltb_name = excluded.hltb_name,
       main_hours = excluded.main_hours, extra_hours = excluded.extra_hours,
       completionist_hours = excluded.completionist_hours,
       match_status = excluded.match_status, fetched_at = excluded.fetched_at`
  ).run(
    game.steam_appid,
    clear ? null : body.hltb_id,
    clear ? null : (body.hltb_name ?? null),
    clear ? null : (body.main_hours ?? null),
    clear ? null : (body.extra_hours ?? null),
    clear ? null : (body.completionist_hours ?? null),
    clear ? "no_match" : "matched",
  );

  audit("HLTB_MATCH", `"${game.name}" [id=${id} appid=${game.steam_appid}] ${clear ? "cleared" : `manual match → hltb ${body.hltb_id} "${body.hltb_name}"`}`);

  const row = db.prepare("SELECT hltb_id, hltb_name, main_hours, extra_hours, completionist_hours, match_status, fetched_at FROM hltb WHERE appid = ?").get(game.steam_appid);
  return NextResponse.json(row);
}
