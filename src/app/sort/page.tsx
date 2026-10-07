"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

interface DeckCard {
  key: string;
  gameId: number | null;
  appid: number | null;
  name: string;
  owned: boolean;
  wishlisted: boolean;
  tags: string[];
  genres: string[];
  positivePercent: number;
  totalReviews: number;
  playtimeHours: number | null;
  hltbMain: number | null;
  fit: number;
  description: string;
  releaseDate: string;
  developers: string[];
  headerUrl: string;
  movie?: { name: string; videoUrl: string; thumbnailUrl: string };
}

interface Bucket {
  label: string;
  hotkey: string;
  tag: string;
  subtag: string;
  wishlist: boolean;
  color: string;
}

interface Config {
  owned: boolean;
  wishlist: boolean;
  unowned: boolean;
  similarTo: string; // "g:<id>" or ""
  seedName: string;
  randomness: number; // 0-1
  limit: number;
  buckets: Bucket[];
}

interface DecisionRecord {
  card: DeckCard;
  skipped: boolean;
  bucketLabel?: string;
  undo?: {
    gameId: number; tagId: number; subtagId: number; inserted: boolean;
    extraTag?: { tagId: number; subtagId: number } | null;
  };
}

const DEFAULT_BUCKETS: Bucket[] = [
  { label: "❤️ Loved", hotkey: "1", tag: "deck", subtag: "loved", wishlist: true, color: "#f472b6" },
  { label: "👍 Liked", hotkey: "2", tag: "deck", subtag: "liked", wishlist: true, color: "#4ade80" },
  { label: "🕐 Later", hotkey: "3", tag: "deck", subtag: "later", wishlist: true, color: "#38bdf8" },
  { label: "👎 Not for me", hotkey: "4", tag: "deck", subtag: "not_for_me", wishlist: false, color: "#f87171" },
];

const fmtHours = (h: number | null) => (h == null ? "" : h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`);

export default function SortPage() {
  const [phase, setPhase] = useState<"setup" | "loading" | "play" | "done">("setup");
  const [config, setConfig] = useState<Config>({
    owned: true, wishlist: false, unowned: false,
    similarTo: "", seedName: "", randomness: 0.5, limit: 50,
    buckets: DEFAULT_BUCKETS,
  });
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [pos, setPos] = useState(0);
  const [history, setHistory] = useState<DecisionRecord[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(0);

  const card = deck[pos] || null;
  const done = deck.length > 0 && pos >= deck.length;

  // ---------------------------------------------------------------------------
  // Deck fetching
  // ---------------------------------------------------------------------------
  const start = useCallback(async (cfg: Config) => {
    setPhase("loading");
    setError(null);
    const sp = new URLSearchParams({
      owned: cfg.owned ? "1" : "0",
      wishlist: cfg.wishlist ? "1" : "0",
      unowned: cfg.unowned ? "1" : "0",
      randomness: String(cfg.randomness),
      limit: String(cfg.limit),
    });
    if (cfg.similarTo) sp.set("similarTo", cfg.similarTo);
    try {
      const r = await fetch(`/api/sortdeck?${sp}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `Deck request failed (${r.status})`);
      if (!d.cards?.length) throw new Error("Deck is empty — enable at least one source (or build the catalog for unowned).");
      setDeck(d.cards);
      setPos(0);
      setHistory([]);
      setInfoOpen(false);
      setPhase("play");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("setup");
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------
  const decide = useCallback(async (bucket: Bucket | null) => {
    if (!card) return;
    const rec: DecisionRecord = { card, skipped: !bucket, bucketLabel: bucket?.label };
    setPos((p) => p + 1);
    setHistory((h) => [...h, rec]);
    setInfoOpen(false);
    if (!bucket) return; // skip: nothing to write

    pendingRef.current++;
    try {
      const r = await fetch("/api/sortdeck/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          card,
          bucket: { tag: bucket.tag, subtag: bucket.subtag, wishlist: bucket.wishlist && !card.owned },
        }),
      });
      const d = await r.json();
      if (r.ok && d.gameId) {
        rec.undo = {
          gameId: d.gameId, tagId: d.tagId, subtagId: d.subtagId,
          inserted: !!d.inserted, extraTag: d.wishlistTag || null,
        };
      } else {
        setError(d?.error || "Decision failed to save");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pendingRef.current--;
    }
  }, [card]);

  const undo = useCallback(async () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setPos((p) => Math.max(0, p - 1));
      if (last.undo) {
        fetch("/api/sortdeck/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(last.undo),
        }).catch(() => setError("Undo failed"));
      }
      return h.slice(0, -1);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "play") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "i") { setInfoOpen((o) => !o); return; }
      if (k === "s" || e.key === "ArrowDown") { e.preventDefault(); decide(null); return; }
      if (k === "z" || k === "u") { undo(); return; }
      if (e.key === "Escape") { setPhase("setup"); return; }
      const bucket = config.buckets.find((b) => b.hotkey.toLowerCase() === k);
      if (bucket) decide(bucket);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, config.buckets, decide, undo]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <div className="max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0 p-4 gap-3">
        <div className="flex items-center gap-4 shrink-0">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">🃏 Sort Deck</h1>
          <span className="text-[11px] text-muted">ludocene-style library triage</span>
          <div className="flex-1" />
          {phase === "play" && (
            <>
              <button onClick={undo} disabled={history.length === 0}
                className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground disabled:opacity-40"
                title="Undo last decision (Z)">↩ Undo</button>
              <button onClick={() => setPhase("setup")}
                className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground">⚙ Setup</button>
            </>
          )}
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-xs text-danger shrink-0">
            {error} <button className="underline ml-2" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {phase === "setup" && <Setup config={config} onChange={setConfig} onStart={() => start(config)} />}
        {phase === "loading" && <div className="flex-1 flex items-center justify-center text-muted">Building deck…</div>}

        {phase === "play" && (
          <>
            {/* progress */}
            <div className="shrink-0 flex items-center gap-3">
              <div className="flex-1 h-2 bg-border/30 rounded overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${(pos / deck.length) * 100}%` }} />
              </div>
              <span className="text-[11px] text-muted shrink-0">
                {pos}/{deck.length} · {history.filter((h) => !h.skipped).length} sorted
              </span>
            </div>

            {done ? (
              <DoneScreen history={history} onRestart={() => setPhase("setup")} onMore={() => start(config)} />
            ) : !card ? null : (
              <div className="flex-1 min-h-0 flex gap-4 justify-center">
                {/* Card */}
                <div
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData("text/plain", card.key); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragOver(null)}
                  className="w-full max-w-xl bg-surface border border-border rounded-lg overflow-hidden flex flex-col cursor-grab active:cursor-grabbing shrink-0"
                >
                  <div className="relative shrink-0">
                    <img src={card.headerUrl} alt="" className="w-full h-48 object-cover bg-border/20"
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.15"; }} />
                    <div className="absolute top-2 left-2 flex gap-1.5">
                      {card.owned && <Badge color="#66c0f4">owned</Badge>}
                      {card.wishlisted && <Badge color="#f59e0b">wishlist</Badge>}
                      {!card.owned && !card.wishlisted && <Badge color="#a78bfa">not owned</Badge>}
                    </div>
                    <div className="absolute top-2 right-2">
                      <Badge color="#22d3ee">{Math.round(card.fit * 100)} fit</Badge>
                    </div>
                  </div>

                  <div className="p-3 flex-1 min-h-0 overflow-y-auto">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h2 className="text-base font-semibold">{card.name}</h2>
                      {card.releaseDate && <span className="text-[10px] text-muted">{card.releaseDate}</span>}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 flex gap-3 flex-wrap">
                      {card.playtimeHours != null && card.playtimeHours > 0 && <span>▶ {fmtHours(card.playtimeHours)} played</span>}
                      {card.hltbMain != null && <span>⏳ ~{fmtHours(card.hltbMain)} to beat</span>}
                      {card.totalReviews > 0 && <span>★ {card.positivePercent}% of {card.totalReviews.toLocaleString()}</span>}
                      {card.developers.length > 0 && <span>🏗 {card.developers.slice(0, 2).join(", ")}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {[...card.tags, ...card.genres.filter((g) => !card.tags.includes(g))].slice(0, 8).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-border/40 text-muted">{t}</span>
                      ))}
                    </div>

                    <button onClick={() => setInfoOpen((o) => !o)}
                      className="mt-2 text-xs text-accent hover:underline">
                      {infoOpen ? "▾ less info" : "▸ more info (i)"}
                    </button>
                    {infoOpen && (
                      <div className="mt-2 text-xs text-muted space-y-2">
                        {card.description
                          ? <p className="leading-relaxed">{card.description.slice(0, 500)}{card.description.length > 500 ? "…" : ""}</p>
                          : <p className="italic">No description stored for this game.</p>}
                        {card.movie && (
                          <div>
                            <div className="text-[10px] text-muted mb-1">▶ {card.movie.name}</div>
                            <video
                              controls
                              playsInline
                              preload="metadata"
                              poster={card.movie.thumbnailUrl || undefined}
                              className="w-full rounded border border-border bg-black"
                              src={card.movie.videoUrl}
                            >
                              <a className="text-accent hover:underline" target="_blank" rel="noreferrer"
                                href={card.movie.videoUrl}>Open trailer ↗</a>
                            </video>
                          </div>
                        )}
                        {card.appid && (
                          <p><a className="text-accent hover:underline" target="_blank" rel="noreferrer"
                            href={`https://store.steampowered.com/app/${card.appid}`}>Steam store page ↗</a></p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Buckets */}
                <div className="w-48 shrink-0 flex flex-col gap-2">
                  {config.buckets.map((b) => (
                    <button
                      key={b.hotkey + b.subtag}
                      onClick={() => decide(b)}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(b.subtag); }}
                      onDragLeave={() => setDragOver((d) => (d === b.subtag ? null : d))}
                      onDrop={(e) => { e.preventDefault(); setDragOver(null); decide(b); }}
                      className={`flex-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        dragOver === b.subtag ? "border-accent bg-accent/15" : "border-border bg-surface hover:border-accent/60"
                      }`}
                    >
                      <span className="font-medium" style={{ color: b.color }}>{b.label}</span>
                      <span className="block text-[10px] text-muted mt-0.5">
                        [{b.hotkey}] → {b.tag}›{b.subtag}{b.wishlist ? " · +wishlist" : ""}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => decide(null)}
                    onDragOver={(e) => { e.preventDefault(); setDragOver("__skip"); }}
                    onDragLeave={() => setDragOver((d) => (d === "__skip" ? null : d))}
                    onDrop={(e) => { e.preventDefault(); setDragOver(null); decide(null); }}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      dragOver === "__skip" ? "border-accent bg-accent/15" : "border-dashed border-border text-muted hover:text-foreground"
                    }`}
                  >
                    ⏭ Skip <span className="text-[10px] text-muted">[S / ↓]</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ backgroundColor: color + "26", color }}>{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------------------

function Setup({ config, onChange, onStart }: {
  config: Config;
  onChange: (c: Config) => void;
  onStart: () => void;
}) {
  const [seedQuery, setSeedQuery] = useState("");
  const [seedResults, setSeedResults] = useState<{ id: number; name: string }[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchSeed = (q: string) => {
    setSeedQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setSeedResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/games?search=${encodeURIComponent(q)}`);
        const d = await r.json();
        const games = (d.games || d || []) as { id: number; name: string }[];
        setSeedResults(games.slice(0, 8).map((g) => ({ id: g.id, name: g.name })));
      } catch { setSeedResults([]); }
    }, 250);
  };

  const set = (patch: Partial<Config>) => onChange({ ...config, ...patch });
  const setBucket = (i: number, patch: Partial<Bucket>) => {
    const buckets = config.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b));
    set({ buckets });
  };

  const noSource = !config.owned && !config.wishlist && !config.unowned && !config.similarTo;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
      {/* Sources */}
      <section className="bg-surface rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-muted mb-3">Deck sources</h2>
        <div className="flex flex-wrap gap-4">
          <Toggle label="Owned games" checked={config.owned} onChange={(v) => set({ owned: v })} />
          <Toggle label="Wishlist" checked={config.wishlist} onChange={(v) => set({ wishlist: v })} />
          <Toggle label="Not owned (catalog)" checked={config.unowned} onChange={(v) => set({ unowned: v })} />
        </div>

        <div className="mt-4">
          <label className="text-xs text-muted">Similar to a game (vector neighbours, optional)</label>
          <div className="relative mt-1 max-w-md">
            {config.similarTo ? (
              <div className="flex items-center gap-2 text-sm bg-border/20 rounded px-2 py-1.5">
                <span className="flex-1 truncate">🎯 {config.seedName || config.similarTo}</span>
                <button className="text-muted hover:text-foreground text-xs" onClick={() => set({ similarTo: "", seedName: "" })}>✕</button>
              </div>
            ) : (
              <>
                <input value={seedQuery} onChange={(e) => searchSeed(e.target.value)}
                  placeholder="type a game name…"
                  className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent" />
                {seedResults.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-surface border border-border rounded shadow-lg overflow-hidden">
                    {seedResults.map((g) => (
                      <button key={g.id}
                        onClick={() => { set({ similarTo: `g:${g.id}`, seedName: g.name }); setSeedQuery(""); setSeedResults([]); }}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent/10 truncate">{g.name}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-6 items-center">
          <div>
            <label className="text-xs text-muted">Randomness — {Math.round(config.randomness * 100)}%</label>
            <input type="range" min={0} max={100} value={Math.round(config.randomness * 100)}
              onChange={(e) => set({ randomness: Number(e.target.value) / 100 })}
              className="block w-48 mt-1 accent-accent" />
            <div className="text-[10px] text-muted/70 mt-0.5">0 = best fit first · 100 = full shuffle</div>
          </div>
          <div>
            <label className="text-xs text-muted">Deck size</label>
            <select value={config.limit} onChange={(e) => set({ limit: Number(e.target.value) })}
              className="block mt-1 bg-background border border-border rounded px-2 py-1.5 text-sm">
              {[25, 50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Buckets */}
      <section className="bg-surface rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-muted mb-1">Buckets</h2>
        <p className="text-[10px] text-muted/70 mb-3">
          Each bucket writes <code>tag›subtag</code> onto the game. For unowned cards, buckets marked
          “wishlist” also add the game to your local wishlist. Keys 1-9 assign, S/↓ skips, Z undoes, I shows info.
        </p>
        <div className="space-y-2">
          {config.buckets.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
              <input value={b.hotkey} maxLength={1}
                onChange={(e) => setBucket(i, { hotkey: e.target.value })}
                className="w-8 text-center bg-background border border-border rounded px-1 py-1" />
              <input value={b.label} onChange={(e) => setBucket(i, { label: e.target.value })}
                className="w-36 bg-background border border-border rounded px-2 py-1" placeholder="Label" />
              <span className="text-muted">→</span>
              <input value={b.tag} onChange={(e) => setBucket(i, { tag: e.target.value })}
                className="w-20 bg-background border border-border rounded px-2 py-1" placeholder="tag" />
              <span className="text-muted">›</span>
              <input value={b.subtag} onChange={(e) => setBucket(i, { subtag: e.target.value })}
                className="w-28 bg-background border border-border rounded px-2 py-1" placeholder="subtag" />
              <label className="flex items-center gap-1 text-muted cursor-pointer">
                <input type="checkbox" checked={b.wishlist} onChange={(e) => setBucket(i, { wishlist: e.target.checked })} />
                +wishlist
              </label>
              <button className="text-muted hover:text-danger ml-auto" onClick={() => set({ buckets: config.buckets.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button
            onClick={() => set({ buckets: [...config.buckets, { label: "New bucket", hotkey: String(config.buckets.length + 1), tag: "deck", subtag: "bucket" + (config.buckets.length + 1), wishlist: false, color: "#a78bfa" }] })}
            className="text-xs text-accent hover:underline">+ add bucket</button>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={onStart} disabled={noSource || config.buckets.length === 0}
          className="px-6 py-2.5 rounded-lg text-sm bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed font-medium">
          ▶ Deal the deck
        </button>
        {noSource && <span className="text-xs text-danger">Enable at least one source or pick a similar-to seed.</span>}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`px-3 py-1.5 rounded text-xs border ${checked ? "border-accent bg-accent/10 text-foreground" : "border-border text-muted"}`}>
      {checked ? "☑" : "☐"} {label}
    </button>
  );
}

function DoneScreen({ history, onRestart, onMore }: {
  history: DecisionRecord[];
  onRestart: () => void;
  onMore: () => void;
}) {
  const sorted = history.filter((h) => !h.skipped);
  const byBucket = new Map<string, number>();
  for (const h of sorted) byBucket.set(h.bucketLabel || "?", (byBucket.get(h.bucketLabel || "?") || 0) + 1);
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 text-center max-w-sm w-full">
        <div className="text-3xl mb-2">🎉</div>
        <h2 className="text-lg font-semibold mb-1">Deck cleared</h2>
        <p className="text-xs text-muted mb-4">{sorted.length} sorted · {history.length - sorted.length} skipped</p>
        <div className="space-y-1 mb-4">
          {[...byBucket.entries()].map(([label, n]) => (
            <div key={label} className="flex justify-between text-xs">
              <span>{label}</span><span className="text-muted">{n}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-center">
          <button onClick={onMore} className="px-4 py-2 rounded text-xs bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30">
            ▶ Deal another deck
          </button>
          <button onClick={onRestart} className="px-4 py-2 rounded text-xs border border-border text-muted hover:text-foreground">
            ⚙ Change setup
          </button>
        </div>
      </div>
    </div>
  );
}
