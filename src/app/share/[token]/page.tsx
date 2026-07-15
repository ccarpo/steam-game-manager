"use client";

import { useEffect, useState } from "react";
import { GameWithTags } from "@/lib/types";

interface ShareData {
  name: string;
  games: GameWithTags[];
  created_at: string;
  expires_at: string | null;
}

function scoreColor(pct: number): string {
  if (pct >= 80) return "#22c55e";
  if (pct >= 60) return "#f97316";
  return "#ef4444";
}

function assetUrl(game: GameWithTags): string {
  if (game.steam_appid) return `/api/assets/${game.steam_appid}/header.jpg`;
  return "";
}

function GameCard({ game }: { game: GameWithTags }) {
  const [imgErr, setImgErr] = useState(false);
  const img = assetUrl(game);

  return (
    <div className="bg-surface rounded-lg overflow-hidden border border-border/50 flex flex-col">
      <div className="relative aspect-[460/215] bg-surface2 overflow-hidden">
        {img && !imgErr ? (
          <img src={img} alt={game.name} className="w-full h-full object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted text-xs">No image</div>
        )}
        {game.positive_percent > 0 && (
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/70"
            style={{ color: scoreColor(game.positive_percent) }}>
            {game.positive_percent}%
          </div>
        )}
        {game.steam_appid && (
          <a href={`steam://run/${game.steam_appid}`}
            className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-black/70 text-green-400 hover:bg-green-700/80 hover:text-white transition-colors"
            title="Launch in Steam">▶</a>
        )}
      </div>
      <div className="p-2.5 flex-1 flex flex-col gap-1">
        <h3 className="text-xs font-medium truncate" title={game.name}>{game.name}</h3>
        <div className="flex gap-1.5 flex-wrap mt-auto">
          {game.steam_appid && (
            <a href={`https://store.steampowered.com/app/${game.steam_appid}`} target="_blank" rel="noreferrer"
              className="text-[9px] text-accent hover:underline">Steam ↗</a>
          )}
          {game.steam_appid && (
            <a href={`https://www.steamdb.info/app/${game.steam_appid}`} target="_blank" rel="noreferrer"
              className="text-[9px] text-muted hover:text-accent hover:underline">SteamDB ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { params.then((p) => setToken(p.token)); }, [params]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error || `Error ${r.status}`); });
        return r.json();
      })
      .then((d: ShareData) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <span className="text-muted">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-lg font-semibold mb-2">Link unavailable</h1>
          <p className="text-sm text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border px-6 py-4 flex items-center gap-3">
        <span className="text-lg">🎮</span>
        <div>
          <h1 className="text-sm font-semibold">{data.name}</h1>
          <p className="text-[11px] text-muted">
            {data.games.length} game{data.games.length !== 1 ? "s" : ""}
            {data.expires_at && <> · expires {data.expires_at}</>}
          </p>
        </div>
        <div className="ml-auto text-[10px] text-muted">Shared via Steam Game Manager</div>
      </div>

      <div className="p-6">
        {data.games.length === 0 ? (
          <div className="text-center text-muted py-16">No games in this collection.</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {data.games.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        )}
      </div>
    </div>
  );
}
