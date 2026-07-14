"use client";

import { useState, useEffect, useCallback } from "react";
import { Tag, Subtag } from "../types";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  return res.json();
}

export interface GenreInfo { name: string; count: number; }
export interface SteamTagData { genres: GenreInfo[]; features: GenreInfo[]; communityTags: GenreInfo[]; }

// --- Tags ---
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setTags(await fetcher<Tag[]>("/api/tags"));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const addTag = async (name: string, color?: string) => {
    const res = await fetch("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, color }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    await refresh();
  };
  const deleteTag = async (id: number) => { await fetch(`/api/tags/${id}`, { method: "DELETE" }); await refresh(); };
  const updateTag = async (id: number, data: Partial<Tag>) => {
    await fetch(`/api/tags/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    await refresh();
  };

  return { tags, loading, refresh, addTag, deleteTag, updateTag };
}

// --- Subtags ---
export function useSubtags(tagId?: number) {
  const [subtags, setSubtags] = useState<Subtag[]>([]);

  const refresh = useCallback(async () => {
    const url = tagId ? `/api/subtags?tag_id=${tagId}` : "/api/subtags";
    setSubtags(await fetcher<Subtag[]>(url));
  }, [tagId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addSubtag = async (tag_id: number, name: string, type: "genre" | "meta" = "genre") => {
    const res = await fetch("/api/subtags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag_id, name, type }) });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    await refresh();
  };
  const deleteSubtag = async (id: number) => { await fetch(`/api/subtags/${id}`, { method: "DELETE" }); await refresh(); };

  return { subtags, refresh, addSubtag, deleteSubtag };
}

// --- Genres ---
export function useGenres() {
  const [data, setData] = useState<SteamTagData>({ genres: [], features: [], communityTags: [] });
  const refresh = useCallback(async () => { setData(await fetcher<SteamTagData>("/api/genres")); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...data, refresh };
}
