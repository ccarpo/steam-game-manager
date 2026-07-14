"use client";

import { useState, useEffect } from "react";
import { Tag, Subtag } from "@/lib/types";
import { SteamPreview } from "@/components/Inspector";

export interface SteamResult {
  appid: number;
  name: string;
  image: string;
}

interface SteamResultsSectionProps {
  query: string;
  steamResults: SteamResult[];
  steamLoading: boolean;
  existingAppIds: Set<number | null>;
  adding: boolean;
  onAddSteam: (r: SteamResult, tagId?: number, subtagId?: number | null) => void;
  onAddManual: (tagId?: number, subtagId?: number | null) => void;
  tags: Tag[];
  onClickExisting?: (appid: number) => void;
}

export default function SteamResultsSection({ query, steamResults, steamLoading, existingAppIds, adding, onAddSteam, onAddManual, tags, onClickExisting }: SteamResultsSectionProps) {
  return (
    <div className="mt-6 space-y-3 max-w-4xl">
      <h2 className="text-xs uppercase tracking-wider text-muted flex items-center gap-2">
        Steam results
        {steamLoading && <span className="text-accent animate-pulse text-[10px]">searching...</span>}
      </h2>
      {steamResults.length > 0 ? (
        <div className="space-y-1">
          {steamResults.map((r) => (
            <SteamResultRow key={r.appid} result={r} tags={tags}
              alreadyExists={existingAppIds.has(r.appid)}
              adding={adding} onAdd={onAddSteam} onClickExisting={onClickExisting} />
          ))}
        </div>
      ) : !steamLoading && query.trim().length >= 2 && (
        <div className="text-sm text-muted py-4 text-center bg-surface rounded-lg border border-border/50">
          No Steam results for &quot;{query}&quot;
        </div>
      )}
      <ManualAddRow query={query} tags={tags} adding={adding} onAdd={onAddManual} />
    </div>
  );
}

function SteamResultRow({ result, tags, alreadyExists, adding, onAdd, onClickExisting }: {
  result: SteamResult; tags: Tag[]; alreadyExists: boolean; adding: boolean;
  onAdd: (r: SteamResult) => void;
  onClickExisting?: (appid: number) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);

  return (
    <>
      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent transition-colors cursor-pointer ${
        alreadyExists ? "opacity-60 hover:opacity-90 bg-surface/50 hover:bg-surface2/30" : "bg-surface hover:bg-surface2/50"
      }`} onClick={() => alreadyExists ? onClickExisting?.(result.appid) : setShowPreview(true)}>
        <img src={result.image} alt="" className="w-24 h-[28px] object-cover rounded"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <div className="flex-1 min-w-0">
          <span className="text-sm">{result.name}</span>
          <span className="text-[10px] text-muted ml-2">AppID: {result.appid}</span>
        </div>
        {alreadyExists ? (
          <span className="text-[10px] text-green-400">✓ in library</span>
        ) : (
          <>
            <button onClick={(e) => { e.stopPropagation(); onAdd(result); }}
              disabled={adding}
              className="text-[10px] px-2 py-0.5 rounded border border-accent/50 text-accent hover:bg-accent/10 disabled:opacity-50"
            >+ Add</button>
            <span className="text-[10px] text-muted cursor-pointer" onClick={(e) => { e.stopPropagation(); setShowPreview(true); }}>👁</span>
          </>
        )}
      </div>
      {showPreview && (
        <SteamPreview
          appid={result.appid} name={result.name} image={result.image}
          onClose={() => setShowPreview(false)}
          onAdd={() => { onAdd(result); setShowPreview(false); }}
          tags={tags} adding={adding}
        />
      )}
    </>
  );
}

function ManualAddRow({ query, tags, adding, onAdd }: {
  query: string; tags: Tag[]; adding: boolean;
  onAdd: (tagId?: number, subtagId?: number | null) => void;
}) {
  const [tagId, setTagId] = useState<number | "">("");
  const [subtags, setSubtags] = useState<Subtag[]>([]);
  const [subtagId, setSubtagId] = useState<number | "">("");

  useEffect(() => {
    if (!tagId) { setSubtags([]); setSubtagId(""); return; }
    fetch(`/api/subtags?tag_id=${tagId}`).then((r) => r.json()).then(setSubtags);
  }, [tagId]);

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onAdd(tagId || undefined, subtagId || null)} disabled={adding}
        className="text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50">
        <span className="text-accent mr-1">+</span> Add &quot;{query}&quot; manually
      </button>
      <select value={tagId} onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : "")}
        className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px]">
        <option value="">No tag</option>
        {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {subtags.length > 0 && (
        <select value={subtagId} onChange={(e) => setSubtagId(e.target.value ? Number(e.target.value) : "")}
          className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px]">
          <option value="">No subtag</option>
          {subtags.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
    </div>
  );
}
