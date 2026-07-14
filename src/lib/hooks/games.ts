"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { GameWithTags } from "../types";
import { loadJson, saveJson } from "../utils";
import { Filters, filterGames, sortGames, searchScore, seededShuffle } from "./filtering";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

export function useGames() {
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  const [playNextScores, setPlayNextScores] = useState<Map<number, { score: number; reasons: string[] }>>(new Map());
  const [filters, setFiltersRaw] = useState<Filters>(() => {
    const saved = loadJson<Filters>("gm_filters", {});
    if (saved.hideWishlistOnly === undefined) saved.hideWishlistOnly = true;
    return saved;
  });

  const setFilters = useCallback((f: Filters | ((prev: Filters) => Filters)) => {
    setFiltersRaw((prev) => {
      const next = typeof f === "function" ? f(prev) : f;
      setShuffleSeed(null);
      const { search, ...persistable } = next;
      saveJson("gm_filters", persistable);
      return next;
    });
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const data = await fetcher<GameWithTags[]>("/api/games/all");
    setAllGames(data);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onFocus = () => refresh(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const games = useMemo(() => {
    const filtered = filterGames(allGames, filters);
    if (shuffleSeed !== null) return seededShuffle(filtered, shuffleSeed);
    if (filters.sort === "recommendation" && playNextScores.size > 0) {
      return [...filtered].sort((a, b) => {
        const sa = playNextScores.get(a.id)?.score || 0;
        const sb = playNextScores.get(b.id)?.score || 0;
        const d = filters.dir === "asc" ? 1 : -1;
        if (sa !== sb) return d * (sb - sa);
        return a.name.localeCompare(b.name);
      });
    }
    if (filters.search) {
      const scored = filtered.map((g) => ({ g, s: searchScore(g, filters.search!) }));
      scored.sort((a, b) => {
        if (a.s !== b.s) return a.s - b.s;
        const sorted = sortGames([a.g, b.g], filters.sort, filters.dir);
        return sorted[0] === a.g ? -1 : 1;
      });
      return scored.map((x) => x.g);
    }
    return sortGames(filtered, filters.sort, filters.dir, filters.sorts);
  }, [allGames, filters, shuffleSeed, playNextScores]);

  const totalCount = allGames.length;

  const shuffle = useCallback(() => setShuffleSeed(Date.now()), []);
  const clearShuffle = useCallback(() => setShuffleSeed(null), []);

  const recalcPlayNext = useCallback(async () => {
    try {
      const res = await fetch("/api/play-next");
      if (!res.ok) { console.error("play-next API error:", res.status); return; }
      const data = await res.json();
      const map = new Map<number, { score: number; reasons: string[] }>();
      for (const g of (data.games || [])) map.set(g.id, { score: g.total, reasons: g.reasons || [] });
      setPlayNextScores(map);
    } catch (e) { console.error("play-next fetch error:", e); }
  }, []);

  const addGame = async (game: { name: string; tag_id?: number; subtag_id?: number | null; steam_appid?: number; notes?: string }) => {
    const res = await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(game) });
    if (!res.ok) throw new Error("Failed to add game");
    const data = await res.json();
    await refresh();
    return data as { added: number; games: { id: number; name: string }[] };
  };

  const updateGame = async (id: number, data: Record<string, unknown>) => {
    const res = await fetch(`/api/games/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Save failed (${res.status})`);
    }
    await refresh(true);
  };

  const deleteGame = async (id: number) => {
    await fetch(`/api/games/${id}`, { method: "DELETE" });
    await refresh(true);
  };

  const allAppIds = useMemo(() => new Set(allGames.filter(g => g.steam_appid).map(g => g.steam_appid)), [allGames]);

  return { games, allGames, totalCount, loading, filters, setFilters, refresh, addGame, updateGame, deleteGame, allAppIds, shuffleSeed, shuffle, clearShuffle, playNextScores, recalcPlayNext };
}
