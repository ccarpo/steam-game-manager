import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type SteamDbPayload = {
  appid?: unknown;
  name?: unknown;
  developers?: unknown;
  publishers?: unknown;
  release_date?: unknown;
  features?: unknown;
  community_tags?: unknown;
  header_image?: unknown;
  source?: unknown;
};

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: NextRequest) {
  let payload: SteamDbPayload;
  try {
    payload = await req.json() as SteamDbPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const appid = Number(payload.appid);
  const name = text(payload.name);
  if (!Number.isInteger(appid) || appid <= 0 || !name) {
    return NextResponse.json({ error: "The SteamDB payload needs a valid appid and game name." }, { status: 400 });
  }

  const developers = strings(payload.developers);
  const publishers = strings(payload.publishers);
  const features = strings(payload.features);
  const communityTags = strings(payload.community_tags);
  const releaseDate = text(payload.release_date);
  const headerImage = text(payload.header_image) || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;

  const db = getDb();
  const game = db.prepare("SELECT id, description, steam_genres, screenshots, movies, metacritic_score FROM games WHERE steam_appid = ?").get(appid) as
    { id: number; description: string; steam_genres: string; screenshots: string; movies: string; metacritic_score: number } | undefined;
  if (!game) return NextResponse.json({ error: `No local game exists with Steam App ID ${appid}.` }, { status: 404 });

  let existingGenres: string[] = [];
  let existingScreenshots: { path_full: string }[] = [];
  let existingMovies: { name: string; thumbnail_url: string; video_url: string }[] = [];
  try { existingGenres = JSON.parse(game.steam_genres); } catch {}
  try { existingScreenshots = JSON.parse(game.screenshots).map((path_full: string) => ({ path_full })); } catch {}
  try { existingMovies = JSON.parse(game.movies); } catch {}

  const appdetails = JSON.stringify({
    [String(appid)]: {
      success: true,
      data: {
        name,
        header_image: headerImage,
        short_description: game.description,
        genres: existingGenres.map((description) => ({ description })),
        developers,
        publishers,
        release_date: { date: releaseDate },
        categories: features.map((description) => ({ description })),
        metacritic: { score: game.metacritic_score },
        screenshots: existingScreenshots,
        movies: existingMovies,
      },
    },
  });

  db.prepare(`UPDATE games SET name = ?, steam_features = ?, community_tags = ?, developers = ?, publishers = ?, release_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, JSON.stringify(features), JSON.stringify(communityTags), JSON.stringify(developers), JSON.stringify(publishers), releaseDate, game.id);
  db.prepare(`INSERT INTO steam_cache (appid, appdetails, fetched_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(appid) DO UPDATE SET appdetails = excluded.appdetails, fetched_at = excluded.fetched_at`)
    .run(appid, appdetails);

  let headerDownloaded = false;
  try {
    const res = await fetch(headerImage);
    if (res.ok) {
      const assetDir = path.join(process.cwd(), "data", "assets", "games", String(appid));
      fs.mkdirSync(assetDir, { recursive: true });
      fs.writeFileSync(path.join(assetDir, "header.jpg"), Buffer.from(await res.arrayBuffer()));
      headerDownloaded = true;
    }
  } catch {}

  return NextResponse.json({ ok: true, appid, game_id: game.id, header_downloaded: headerDownloaded });
}
