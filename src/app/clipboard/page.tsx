"use client";

import { useState, useEffect, useRef } from "react";
import { GameWithTags } from "@/lib/types";
import { MatchResult, MatchConfig, DEFAULT_MATCH_CONFIG, findMatches } from "@/lib/clipboard-match";

const STATUS = {
  exact: { color: "#4ade80", bg: "#16a34a20", border: "#16a34a80", label: "EXACT" },
  partial: { color: "#fb923c", bg: "#ea580c20", border: "#ea580c80", label: "PARTIAL" },
  fuzzy: { color: "#60a5fa", bg: "#2563eb20", border: "#2563eb80", label: "FUZZY" },
  none: { color: "#f87171", bg: "#dc262620", border: "#dc262680", label: "NOT FOUND" },
};

/** Determine if a game is "in library" (has non-steam/auto tags) */
function isLibrary(game: GameWithTags, excludeTags: string[]): boolean {
  const excl = new Set(excludeTags.map(t => t.toLowerCase()));
  return (game.tags || []).some(t => !excl.has(t.tag_name.toLowerCase()));
}

/** Get key tag labels for display */
function getTagBadges(game: GameWithTags): { label: string; color: string; bg: string }[] {
  const badges: { label: string; color: string; bg: string }[] = [];
  const tags = game.tags || [];
  const steamSubs = tags.filter(t => t.tag_name === "steam").map(t => t.subtag_name).filter(Boolean);
  if (steamSubs.includes("wishlist")) badges.push({ label: "wishlist", color: "#60a5fa", bg: "rgba(96,165,250,0.15)" });
  if (steamSubs.includes("owned")) badges.push({ label: "owned", color: "#22c55e", bg: "rgba(34,197,94,0.15)" });
  if (steamSubs.includes("played_elsewhere")) badges.push({ label: "played", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" });
  if (steamSubs.includes("removed_from_wishlist")) badges.push({ label: "removed", color: "#f87171", bg: "rgba(248,113,113,0.15)" });
  if (steamSubs.includes("ignored")) badges.push({ label: "ignored", color: "#94a3b8", bg: "rgba(148,163,184,0.15)" });
  // Library tags (non-steam, non-auto)
  const libTags = tags.filter(t => t.tag_name !== "steam" && t.tag_name !== "auto");
  const seen = new Set<string>();
  for (const t of libTags) {
    const key = t.subtag_name ? `${t.tag_name}>${t.subtag_name}` : t.tag_name;
    if (!seen.has(key)) { seen.add(key); badges.push({ label: key, color: "#fbbf24", bg: "rgba(251,191,36,0.1)" }); }
  }
  return badges;
}

export default function ClipboardPage() {
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const [clipText, setClipText] = useState("");
  const [match, setMatch] = useState<MatchResult>({ type: "none", games: [] });
  const lastClipRef = useRef("");
  const configRef = useRef<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const excludeTagsRef = useRef<string[]>(["steam", "auto"]);

  useEffect(() => {
    fetch("/api/games/all").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setAllGames(data);
    });
    fetch("/api/settings").then((r) => r.json()).then((s: Record<string, string>) => {
      configRef.current = {
        partialLimit: parseInt(s.clip_partial_limit, 10) || DEFAULT_MATCH_CONFIG.partialLimit,
        fuzzyLimit: parseInt(s.clip_fuzzy_limit, 10) || DEFAULT_MATCH_CONFIG.fuzzyLimit,
        fuzzyThreshold: parseFloat(s.clip_fuzzy_threshold) || DEFAULT_MATCH_CONFIG.fuzzyThreshold,
      };
      try { excludeTagsRef.current = JSON.parse(s.clip_exclude_tags || '["steam","auto"]'); } catch {}
    });
  }, []);

  const processClip = (text: string) => {
    const t = text.trim();
    if (t && t !== lastClipRef.current && t.length >= 2 && t.length < 200) {
      lastClipRef.current = t;
      setClipText(t);
      setMatch(findMatches(t, allGames, configRef.current));
    }
  };

  useEffect(() => {
    if (allGames.length === 0) return;
    const onFocus = async () => {
      try { processClip(await navigator.clipboard.readText()); } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames]);

  useEffect(() => {
    if (allGames.length === 0) return;
    const interval = setInterval(async () => {
      if (document.hasFocus()) return;
      try {
        const res = await fetch("/api/clipboard");
        const data = await res.json();
        processClip(data.text || "");
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGames]);

  const st = STATUS[match.type];

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden select-none" style={{ minWidth: 300 }}>
      <div className="px-3 py-1.5 bg-surface border-b border-border flex items-center gap-2 shrink-0">
        <span className="text-xs">📋</span>
        <span className="text-[11px] text-foreground font-medium truncate flex-1">
          {clipText || "(waiting for clipboard...)"}
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}>
          {st.label}{match.games.length > 0 ? ` (${match.games.length})` : ""}
        </span>
        <span className="text-[9px] text-muted">{allGames.length} games</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {match.games.length === 0 && match.type === "none" && (
          <div className="text-center text-muted text-[10px] py-4 italic">No matches</div>
        )}
        {match.games.map((g) => {
          const inLib = isLibrary(g, excludeTagsRef.current);
          const badges = getTagBadges(g);
          return (
            <div key={g.id} className="rounded px-2 py-1" style={{ background: inLib ? "rgba(251,191,36,0.08)" : "transparent", borderLeft: inLib ? "2px solid rgba(251,191,36,0.5)" : "2px solid transparent" }}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-foreground truncate flex-1">{g.name}</span>
                {g.steam_appid && <span className="text-[8px] text-muted shrink-0">{g.steam_appid}</span>}
              </div>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {badges.slice(0, 8).map((b, i) => (
                    <span key={i} className="text-[8px] px-1 py-0 rounded" style={{ color: b.color, background: b.bg }}>{b.label}</span>
                  ))}
                  {badges.length > 8 && <span className="text-[8px] text-muted">+{badges.length - 8}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
