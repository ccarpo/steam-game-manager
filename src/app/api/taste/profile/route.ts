import { getDb } from "@/lib/db";
import { getAiConfig } from "@/lib/ai";
import { buildProfile } from "@/lib/taste-data";
import { gameWeight, detectBounce } from "@/lib/taste";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/taste/profile[?debug=1]
 * Deterministic — needs no AI model at request time, only the embedding vectors
 * that a previous `/api/sync/embeddings` run produced.
 */
export function GET(req: NextRequest) {
  const db = getDb();
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  const model = getAiConfig(db).embedModel;
  const now = Math.floor(Date.now() / 1000);
  const bundle = buildProfile(db, model, now);
  const { profile, byAppid } = bundle;

  const nameOf = (appid: number) => byAppid.get(appid)?.name || String(appid);
  const idOf = (appid: number) => byAppid.get(appid)?.id ?? null;

  const body: Record<string, unknown> = {
    model,
    computedAt: profile.computedAt,
    signalCount: profile.signalCount,
    confidence: profile.confidence,
    coverage: {
      totalOwned: bundle.totalOwned,
      withVectors: bundle.withVectors,
      missingVectors: bundle.totalOwned - bundle.withVectors,
      hasTasteVector: profile.vector.some((x) => x !== 0),
    },
    topTags: profile.topTags.map((t) => ({
      tag: t.tag,
      weight: t.weight,
      examples: t.exampleAppids.map((a) => ({ appid: a, id: idOf(a), name: nameOf(a) })),
    })),
    anchorGames: profile.anchorGames.map((a) => ({
      appid: a.appid, id: idOf(a.appid), name: a.name, weight: a.weight,
    })),
    antiClusters: profile.antiClusters.map((c) => ({
      label: c.label,
      tags: c.tags,
      strength: c.strength,
      bounced: c.bounced.map((b) => ({
        appid: b.appid, id: idOf(b.appid), name: b.name,
        playtimeHours: b.playtimeHours, lastPlayed: b.lastPlayed, kind: b.kind,
      })),
    })),
  };

  if (debug) {
    // Per-game weights, for sanity-checking the formula against a real library.
    body.debug = bundle.signals
      .map((s) => ({
        appid: s.appid, name: s.name, hours: Number(s.hours.toFixed(2)),
        category: s.category, achPct: s.achPct, hasVector: !!s.vector,
        weight: Number(gameWeight(s, now).toFixed(4)),
        bounce: detectBounce(s, now),
      }))
      .sort((a, b) => b.weight - a.weight);
  }

  return NextResponse.json(body);
}
