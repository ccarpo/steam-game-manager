"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Friend = { steam_id: string; persona_name: string; fetched_at: string };
type Game = { appid: number; name: string; friend_playtime?: number; playtime_forever?: number };
type Comparison = {
  friend: Friend;
  counts: { local: number; friend: number; shared: number; friend_only: number; overlap_score: number };
  shared: Game[];
  friend_only: Game[];
  shared_genres: { name: string; count: number }[];
  shared_community_tags: { name: string; count: number }[];
};

function Hours({ minutes }: { minutes: number }) {
  return <>{minutes > 0 ? `${Math.round(minutes / 60)}h` : "—"}</>;
}

function CountList({ title, values }: { title: string; values: { name: string; count: number }[] }) {
  return (
    <section className="bg-surface rounded-lg p-4 border border-border">
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      {values.length === 0 ? <p className="text-xs text-muted">No shared metadata yet.</p> : (
        <div className="flex flex-wrap gap-1.5">
          {values.map(({ name, count }) => <span key={name} className="px-2 py-1 rounded bg-background border border-border text-[11px] text-muted">{name} <b className="text-foreground">{count}</b></span>)}
        </div>
      )}
    </section>
  );
}

export default function ComparePage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [steamId, setSteamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    const response = await fetch("/api/compare");
    if (!response.ok) return;
    const rows = await response.json() as Friend[];
    setFriends(rows);
    if (rows.length && !comparison) loadComparison(rows[0].steam_id);
  }, [comparison]);

  const loadComparison = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/compare?steam_id=${encodeURIComponent(id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load comparison.");
      setComparison(body as Comparison);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load comparison.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFriends(); }, [loadFriends]);

  const addOrRefresh = async (event: FormEvent) => {
    event.preventDefault();
    if (!steamId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steam_id: steamId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to fetch the Steam library.");
      setComparison(body as Comparison);
      setSteamId("");
      await loadFriends();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to fetch the Steam library.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this cached friend library?")) return;
    await fetch(`/api/compare?steam_id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setComparison(null);
    await loadFriends();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-6xl mx-auto p-6">
        <header className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-lg font-semibold">👥 Friend Library Comparison</h1>
            <p className="text-xs text-muted mt-1">Compare your Steam library with public friend libraries cached locally.</p>
          </div>
          <Link href="/" className="text-xs text-muted hover:text-foreground">← Back</Link>
        </header>

        <form onSubmit={addOrRefresh} className="bg-surface rounded-lg p-4 border border-border flex flex-wrap gap-3 items-end mb-5">
          <label className="flex-1 min-w-56">
            <span className="block text-xs text-muted mb-1">Friend Steam ID</span>
            <input value={steamId} onChange={(event) => setSteamId(event.target.value)} placeholder="17-digit Steam ID" inputMode="numeric"
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          </label>
          <button disabled={loading || !steamId.trim()} className="px-4 py-2 rounded bg-accent text-white text-sm hover:bg-accent/90 disabled:opacity-50">
            {loading ? "Fetching…" : "Add / Refresh"}
          </button>
        </form>

        {error && <div className="mb-5 border border-red-500/50 bg-red-500/10 rounded p-3 text-sm text-red-300">{error}</div>}

        {friends.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {friends.map((friend) => (
              <div key={friend.steam_id} className={`flex items-center gap-2 rounded border px-2 py-1 ${comparison?.friend.steam_id === friend.steam_id ? "border-accent bg-accent/10" : "border-border bg-surface"}`}>
                <button onClick={() => loadComparison(friend.steam_id)} className="text-xs hover:text-accent">{friend.persona_name}</button>
                <button onClick={() => loadComparison(friend.steam_id)} className="text-[10px] text-muted hover:text-foreground">↻</button>
                <button onClick={() => remove(friend.steam_id)} className="text-[10px] text-red-400 hover:text-red-300">×</button>
              </div>
            ))}
          </div>
        )}

        {!comparison && !loading && <div className="text-center py-20 text-muted text-sm">Add a friend’s public Steam ID to begin comparing libraries.</div>}

        {comparison && (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
              {[
                { label: "Your Steam Games", value: comparison.counts.local },
                { label: `${comparison.friend.persona_name}'s Games`, value: comparison.counts.friend },
                { label: "Shared Games", value: comparison.counts.shared },
                { label: "They Own / You Don’t", value: comparison.counts.friend_only },
                { label: "Library Overlap", value: `${comparison.counts.overlap_score}%` },
              ].map((item) => <div key={item.label} className="bg-surface rounded-lg border border-border p-3 text-center"><div className="text-xl font-bold text-accent">{item.value}</div><div className="text-[10px] text-muted mt-1">{item.label}</div></div>)}
            </section>

            <div className="grid md:grid-cols-2 gap-4 mb-5">
              <CountList title="Shared Game Genres" values={comparison.shared_genres} />
              <CountList title="Shared Community Tags" values={comparison.shared_community_tags} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <section className="bg-surface rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border"><h2 className="text-sm font-semibold">Games You Both Own</h2></div>
                <div className="max-h-[34rem] overflow-y-auto divide-y divide-border/70">
                  {comparison.shared.map((game) => <div key={game.appid} className="flex items-center gap-3 px-4 py-2.5"><a href={`https://store.steampowered.com/app/${game.appid}`} target="_blank" rel="noreferrer" className="flex-1 text-xs hover:text-accent">{game.name}</a><span className="text-[10px] text-muted">Friend: <Hours minutes={game.friend_playtime || 0} /></span></div>)}
                  {comparison.shared.length === 0 && <p className="px-4 py-8 text-xs text-muted">No shared games found.</p>}
                </div>
              </section>
              <section className="bg-surface rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border"><h2 className="text-sm font-semibold">Games They Own That You Don’t</h2></div>
                <div className="max-h-[34rem] overflow-y-auto divide-y divide-border/70">
                  {comparison.friend_only.map((game) => <div key={game.appid} className="flex items-center gap-3 px-4 py-2.5"><a href={`https://store.steampowered.com/app/${game.appid}`} target="_blank" rel="noreferrer" className="flex-1 text-xs hover:text-accent">{game.name}</a><span className="text-[10px] text-muted"><Hours minutes={game.playtime_forever || 0} /></span></div>)}
                  {comparison.friend_only.length === 0 && <p className="px-4 py-8 text-xs text-muted">No additional games found.</p>}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
