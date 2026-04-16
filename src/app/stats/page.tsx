"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Stats {
  total: number; withAppid: number; withNotes: number; untagged: number;
  avgScore: number; avgMetacritic: number; totalScreenshots: number; totalMovies: number;
  scoreBuckets: { bucket: string; count: number }[];
  byTag: { name: string; color: string; count: number }[];
  bySubtag: { tag: string; subtag: string; color: string; count: number }[];
  topGenres: { name: string; count: number }[];
  topCommunityTags: { name: string; count: number }[];
  topDevelopers: { name: string; count: number }[];
  releaseYears: { year: string; count: number }[];
  addedByMonth: { month: string; count: number }[];
  sentiments: { sentiment: string; count: number }[];
}

function Bar({ value, max, color = "#6366f1" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return <div className="flex-1 h-4 bg-border/30 rounded overflow-hidden"><div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} /></div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <h2 className="text-sm font-semibold mb-3 text-muted">{title}</h2>
      {children}
    </div>
  );
}

const SENTIMENT_COLORS: Record<string, string> = {
  "Overwhelmingly Positive": "#22c55e", "Very Positive": "#4ade80", "Positive": "#86efac",
  "Mostly Positive": "#a3e635", "Mixed": "#f59e0b", "Mostly Negative": "#f97316",
  "Negative": "#ef4444", "Very Negative": "#dc2626", "Overwhelmingly Negative": "#991b1b",
};

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(setStats);
  }, []);

  if (!stats) return <div className="flex items-center justify-center h-screen text-muted">Loading stats...</div>;

  const maxTag = Math.max(...stats.byTag.map(t => t.count), 1);
  const maxGenre = Math.max(...stats.topGenres.map(g => g.count), 1);
  const maxCTag = Math.max(...stats.topCommunityTags.map(t => t.count), 1);
  const maxDev = Math.max(...stats.topDevelopers.map(d => d.count), 1);
  const maxYear = Math.max(...stats.releaseYears.map(y => y.count), 1);
  const maxMonth = Math.max(...stats.addedByMonth.map(m => m.count), 1);
  const maxScore = Math.max(...stats.scoreBuckets.map(b => b.count), 1);
  const maxSentiment = Math.max(...stats.sentiments.map(s => s.count), 1);
  const maxSubtag = Math.max(...stats.bySubtag.map(s => s.count), 1);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-semibold">📊 Library Stats</h1>
          <Link href="/" className="text-xs text-muted hover:text-foreground">← Back</Link>
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Games", value: stats.total, color: "#6366f1" },
            { label: "Steam Games", value: stats.withAppid, color: "#66c0f4" },
            { label: "With Notes", value: stats.withNotes, color: "#f59e0b" },
            { label: "Untagged", value: stats.untagged, color: "#ef4444" },
            { label: "Avg Score", value: `${stats.avgScore}%`, color: "#22c55e" },
            { label: "Avg Metacritic", value: stats.avgMetacritic || "—", color: "#f59e0b" },
            { label: "Screenshots", value: stats.totalScreenshots.toLocaleString(), color: "#8b5cf6" },
            { label: "Movies", value: stats.totalMovies.toLocaleString(), color: "#ec4899" },
          ].map((c, i) => (
            <div key={i} className="bg-surface rounded-lg p-3 border border-border text-center">
              <div className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</div>
              <div className="text-[10px] text-muted mt-1">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Tags */}
          <Section title="By Tag">
            <div className="space-y-1.5">
              {stats.byTag.map(t => (
                <div key={t.name} className="flex items-center gap-2 text-xs">
                  <span className="w-24 truncate" style={{ color: t.color }}>{t.name}</span>
                  <Bar value={t.count} max={maxTag} color={t.color} />
                  <span className="w-8 text-right text-muted">{t.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Top Subtags */}
          <Section title="Top Subtags">
            <div className="space-y-1.5">
              {stats.bySubtag.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate text-muted"><span style={{ color: s.color }}>{s.tag}</span> › {s.subtag}</span>
                  <Bar value={s.count} max={maxSubtag} color={s.color} />
                  <span className="w-8 text-right text-muted">{s.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Score Distribution */}
          <Section title="Score Distribution">
            <div className="space-y-1.5">
              {stats.scoreBuckets.map(b => (
                <div key={b.bucket} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted">{b.bucket}</span>
                  <Bar value={b.count} max={maxScore} color={b.bucket === "No reviews" ? "#666" : b.bucket >= "70" ? "#22c55e" : b.bucket >= "50" ? "#f59e0b" : "#ef4444"} />
                  <span className="w-8 text-right text-muted">{b.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Sentiment */}
          <Section title="Review Sentiment">
            <div className="space-y-1.5">
              {stats.sentiments.map(s => (
                <div key={s.sentiment} className="flex items-center gap-2 text-xs">
                  <span className="w-36 truncate" style={{ color: SENTIMENT_COLORS[s.sentiment] || "#999" }}>{s.sentiment}</span>
                  <Bar value={s.count} max={maxSentiment} color={SENTIMENT_COLORS[s.sentiment] || "#666"} />
                  <span className="w-8 text-right text-muted">{s.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Top Genres */}
          <Section title="Top Genres">
            <div className="space-y-1.5">
              {stats.topGenres.map(g => (
                <div key={g.name} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-muted">{g.name}</span>
                  <Bar value={g.count} max={maxGenre} color="#6366f1" />
                  <span className="w-8 text-right text-muted">{g.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Top Community Tags */}
          <Section title="Top Community Tags">
            <div className="space-y-1.5">
              {stats.topCommunityTags.map(t => (
                <div key={t.name} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-muted">{t.name}</span>
                  <Bar value={t.count} max={maxCTag} color="#8b5cf6" />
                  <span className="w-8 text-right text-muted">{t.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Top Developers */}
          <Section title="Top Developers">
            <div className="space-y-1.5">
              {stats.topDevelopers.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="w-36 truncate text-muted">{d.name}</span>
                  <Bar value={d.count} max={maxDev} color="#ec4899" />
                  <span className="w-8 text-right text-muted">{d.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Release Years */}
          <Section title="By Release Year">
            <div className="space-y-1.5">
              {stats.releaseYears.map(y => (
                <div key={y.year} className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted">{y.year}</span>
                  <Bar value={y.count} max={maxYear} color={y.year === "TBA" ? "#f59e0b" : y.year === "Unknown" ? "#666" : "#22c55e"} />
                  <span className="w-8 text-right text-muted">{y.count}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Added Over Time */}
          <Section title="Added Over Time (by month)">
            <div className="space-y-1">
              {stats.addedByMonth.map(m => (
                <div key={m.month} className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted">{m.month}</span>
                  <Bar value={m.count} max={maxMonth} color="#6366f1" />
                  <span className="w-8 text-right text-muted">{m.count}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
