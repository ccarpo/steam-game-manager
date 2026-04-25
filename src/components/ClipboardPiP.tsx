"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { GameWithTags } from "@/lib/types";
import { MatchResult, MatchConfig, DEFAULT_MATCH_CONFIG, findMatches } from "@/lib/clipboard-match";

const COLORS = {
  exact: { bg: "#22c55e", label: "EXACT" },
  partial: { bg: "#f97316", label: "PARTIAL" },
  fuzzy: { bg: "#3b82f6", label: "FUZZY" },
  none: { bg: "#ef4444", label: "NOT FOUND" },
};

const TAG_COLORS: Record<string, string> = {
  wishlist: "#60a5fa", owned: "#22c55e", played_elsewhere: "#a78bfa",
  removed_from_wishlist: "#f87171", ignored: "#94a3b8",
};

function isLibrary(game: GameWithTags, excludeTags: Set<string>): boolean {
  return (game.tags || []).some(t => !excludeTags.has(t.tag_name.toLowerCase()));
}

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clipText: string,
  match: MatchResult,
  excludeTags: Set<string>,
) {
  const dpr = 2;
  ctx.canvas.width = width * dpr;
  ctx.canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const s = Math.max(width / 400, 0.5);
  const headerH = Math.round(22 * s);
  const pad = Math.round(6 * s);
  const nameSize = Math.round(9 * s);
  const tagSize = Math.round(7 * s);
  const lineH = Math.round(13 * s);
  const tagLineH = Math.round(10 * s);

  // Background
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.fillStyle = "#0f0f23";
  ctx.fillRect(0, 0, width, headerH);
  ctx.fillStyle = "#e2e8f0";
  ctx.font = `bold ${Math.round(10 * s)}px system-ui, sans-serif`;
  const color = COLORS[match.type];
  ctx.fillText(`📋 ${clipText}`, pad, headerH * 0.72);
  // Status badge on right
  const badgeText = `${color.label}${match.games.length > 0 ? ` (${match.games.length})` : ""}`;
  ctx.font = `bold ${Math.round(7.5 * s)}px system-ui, sans-serif`;
  const badgeW = ctx.measureText(badgeText).width + pad * 2;
  ctx.fillStyle = color.bg + "60";
  ctx.fillRect(width - badgeW - pad, Math.round(3 * s), badgeW, headerH - Math.round(6 * s));
  ctx.fillStyle = color.bg;
  ctx.fillText(badgeText, width - badgeW - pad + pad, headerH * 0.72);

  // Games list
  let y = headerH + Math.round(4 * s);
  ctx.font = `${nameSize}px system-ui, sans-serif`;

  if (match.games.length === 0) {
    ctx.fillStyle = "#64748b";
    ctx.font = `${Math.round(8 * s)}px system-ui, sans-serif`;
    ctx.fillText("No matches", pad, y + Math.round(10 * s));
    return;
  }

  for (const game of match.games.slice(0, 8)) {
    if (y + lineH > height - 2) break;
    const inLib = isLibrary(game, excludeTags);

    // Library highlight bar
    if (inLib) {
      ctx.fillStyle = "rgba(251,191,36,0.08)";
      ctx.fillRect(0, y - Math.round(1 * s), width, lineH + tagLineH + Math.round(3 * s));
      ctx.fillStyle = "#fbbf24";
      ctx.fillRect(0, y - Math.round(1 * s), Math.round(2 * s), lineH + tagLineH + Math.round(3 * s));
    }

    // Game name
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `${nameSize}px system-ui, sans-serif`;
    ctx.fillText(game.name, pad + Math.round(2 * s), y + nameSize, width - pad * 3);
    y += lineH;

    // Tag badges
    if (game.tags && game.tags.length > 0) {
      if (y + tagLineH > height - 2) break;
      let tx = pad + Math.round(4 * s);
      ctx.font = `${tagSize}px system-ui, sans-serif`;
      const steamSubs = game.tags.filter(t => t.tag_name === "steam").map(t => t.subtag_name).filter(Boolean);
      const libTags = game.tags.filter(t => t.tag_name !== "steam" && t.tag_name !== "auto");
      // Steam badges
      for (const sub of steamSubs) {
        if (tx > width - pad * 4) break;
        const c = TAG_COLORS[sub || ""] || "#94a3b8";
        ctx.fillStyle = c;
        const tw = ctx.measureText(sub || "").width;
        ctx.fillText(sub || "", tx, y + tagSize);
        tx += tw + Math.round(6 * s);
      }
      // Library tags
      const seen = new Set<string>();
      for (const t of libTags) {
        if (tx > width - pad * 4) break;
        const key = t.subtag_name ? `${t.tag_name}>${t.subtag_name}` : t.tag_name;
        if (seen.has(key)) continue;
        seen.add(key);
        ctx.fillStyle = "#fbbf24";
        const tw = ctx.measureText(key).width;
        ctx.fillText(key, tx, y + tagSize);
        tx += tw + Math.round(6 * s);
      }
      y += tagLineH;
    }
    y += Math.round(2 * s);
  }
}

interface ClipboardPiPProps {
  active: boolean;
}

export default function ClipboardPiP({ active }: ClipboardPiPProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipWindowRef = useRef<PictureInPictureWindow | null>(null);
  const lastClipRef = useRef("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchRef = useRef<MatchResult>({ type: "none", games: [] });
  const [allGames, setAllGames] = useState<GameWithTags[]>([]);
  const configRef = useRef<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const excludeTagsRef = useRef<Set<string>>(new Set(["steam", "auto"]));

  useEffect(() => {
    if (!active) return;
    fetch("/api/games/all")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAllGames(data); })
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: Record<string, string>) => {
        configRef.current = {
          partialLimit: parseInt(s.clip_partial_limit, 10) || DEFAULT_MATCH_CONFIG.partialLimit,
          fuzzyLimit: parseInt(s.clip_fuzzy_limit, 10) || DEFAULT_MATCH_CONFIG.fuzzyLimit,
          fuzzyThreshold: parseFloat(s.clip_fuzzy_threshold) || DEFAULT_MATCH_CONFIG.fuzzyThreshold,
        };
        try { excludeTagsRef.current = new Set(JSON.parse(s.clip_exclude_tags || '["steam","auto"]').map((t: string) => t.toLowerCase())); } catch {}
      })
      .catch(() => {});
  }, [active]);

  const doMatch = useCallback((text: string) => {
    matchRef.current = findMatches(text, allGames, configRef.current);
  }, [allGames]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pipW = pipWindowRef.current;
    const w = pipW ? pipW.width : 400;
    const h = pipW ? pipW.height : 225;
    drawCanvas(ctx, w, h, lastClipRef.current || "(waiting...)", matchRef.current, excludeTagsRef.current);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 450;
      canvasRef.current = canvas;
    }
    if (!videoRef.current) {
      const video = document.createElement("video");
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      const stream = canvasRef.current.captureStream(30);
      video.srcObject = stream;
      video.play().catch(() => {});
      videoRef.current = video;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      pipWindowRef.current = null;
      return;
    }

    redraw();

    const openPiP = async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        await video.play();
        const pipWin = await video.requestPictureInPicture();
        pipWindowRef.current = pipWin;
        pipWin.addEventListener("resize", redraw);
        redraw();
      } catch (err) { console.warn("PiP failed:", err); }
    };
    setTimeout(openPiP, 200);

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/clipboard");
        const data = await res.json();
        const text = (data.text || "").trim();
        if (text && text !== lastClipRef.current && text.length >= 2 && text.length < 200) {
          lastClipRef.current = text;
          doMatch(text);
          redraw();
        }
      } catch {}
    }, 1000);

    const video = videoRef.current;
    const onLeave = () => { pipWindowRef.current = null; };
    video?.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      video?.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [active, doMatch, redraw]);

  useEffect(() => {
    if (active && lastClipRef.current && allGames.length > 0) {
      doMatch(lastClipRef.current);
      redraw();
    }
  }, [allGames, active, doMatch, redraw]);

  return null;
}
