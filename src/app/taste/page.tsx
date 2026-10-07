"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface ExampleGame { appid: number; id: number | null; name: string }
interface TagAffinity { tag: string; weight: number; examples: ExampleGame[] }
interface Anchor { appid: number; id: number | null; name: string; weight: number }
interface Bounced { appid: number; id: number | null; name: string; playtimeHours: number; lastPlayed: number; kind: string }
interface AntiCluster { label: string; tags: string[]; strength: number; bounced: Bounced[] }

interface Profile {
  model: string;
  computedAt: number;
  signalCount: number;
  confidence: "low" | "medium" | "high";
  coverage: { totalOwned: number; withVectors: number; missingVectors: number; hasTasteVector: boolean };
  topTags: TagAffinity[];
  anchorGames: Anchor[];
  antiClusters: AntiCluster[];
}

interface ScoredGame {
  id: number; appid: number; name: string; score: number; sim: number; quality: number;
  reason: string; warning: string | null; tags: string[]; hltbMain: number | null;
  positivePercent: number; totalReviews: number;
}

type Tab = "wishlist" | "foryou";

const CONFIDENCE_STYLE: Record<string, { color: string; label: string }> = {
  low: { color: "#f59e0b", label: "Low confidence — play and classify more games to sharpen this" },
  medium: { color: "#38bdf8", label: "Medium confidence" },
  high: { color: "#22c55e", label: "High confidence" },
};

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      {subtitle && <p className="text-[10px] text-muted/70 mb-3 mt-0.5">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

function headerUrl(appid: number) {
  return `/api/assets/${appid}/header.jpg`;
}

function fmtDate(unix: number) {
  if (!unix) return "never";
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function TastePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wishlist, setWishlist] = useState<ScoredGame[] | null>(null);
  const [discover, setDiscover] = useState<ScoredGame[] | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("wishlist");
  const [wishlistMeta, setWishlistMeta] = useState<{ missingVectors: number; total: number } | null>(null);
  const [discoverMeta, setDiscoverMeta] = useState<{ total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // Starts with an await, so the first setState lands after the effect body —
  // no synchronous state updates during render.
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/taste/profile");
      if (!r.ok) throw new Error(`Profile request failed (${r.status})`);
      const p = await r.json();
      const [w, f] = await Promise.all([
        fetch("/api/discover?tab=wishlist&limit=40"),
        fetch("/api/discover?tab=foryou&limit=40"),
      ]);
      const wd = w.ok ? await w.json() : null;
      const fd = f.ok ? await f.json() : null;
      setProfile(p);
      setError(null);
      if (wd) {
        setWishlist(wd.games || []);
        setWishlistMeta({ missingVectors: wd.missingVectors || 0, total: wd.total || 0 });
      }
      if (fd) {
        setDiscover(fd.games || []);
        setDiscoverMeta({ total: fd.total || 0 });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const recompute = () => { setLoading(true); load(); };

  if (loading && !profile) return <div className="flex items-center justify-center h-screen text-muted">Computing taste profile...</div>;

  const conf = profile ? CONFIDENCE_STYLE[profile.confidence] : null;
  const needsEmbeddings = profile && !profile.coverage.hasTasteVector;

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="p-6 pb-16 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">🧭 Taste Profile</h1>
          <span className="text-[11px] text-muted">what your library says about you</span>
          <div className="flex-1" />
          <button onClick={recompute} disabled={loading}
            className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent disabled:opacity-50">
            {loading ? "Recomputing…" : "↻ Recompute"}
          </button>
          <Link href="/settings?tab=ai" className="text-xs text-muted hover:text-foreground">⚙️ AI settings</Link>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-xs text-danger">{error}</div>
        )}

        {profile && (
          <>
            {/* Confidence banner */}
            <div className="rounded-lg p-3 border flex flex-wrap items-center gap-3"
              style={{ backgroundColor: conf!.color + "12", borderColor: conf!.color + "40" }}>
              <span className="text-sm font-medium" style={{ color: conf!.color }}>{conf!.label}</span>
              <span className="text-[11px] text-muted">
                {profile.signalCount} games with meaningful signal · {profile.coverage.withVectors}/{profile.coverage.totalOwned} owned games embedded
                {profile.model ? ` · model ${profile.model}` : ""}
              </span>
            </div>

            {needsEmbeddings && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs">
                No embedding vectors yet, so similarity is unavailable — tag affinities and bounce detection still work.
                Configure a provider in <Link href="/settings?tab=ai" className="text-accent hover:underline">Settings › AI</Link>,
                then run <span className="font-mono">Sync embeddings</span>.
              </div>
            )}

            {/* Tag signature */}
            <Section title="Your tag signature"
              subtitle="Tags weighted by how much you actually played the games carrying them (bounced games excluded).">
              {profile.topTags.length === 0 ? (
                <p className="text-xs text-muted italic">Not enough playtime data yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.topTags.map((t) => (
                    <div key={t.tag} className="flex items-center gap-2">
                      <span className="text-xs w-40 shrink-0 truncate" title={t.tag}>{t.tag}</span>
                      <div className="flex-1 h-4 bg-border/30 rounded overflow-hidden">
                        <div className="h-full rounded bg-accent" style={{ width: `${t.weight * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-muted w-8 text-right">{Math.round(t.weight * 100)}</span>
                      <div className="flex gap-1 w-44 shrink-0">
                        {t.examples.map((ex) => (
                          <img key={ex.appid} src={headerUrl(ex.appid)} alt={ex.name} title={ex.name}
                            className="h-5 rounded object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Defining games */}
            <Section title="Defining games"
              subtitle="The heaviest contributors to your taste vector — playtime, completion, recency and current activity combined.">
              {profile.anchorGames.length === 0 ? (
                <p className="text-xs text-muted italic">No embedded games with playtime yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {profile.anchorGames.map((a) => (
                    <div key={a.appid} className="rounded overflow-hidden border border-border/50 bg-surface2/30">
                      <img src={headerUrl(a.appid)} alt={a.name} className="w-full aspect-[460/215] object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div className="p-1.5">
                        <div className="text-[11px] truncate" title={a.name}>{a.name}</div>
                        <div className="text-[9px] text-muted">weight {a.weight.toFixed(2)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Anti-clusters */}
            <Section title="Games you bounce off"
              subtitle="Clusters detected from games you started and dropped. These subtract from Discover scores and trigger warnings.">
              {profile.antiClusters.length === 0 ? (
                <p className="text-xs text-muted italic">No bounce pattern detected — either you finish what you start, or there isn&apos;t enough history yet.</p>
              ) : (
                <div className="space-y-3">
                  {profile.antiClusters.map((c) => (
                    <div key={c.label} className="rounded border border-danger/25 bg-danger/5 p-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-danger">{c.label}</span>
                        {c.tags.length > 1 && (
                          <span className="text-[9px] text-muted">({c.tags.slice(1).join(", ")})</span>
                        )}
                        <div className="flex-1" />
                        <span className="text-[10px] text-muted">strength</span>
                        <div className="w-20 h-2 bg-border/30 rounded overflow-hidden">
                          <div className="h-full bg-danger" style={{ width: `${c.strength * 100}%` }} />
                        </div>
                        <span className="text-[10px] text-danger w-8 text-right">{Math.round(c.strength * 100)}%</span>
                      </div>
                      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                        {c.bounced.map((b) => (
                          <div key={b.appid} className="flex items-center gap-1.5 text-[10px] text-muted">
                            <span className={b.kind === "abandoned" ? "text-orange-400" : "text-danger"}>
                              {b.kind === "abandoned" ? "◐" : "○"}
                            </span>
                            <span className="truncate flex-1" title={b.name}>{b.name}</span>
                            <span className="shrink-0">{b.playtimeHours.toFixed(1)}h</span>
                            <span className="shrink-0 text-muted/60">{fmtDate(b.lastPlayed)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Wishlist / Discover tabs */}
            <div className="bg-surface rounded-lg border border-border">
              <div className="flex items-center gap-3 p-3 border-b border-border/50">
                <button onClick={() => setActiveTab("wishlist")}
                  className={`text-sm font-medium px-2 py-1 rounded ${activeTab === "wishlist" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"}`}>
                  Wishlist
                </button>
                <button onClick={() => setActiveTab("foryou")}
                  className={`text-sm font-medium px-2 py-1 rounded ${activeTab === "foryou" ? "bg-accent/10 text-accent" : "text-muted hover:text-foreground"}`}>
                  Discover
                </button>
                <span className="text-[10px] text-muted flex-1">
                  {activeTab === "wishlist"
                    ? (wishlistMeta && wishlistMeta.missingVectors > 0
                        ? `${wishlistMeta.total} scored · ${wishlistMeta.missingVectors} wishlist games have no embedding yet`
                        : "Scored against your taste vector and review quality, minus anti-cluster penalties.")
                    : (discoverMeta ? `${discoverMeta.total.toLocaleString()} unowned catalog games` : "Build the catalog index first in Settings.")
                  }
                </span>
              </div>
              <div className="p-3">
                <GameList games={activeTab === "wishlist" ? (wishlist || []) : (discover || [])} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GameList({ games }: { games: ScoredGame[] }) {
  if (!games || games.length === 0) {
    return <p className="text-xs text-muted italic">Nothing scored yet — sync/run embeddings and import the catalog first.</p>;
  }
  return (
    <div className="space-y-1">
      {games.map((g, i) => (
        <div key={g.appid} className="flex items-center gap-2 py-1 border-b border-border/20 last:border-0">
          <span className="text-[10px] text-muted w-6 text-right shrink-0">{i + 1}</span>
          <img src={headerUrl(g.appid)} alt="" className="h-6 rounded object-cover shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div className="min-w-0 flex-1">
            <div className="text-xs truncate">{g.name}</div>
            <div className="text-[9px] text-muted truncate">
              {g.reason}
              {g.warning && <span className="text-danger"> · ⚠ {g.warning}</span>}
            </div>
          </div>
          {g.hltbMain != null && <span className="text-[10px] text-sky-300 shrink-0">~{g.hltbMain}h</span>}
          <span className="text-[10px] text-muted shrink-0 w-10 text-right" title={`similarity ${g.sim.toFixed(3)} · quality ${g.quality.toFixed(3)}`}>
            {Math.round(g.score * 100)}
          </span>
        </div>
      ))}
    </div>
  );
}
