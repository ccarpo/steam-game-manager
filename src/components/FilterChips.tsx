"use client";

import { Tag, Subtag } from "@/lib/types";
import { Filters } from "@/lib/hooks";

interface Props {
  tags: Tag[];
  subtags: Subtag[];
  filters: Filters;
  onChange: (f: Filters) => void;
  onClearSearch?: () => void;
}

export default function FilterChips({ tags, subtags, filters, onChange, onClearSearch }: Props) {
  const chips: { label: string; color: string; type: "include" | "exclude"; onRemove: () => void }[] = [];

  for (const id of filters.includeTags || []) {
    const tag = tags.find((t) => t.id === id);
    if (tag) chips.push({
      label: tag.name, color: tag.color, type: "include",
      onRemove: () => onChange({ ...filters, includeTags: (filters.includeTags || []).filter((t) => t !== id) }),
    });
  }
  for (const id of filters.excludeTags || []) {
    const tag = tags.find((t) => t.id === id);
    if (tag) chips.push({
      label: tag.name, color: "#ef4444", type: "exclude",
      onRemove: () => onChange({ ...filters, excludeTags: (filters.excludeTags || []).filter((t) => t !== id) }),
    });
  }

  for (const id of filters.includeSubtags || []) {
    const sub = subtags.find((s) => s.id === id);
    if (sub) {
      const parent = tags.find((t) => t.id === sub.tag_id);
      chips.push({
        label: parent ? `${parent.name}>${sub.name}` : sub.name, color: sub.type === "genre" ? "#6366f1" : "#f59e0b", type: "include",
        onRemove: () => onChange({ ...filters, includeSubtags: (filters.includeSubtags || []).filter((t) => t !== id) }),
      });
    }
  }
  for (const id of filters.excludeSubtags || []) {
    const sub = subtags.find((s) => s.id === id);
    if (sub) {
      const parent = tags.find((t) => t.id === sub.tag_id);
      chips.push({
        label: parent ? `${parent.name}>${sub.name}` : sub.name, color: "#ef4444", type: "exclude",
        onRemove: () => onChange({ ...filters, excludeSubtags: (filters.excludeSubtags || []).filter((t) => t !== id) }),
      });
    }
  }

  const addStringChips = (items: string[] | undefined, type: "include" | "exclude", prefix: string, filterKey: keyof Filters) => {
    for (const val of items || []) {
      chips.push({
        label: `${prefix}: ${val}`, color: type === "include" ? "#6366f1" : "#ef4444", type,
        onRemove: () => onChange({ ...filters, [filterKey]: ((filters[filterKey] as string[]) || []).filter((v) => v !== val) }),
      });
    }
  };

  addStringChips(filters.includeGenres, "include", "Genre", "includeGenres");
  addStringChips(filters.excludeGenres, "exclude", "Genre", "excludeGenres");
  addStringChips(filters.includeFeatures, "include", "Feature", "includeFeatures");
  addStringChips(filters.excludeFeatures, "exclude", "Feature", "excludeFeatures");
  addStringChips(filters.includeCommunityTags, "include", "CTag", "includeCommunityTags");
  addStringChips(filters.excludeCommunityTags, "exclude", "CTag", "excludeCommunityTags");
  addStringChips(filters.includeDevelopers, "include", "Dev", "includeDevelopers");
  addStringChips(filters.excludeDevelopers, "exclude", "Dev", "excludeDevelopers");
  addStringChips(filters.includePublishers, "include", "Pub", "includePublishers");
  addStringChips(filters.excludePublishers, "exclude", "Pub", "excludePublishers");

  if (filters.untagged) {
    chips.push({ label: "Untagged only", color: "#f59e0b", type: "include",
      onRemove: () => onChange({ ...filters, untagged: false }) });
  }
  if (filters.withNotes) {
    chips.push({ label: "With notes", color: "#6366f1", type: "include",
      onRemove: () => onChange({ ...filters, withNotes: false }) });
  }
  if (filters.metadataMissing) {
    chips.push({ label: "Metadata missing", color: "#eab308", type: "include",
      onRemove: () => onChange({ ...filters, metadataMissing: false }) });
  }
  if (filters.hideWishlistOnly) {
    chips.push({ label: "Curated only", color: "#6366f1", type: "include",
      onRemove: () => onChange({ ...filters, hideWishlistOnly: false }) });
  }
  if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
    chips.push({ label: `Score: ${filters.scoreMin ?? 0}–${filters.scoreMax ?? 100}%`, color: "#22c55e", type: "include",
      onRemove: () => onChange({ ...filters, scoreMin: undefined, scoreMax: undefined }) });
  }
  if (filters.reviewsMin !== undefined || filters.reviewsMax !== undefined) {
    chips.push({ label: `Reviews: ${filters.reviewsMin ?? 0}–${filters.reviewsMax ?? "∞"}`, color: "#8b5cf6", type: "include",
      onRemove: () => onChange({ ...filters, reviewsMin: undefined, reviewsMax: undefined }) });
  }

  if (chips.length === 0) return null;

  return (
    <div className="px-4 py-1.5 border-b border-border flex flex-wrap gap-1 items-center shrink-0">
      <span className="text-[10px] text-muted mr-1">Active:</span>
      {chips.map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
          style={{
            backgroundColor: chip.color + "18", border: `1px solid ${chip.color}40`, color: chip.color,
            textDecoration: chip.type === "exclude" ? "line-through" : undefined,
          }}>
          {chip.type === "exclude" && "−"}{chip.label}
          <button onClick={chip.onRemove} className="hover:opacity-70 ml-0.5 font-bold" style={{ color: chip.color }}>×</button>
        </span>
      ))}
      <button onClick={() => {
        let def: Partial<Filters> = {};
        try { const raw = localStorage.getItem("gm_default_filters"); if (raw) def = JSON.parse(raw); } catch {}
        onChange({
          ...filters, includeTags: [], excludeTags: def.excludeTags || [], includeSubtags: [], excludeSubtags: def.excludeSubtags || [],
          includeGenres: [], excludeGenres: def.excludeGenres || [],
          includeFeatures: [], excludeFeatures: def.excludeFeatures || [], includeCommunityTags: [], excludeCommunityTags: def.excludeCommunityTags || [],
          includeDevelopers: [], excludeDevelopers: def.excludeDevelopers || [], includePublishers: [], excludePublishers: def.excludePublishers || [],
          untagged: false, withNotes: false, metadataMissing: false, hideWishlistOnly: def.hideWishlistOnly || false, scoreMin: undefined, scoreMax: undefined, reviewsMin: undefined, reviewsMax: undefined, search: undefined,
        }); onClearSearch?.();
      }} className="text-[10px] text-danger hover:underline ml-1">Clear all</button>
      <button onClick={() => {
        const { search, sort, sorts, dir, ...rest } = filters;
        localStorage.setItem("gm_default_filters", JSON.stringify(rest));
      }} className="text-[10px] text-muted hover:text-foreground hover:underline ml-1" title="Save current excludes as default for Clear All">Set default</button>
    </div>
  );
}
