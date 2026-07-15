import { getDb, getSteamCredentials } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type FriendGame = { appid: number; name: string; playtime_forever: number };
type FriendLibraryRow = { steam_id: string; persona_name: string; games_json: string; fetched_at: string };
type LocalGame = { steam_appid: number; name: string; steam_genres: string; community_tags: string; playtime_forever?: number };

function parseGames(value: string): FriendGame[] {
  try {
    const games = JSON.parse(value) as FriendGame[];
    return Array.isArray(games) ? games : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => typeof entry === "string" ? entry : entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string" ? entry.name : "");
  } catch {
    return [];
  }
}

function buildComparison(friend: FriendLibraryRow) {
  const db = getDb();
  const friendGames = parseGames(friend.games_json);
  const localGames = db.prepare("SELECT steam_appid, name, steam_genres, community_tags FROM games WHERE steam_appid IS NOT NULL").all() as LocalGame[];
  const localByAppId = new Map(localGames.map((game) => [game.steam_appid, game]));
  const friendByAppId = new Map(friendGames.map((game) => [game.appid, game]));

  const shared = friendGames
    .filter((game) => localByAppId.has(game.appid))
    .map((friendGame) => {
      const local = localByAppId.get(friendGame.appid)!;
      return { appid: friendGame.appid, name: local.name || friendGame.name, friend_playtime: friendGame.playtime_forever || 0 };
    })
    .sort((a, b) => b.friend_playtime - a.friend_playtime || a.name.localeCompare(b.name));

  const friendOnly = friendGames
    .filter((game) => !localByAppId.has(game.appid))
    .sort((a, b) => b.playtime_forever - a.playtime_forever || a.name.localeCompare(b.name));

  const localSteamCount = localGames.length;
  const unionCount = localSteamCount + friendGames.length - shared.length;
  const overlapScore = unionCount > 0 ? Math.round((shared.length / unionCount) * 100) : 0;

  const genreCounts = new Map<string, number>();
  const communityTagCounts = new Map<string, number>();
  for (const game of shared) {
    const local = localByAppId.get(game.appid)!;
    for (const genre of parseStringArray(local.steam_genres)) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    for (const tag of parseStringArray(local.community_tags)) communityTagCounts.set(tag, (communityTagCounts.get(tag) || 0) + 1);
  }
  const rank = (counts: Map<string, number>) => [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 12);

  return {
    friend: { steam_id: friend.steam_id, persona_name: friend.persona_name, fetched_at: friend.fetched_at },
    counts: { local: localSteamCount, friend: friendGames.length, shared: shared.length, friend_only: friendOnly.length, overlap_score: overlapScore },
    shared,
    friend_only: friendOnly,
    shared_genres: rank(genreCounts),
    shared_community_tags: rank(communityTagCounts),
  };
}

export function GET(req: NextRequest) {
  const db = getDb();
  const steamId = req.nextUrl.searchParams.get("steam_id");
  if (steamId) {
    const friend = db.prepare("SELECT steam_id, persona_name, games_json, fetched_at FROM friend_libraries WHERE steam_id = ?").get(steamId) as FriendLibraryRow | undefined;
    if (!friend) return NextResponse.json({ error: "Friend library not found. Add or refresh it first." }, { status: 404 });
    return NextResponse.json(buildComparison(friend));
  }

  const friends = db.prepare("SELECT steam_id, persona_name, fetched_at FROM friend_libraries ORDER BY persona_name COLLATE NOCASE").all();
  return NextResponse.json(friends);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { steam_id?: string };
  const steamId = (body.steam_id || "").trim();
  if (!/^\d{17}$/.test(steamId)) {
    return NextResponse.json({ error: "Enter a valid 17-digit Steam ID." }, { status: 400 });
  }

  const db = getDb();
  const { apiKey } = getSteamCredentials(db);
  if (!apiKey) return NextResponse.json({ error: "Steam API key is not configured." }, { status: 400 });

  const [profileRes, ownedRes] = await Promise.all([
    fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${steamId}`),
    fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`),
  ]);

  if (!profileRes.ok || !ownedRes.ok) {
    const status = !ownedRes.ok ? ownedRes.status : profileRes.status;
    return NextResponse.json({ error: status === 403 ? "Steam could not access this profile or game library. Ensure both are public." : `Steam API error: ${status}` }, { status: status >= 400 && status < 500 ? status : 502 });
  }

  const profileData = await profileRes.json() as { response?: { players?: { personaname?: string }[] } };
  const ownedData = await ownedRes.json() as { response?: { games?: { appid: number; name: string; playtime_forever?: number }[] } };
  const profile = profileData.response?.players?.[0];
  if (!profile) return NextResponse.json({ error: "Steam profile was not found." }, { status: 404 });

  const games: FriendGame[] = (ownedData.response?.games || []).map((game) => ({
    appid: game.appid,
    name: game.name || `Steam App ${game.appid}`,
    playtime_forever: game.playtime_forever || 0,
  }));
  const personaName = profile.personaname || steamId;
  db.prepare(`INSERT INTO friend_libraries (steam_id, persona_name, games_json, fetched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(steam_id) DO UPDATE SET persona_name = excluded.persona_name, games_json = excluded.games_json, fetched_at = excluded.fetched_at`)
    .run(steamId, personaName, JSON.stringify(games));

  const friend = db.prepare("SELECT steam_id, persona_name, games_json, fetched_at FROM friend_libraries WHERE steam_id = ?").get(steamId) as FriendLibraryRow;
  return NextResponse.json(buildComparison(friend));
}

export async function DELETE(req: NextRequest) {
  const steamId = req.nextUrl.searchParams.get("steam_id");
  if (!steamId) return NextResponse.json({ error: "steam_id is required" }, { status: 400 });
  getDb().prepare("DELETE FROM friend_libraries WHERE steam_id = ?").run(steamId);
  return NextResponse.json({ ok: true });
}
