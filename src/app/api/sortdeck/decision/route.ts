import { getDb, ensureSteamTag } from "@/lib/db";
import { audit } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface DecisionBody {
  card?: {
    key?: string;
    gameId?: number | null;
    appid?: number | null;
    name?: string;
    tags?: string[];
    genres?: string[];
    positivePercent?: number;
    totalReviews?: number;
    description?: string;
    releaseDate?: string;
    developers?: string[];
  };
  action?: "skip" | "assign";
  bucket?: {
    tag: string;
    subtag: string;
    /** For unowned cards: also tag steam>wishlist (the local wishlist). */
    wishlist?: boolean;
  } | null;
}

function ensureTagSubtag(db: ReturnType<typeof getDb>, tagName: string, subName: string) {
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)").run(tagName, "#a78bfa");
  const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(tagName) as { id: number };
  db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, 'meta')").run(tag.id, subName);
  const sub = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?").get(tag.id, subName) as { id: number };
  return { tagId: tag.id, subtagId: sub.id };
}

/**
 * POST /api/sortdeck/decision — records one card decision.
 * "skip" writes nothing. "assign" ensures the bucket tag>subtag and links it to
 * the game, inserting a games row for unowned cards (plus steam>wishlist when
 * the bucket is marked wishlist).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as DecisionBody | null;
  if (!body?.card || !body.action) {
    return NextResponse.json({ error: "card and action are required" }, { status: 400 });
  }
  if (body.action === "skip") return NextResponse.json({ ok: true, skipped: true });
  if (body.action !== "assign" || !body.bucket?.tag || !body.bucket?.subtag) {
    return NextResponse.json({ error: "action must be 'skip' or 'assign' with bucket {tag, subtag}" }, { status: 400 });
  }

  const db = getDb();
  const card = body.card;

  // Resolve the games row — insert one for catalog cards.
  let gameId = card.gameId ?? null;
  let inserted = false;
  if (gameId == null) {
    if (!card.appid || !card.name) {
      return NextResponse.json({ error: "unowned card needs appid and name" }, { status: 400 });
    }
    const existing = db.prepare("SELECT id FROM games WHERE steam_appid = ?").get(card.appid) as { id: number } | undefined;
    if (existing) {
      gameId = existing.id;
    } else {
      const today = new Date().toISOString().split("T")[0];
      const r = db.prepare(
        `INSERT INTO games (name, steam_appid, steam_genres, community_tags, developers,
                            description, release_date, positive_percent, total_reviews,
                            wishlist_date, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        card.name,
        card.appid,
        JSON.stringify(card.genres || []),
        JSON.stringify(card.tags || []),
        JSON.stringify(card.developers || []),
        card.description || "",
        card.releaseDate || "",
        card.positivePercent || 0,
        card.totalReviews || 0,
        body.bucket.wishlist ? today : null,
        today,
      );
      gameId = Number(r.lastInsertRowid);
      inserted = true;
    }
  }

  const { tagId, subtagId } = ensureTagSubtag(db, body.bucket.tag, body.bucket.subtag);
  db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)")
    .run(gameId, tagId, subtagId);

  let wishlistTag: { tagId: number; subtagId: number } | null = null;
  if (body.bucket.wishlist && card.appid != null) {
    const { tagId: steamTagId, subtags } = ensureSteamTag(db);
    db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)")
      .run(gameId, steamTagId, subtags.wishlist);
    wishlistTag = { tagId: steamTagId, subtagId: subtags.wishlist };
  }

  audit("SORT_DECISION", `${card.name || gameId} → ${body.bucket.tag}>${body.bucket.subtag}${wishlistTag ? " +wishlist" : ""}${inserted ? " (new)" : ""}`);

  return NextResponse.json({ ok: true, gameId, inserted, tagId, subtagId, wishlistTag });
}
