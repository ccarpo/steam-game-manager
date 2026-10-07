"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Release {
  key: string;
  appid: number | null;
  name: string;
  source: "owned" | "wishlist" | "unowned";
  releaseIso: string;
  releaseDate: string;
  owned: boolean;
  wishlisted: boolean;
  tags: string[];
  genres: string[];
  positivePercent: number;
  totalReviews: number;
  headerUrl: string;
}

const fmtMonth = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const SOURCE_STYLE: Record<Release["source"], { emoji: string; color: string }> = {
  owned: { emoji: "🎮", color: "#66c0f4" },
  wishlist: { emoji: "⭐", color: "#f59e0b" },
  unowned: { emoji: "🔭", color: "#a78bfa" },
};

export default function ReleasesPage() {
  const [owned, setOwned] = useState(true);
  const [wishlist, setWishlist] = useState(true);
  const [unowned, setUnowned] = useState(false);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const sp = new URLSearchParams({
        owned: owned ? "1" : "0",
        wishlist: wishlist ? "1" : "0",
        unowned: unowned ? "1" : "0",
        limit: "500",
      });
      try {
        const r = await fetch(`/api/releases?${sp}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `Request failed (${r.status})`);
        if (!cancelled) setReleases(d.releases || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [owned, wishlist, unowned]);

  const grouped = useMemo(() => {
    if (!releases) return [];
    const map = new Map<string, Release[]>();
    for (const r of releases) {
      const key = fmtMonth(r.releaseIso);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()];
  }, [releases]);

  const sources = [
    { label: "Owned", key: "owned", on: owned, set: setOwned },
    { label: "Wishlist", key: "wishlist", on: wishlist, set: setWishlist },
    { label: "Unowned catalog", key: "unowned", on: unowned, set: setUnowned },
  ];

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0 p-4 gap-3">
        <div className="flex items-center gap-4 shrink-0">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">📅 Release Calendar</h1>
          <span className="text-[11px] text-muted">upcoming releases from your library + catalog</span>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {sources.map((s) => (
            <button key={s.key} onClick={() => s.set(!s.on)}
              className={`px-3 py-1.5 rounded text-xs border ${s.on ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted"}`}>
              {s.on ? "☑" : "☐"} {s.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-xs text-danger shrink-0">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-6">
          {loading && <div className="text-muted text-sm py-8">Loading upcoming releases…</div>}
          {!loading && grouped.length === 0 && (
            <div className="text-muted text-sm py-8">No upcoming releases found for the selected sources.</div>
          )}

          {grouped.map(([month, rows]) => (
            <section key={month}>
              <h2 className="text-sm font-semibold text-muted sticky top-0 bg-background/95 backdrop-blur py-1 mb-2 border-b border-border">
                {month}
              </h2>
              <div className="space-y-2">
                {rows.map((r) => {
                  const style = SOURCE_STYLE[r.source];
                  return (
                    <div key={r.key} className="flex items-center gap-3 bg-surface border border-border rounded-lg p-2 hover:border-accent/40 transition-colors">
                      <img src={r.headerUrl} alt="" className="h-12 rounded object-cover shrink-0 w-24 bg-border/20"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate" title={r.name}>{r.name}</span>
                          {r.appid && (
                            <a href={`https://store.steampowered.com/app/${r.appid}`} target="_blank" rel="noreferrer"
                              className="text-[10px] text-accent hover:underline">steam ↗</a>
                          )}
                        </div>
                        <div className="text-[10px] text-muted truncate flex gap-2 mt-0.5">
                          <span style={{ color: style.color }}>{style.emoji} {r.source}</span>
                          <span>{new Date(r.releaseIso + "T00:00:00").toLocaleDateString("en-GB")}</span>
                          {r.releaseDate !== r.releaseIso && <span className="italic">({r.releaseDate})</span>}
                          {r.totalReviews > 0 && <span>★ {r.positivePercent}% of {r.totalReviews.toLocaleString()}</span>}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {[...r.tags, ...r.genres.filter((g) => !r.tags.includes(g))].slice(0, 6).map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-border/40 text-muted">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
