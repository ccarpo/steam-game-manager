"use client";
import { useState, useEffect, useRef, useCallback, use } from "react";
import Link from "next/link";
import { COLOR_PRESETS, TintColors, hexToRgba } from "@/lib/types";

type SessionInfo = { source: string; started_at: string; total: number; done: number; failed: number; last_appid: number | null; status: string };
type MetaStatus = { totalGames: number; cached: { appdetails: number; reviews: number; community: number }; failedAppDetails: number; sessions: Record<string, SessionInfo> };
type SubtagRow = { id: number; tag_id: number; name: string; type: string; tag_name: string };
type ShareToken = { token: string; name: string; filter_json: string; created_at: string; expires_at: string | null };

/** Settings page with tabbed configuration sections. */
export default function SettingsPage({ searchParams }: { searchParams?: Promise<{ tab?: string }> }) {
  const params = searchParams ? use(searchParams) : null;
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [syncRunning, setSyncRunning] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [showIgnoredInput, setShowIgnoredInput] = useState(false);
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState(params?.tab || "steam");
  const logRef = useRef<HTMLDivElement>(null);
  const appendLog = useCallback((msg: string) => { setSyncLog((prev) => [...prev, msg]); }, []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [syncLog]);
  const fetchMetaStatus = useCallback(async () => {
    try { const r = await fetch("/api/sync/metadata"); if (r.ok) setMetaStatus(await r.json()); } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchMetaStatus(); }, [fetchMetaStatus]);
  useEffect(() => { fetch("/api/network").then(r => r.json()).then(d => setLanIps(d.ips || [])).catch(() => {}); }, []);
  const runSync = useCallback(async (endpoint: string, label: string) => {
    if (syncRunning) return;
    setSyncRunning(label); setSyncLog([`Starting ${label}...`]); setSyncProgress(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok || !res.body) { appendLog(`Error: ${res.status} ${res.statusText}`); setSyncRunning(null); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim(); if (!dataLine) continue;
          try {
            const data = JSON.parse(dataLine);
            if (data.type === "status") appendLog(data.message);
            else if (data.type === "progress") { setSyncProgress({ current: data.current, total: data.total }); if (data.name) appendLog(`[${data.current}/${data.total}] ${data.name}${data.error ? ` ✗ ${data.error}` : " ✓"}`); }
            else if (data.type === "done") { appendLog(data.message || "Done."); if (data.removedNames?.length > 0) appendLog(`Removed: ${data.removedNames.join(", ")}`); }
            else if (data.type === "error") appendLog(`Error: ${data.message}`);
          } catch { /* ignore */ }
        }
      }
    } catch (err) { appendLog(`Error: ${err}`); }
    setSyncRunning(null); setSyncProgress(null); fetchMetaStatus();
  }, [syncRunning, appendLog, fetchMetaStatus]);
  useEffect(() => { fetch("/api/settings").then((r) => r.json()).then(setSettings); }, []);
  const update = async (key: string, value: string) => {
    setSaving(true); setSettings((s) => ({ ...s, [key]: value }));
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
    setSaving(false);
  };
  const srcLabel: Record<string, string> = { appdetails: "App Details", reviews: "Reviews", community: "Community Tags" };
  const cachedKey: Record<string, keyof MetaStatus["cached"]> = { appdetails: "appdetails", reviews: "reviews", community: "community" };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="p-8 mx-auto pb-16">
        <div className="flex items-center gap-4 mb-4">
          <Link href="/" className="text-accent hover:underline text-sm">&larr; Back</Link>
          <h1 className="text-lg font-semibold">Settings</h1>
          {saving && <span className="text-xs text-muted animate-pulse">Saving...</span>}
          <div className="ml-auto text-[11px] text-muted">
            {lanIps.length > 0 && <>LAN: {lanIps.map((ip) => <a key={ip} href={`http://${ip}:3000`} target="_blank" rel="noopener noreferrer" className="text-accent ml-1 hover:underline">{ip}:3000</a>)}</>}
          </div>
        </div>
        {/* Tab navigation */}
        <div className="flex gap-1 mb-6 sticky top-0 z-10 bg-background py-2 border-b border-border/50">
          {[
            { id: "steam", label: "🔑 Steam & Sync" },
            { id: "display", label: "🎨 Display" },
            { id: "recommend", label: "🎯 Recommend" },
            { id: "tags", label: "🏷️ Tags" },
            { id: "system", label: "🗄️ System" },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-t text-xs border-b-2 transition-colors ${activeTab === t.id ? "border-accent text-accent bg-accent/5 font-medium" : "border-transparent text-muted hover:text-foreground hover:border-border"}`}>{t.label}</button>
          ))}
        </div>
        <div className="flex gap-4">
        {/* Left: settings content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* ═══ STEAM TAB ═══ */}
          <div className={activeTab !== "steam" ? "hidden" : "space-y-6"}>
          {/* Steam Credentials */}
          <div className="bg-surface rounded-lg p-4 border border-border" id="section-steam">
            <h2 className="text-sm font-medium mb-3">Steam Credentials</h2>
            <div className="flex gap-4 mb-2">
              <label className="flex-1"><span className="text-xs text-muted">Steam ID</span>
                <input type="text" value={settings.steam_id || ""} onChange={(e) => update("steam_id", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">API Key</span>
                <input type="password" value={settings.steam_api_key || ""} onChange={(e) => update("steam_api_key", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
            {(!settings.steam_id || !settings.steam_api_key) && (
              <p className="text-[10px] text-yellow-400">Set your Steam ID and API key to enable wishlist/owned sync. Get your API key at <a href="https://steamcommunity.com/dev/apikey" target="_blank" className="underline">steamcommunity.com/dev/apikey</a></p>
            )}
          </div>

          {/* Media Limits */}
          <div className="bg-surface rounded-lg p-4 border border-border" id="section-media">
            <h2 className="text-sm font-medium mb-3">Media Limits</h2>
            <p className="text-xs text-muted mb-3">Max screenshots and movies to download per game.</p>
            <div className="flex gap-4 mb-3">
              <label className="flex-1"><span className="text-xs text-muted">Max Screenshots</span>
                <input type="number" min={1} max={50} value={settings.max_screenshots || "5"} onChange={(e) => update("max_screenshots", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Max Movies</span>
                <input type="number" min={0} max={20} value={settings.max_movies || "2"} onChange={(e) => update("max_movies", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Image Concurrency</span>
                <input type="number" min={1} max={20} value={settings.image_concurrency || "5"} onChange={(e) => update("image_concurrency", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Meta Concurrency</span>
                <input type="number" min={1} max={10} value={settings.meta_concurrency || "1"} onChange={(e) => update("meta_concurrency", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
            <div className="flex gap-4">
              {([
                { key: "dl_headers", label: "Headers" },
                { key: "dl_ss_low", label: "SS Thumbnails" },
                { key: "dl_ss_hd", label: "SS HD" },
                { key: "dl_movies", label: "Movie Thumbs" },
              ] as const).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                  <input type="checkbox" checked={settings[key] !== "0"}
                    onChange={(e) => update(key, e.target.checked ? "1" : "0")}
                    className="accent-accent" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-lg p-4 border border-border" id="section-friends">
            <h2 className="text-sm font-medium mb-1">👥 Friend Libraries</h2>
            <p className="text-xs text-muted mb-3">Cache public Steam libraries for comparison. Your API key stays on this device.</p>
            <FriendLibraries />
          </div>

          <div className="bg-surface rounded-lg p-4 border border-border" id="section-steamdb">
            <h2 className="text-sm font-medium mb-1">🛠️ Manual SteamDB Metadata</h2>
            <p className="text-xs text-muted mb-3">Use the bookmarklet on a SteamDB app page, then paste the copied metadata below. This is a manual fallback for delisted or region-restricted apps.</p>
            <SteamDbImport />
          </div>
          </div>{/* end steam tab part 1 */}
          {/* ═══ DISPLAY TAB ═══ */}
          <div className={activeTab !== "display" ? "hidden" : "space-y-6"}>
          {/* Log Level */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Log Level</h2>
            <p className="text-xs text-muted mb-3">Server console log verbosity for sync operations.</p>
            <div className="flex gap-2">
              {(["off", "error", "info", "debug"] as const).map((v) => (
                <button key={v} onClick={() => update("log_level", v)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${(settings.log_level || "error") === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}</button>
              ))}
            </div>
          </div>
          {/* Slideshow */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Slideshow</h2>
            <p className="text-xs text-muted mb-3">Speed for card hover slideshow and global slideshow toggle.</p>
            <div className="flex gap-2">
              {["0.5", "1", "1.5", "2", "3", "5"].map((v) => (
                <button key={v} onClick={() => update("slideshow_speed", v)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${settings.slideshow_speed === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}s</button>
              ))}
            </div>
          </div>
          {/* Video Delay */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Video Delay</h2>
            <p className="text-xs text-muted mb-3">Seconds to wait before auto-loading video in lightbox.</p>
            <div className="flex gap-2">
              {["0", "1", "2", "3", "5"].map((v) => (
                <button key={v} onClick={() => { localStorage.setItem("gm_video_delay", v); update("video_delay", v); }}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${(settings.video_delay || "2") === v ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>{v}s</button>
              ))}
            </div>
          </div>
          {/* Score & Color Coding */}
          <div id="section-score"><ColorCodingSettings settings={settings} onUpdate={update} /></div>
          {/* Card View */}
          <div className="bg-surface rounded-lg p-4 border border-border" id="section-cards">
            <h2 className="text-sm font-medium mb-3">Card View</h2>
            <p className="text-xs text-muted mb-3">Controls what's shown on game cards in grid view.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Default Image</span>
                <select value={settings.card_default_image || "header"} onChange={(e) => update("card_default_image", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent">
                  <option value="header">Header (460×215)</option>
                  <option value="ss_0">Screenshot 1</option>
                  <option value="ss_1">Screenshot 2</option>
                  <option value="ss_2">Screenshot 3</option>
                  <option value="ss_3">Screenshot 4</option>
                  <option value="ss_4">Screenshot 5</option>
                </select>
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Genres Shown</span>
                <input type="number" min={0} max={10} value={settings.card_genres_count || "3"} onChange={(e) => update("card_genres_count", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Community Tags Shown</span>
                <input type="number" min={0} max={20} value={settings.card_community_tags_count || "4"} onChange={(e) => update("card_community_tags_count", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
          </div>
          {/* Clipboard Matching */}
          <div className="bg-surface rounded-lg p-4 border border-border" id="section-clipboard">
            <h2 className="text-sm font-medium mb-3">Clipboard Matching</h2>
            <p className="text-xs text-muted mb-3">Controls how the clipboard search matches game names.</p>
            <div className="flex gap-4">
              <label className="flex-1"><span className="text-xs text-muted">Partial Limit</span>
                <input type="number" min={1} max={20} value={settings.clip_partial_limit || "8"} onChange={(e) => update("clip_partial_limit", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Fuzzy Limit</span>
                <input type="number" min={1} max={20} value={settings.clip_fuzzy_limit || "6"} onChange={(e) => update("clip_fuzzy_limit", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
              <label className="flex-1"><span className="text-xs text-muted">Fuzzy Threshold</span>
                <input type="number" min={0.1} max={1} step={0.05} value={settings.clip_fuzzy_threshold || "0.5"} onChange={(e) => update("clip_fuzzy_threshold", e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent" />
              </label>
            </div>
            <div className="mt-3">
              <label className="text-xs text-muted">Exclude Tags from Library (comma-separated)</label>
              <input type="text" value={(() => { try { return JSON.parse(settings.clip_exclude_tags || '["steam","auto"]').join(", "); } catch { return "steam, auto"; } })()}
                onChange={(e) => update("clip_exclude_tags", JSON.stringify(e.target.value.split(",").map(s => s.trim()).filter(Boolean)))}
                className="mt-1 w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-accent"
                placeholder="steam, auto" />
              <p className="text-[9px] text-muted mt-1">Games with only these tags are treated as &quot;Steam/wishlist&quot; side, not &quot;Library&quot; side.</p>
            </div>
          </div>
          </div>{/* end display tab */}
          {/* ═══ STEAM TAB part 2 ═══ */}
          <div className={activeTab !== "steam" ? "hidden" : "space-y-6"}>
          {/* Export / Import */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Export / Import</h2>
            <div className="flex gap-3 items-center">
              <a href="/api/export/csv" className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors">📤 Export CSV</a>
              <a href="/api/export/txt" className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors">📤 Export TXT</a>
              <label className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors cursor-pointer">
                📥 Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  const res = await fetch("/api/import/csv", { method: "POST", body: text });
                  const data = await res.json();
                  alert(`Import: ${data.added} new, ${data.updated || 0} updated, ${data.existing} existing, ${data.tagLinks} tag links`);
                  window.location.reload();
                }} />
              </label>
            </div>
          </div>
          {/* CSV Export Columns */}
          <div id="section-csv"><CsvColumnsConfig settings={settings} onUpdate={update} /></div>
          {/* Bookmarklet */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Game Scroller</h2>
            <p className="text-xs text-muted mb-3">Copy the script and paste in browser console. Press <code className="bg-background px-1 rounded">Z</code> to scroll + copy game name, <code className="bg-background px-1 rounded">Shift+Z</code> to go back.</p>
            <div className="flex gap-3 items-center">
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/game-scroller.js");
                    const src = await res.text();
                    await navigator.clipboard.writeText(src);
                    alert("Script copied to clipboard! Paste in browser console.");
                  } catch { alert("Failed to copy"); }
                }}
                className="px-4 py-2 rounded-lg bg-accent/20 border border-accent text-accent text-sm font-medium hover:bg-accent/30">
                📋 Copy Script
              </button>
              <a href="/game-scroller.js" target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-muted hover:text-accent hover:underline">View source</a>
            </div>
          </div>
          {/* Steam Sync */}
          <div className="bg-surface rounded-lg p-4 border border-border">
            <h2 className="text-sm font-medium mb-3">Steam Sync</h2>
            {/* Cache stats */}
            {metaStatus && (
              <div className="mb-4 p-3 bg-background rounded border border-border">
                <div className="text-[11px] text-muted mb-2">Cache status ({metaStatus.totalGames} games total):</div>
                <div className="flex gap-4">
                  {(["appdetails", "reviews", "community"] as const).map((src) => {
                    const cached = metaStatus.cached[cachedKey[src]];
                    const pct = metaStatus.totalGames > 0 ? Math.round((cached / metaStatus.totalGames) * 100) : 0;
                    return (
                      <div key={src} className="flex-1">
                        <div className="text-[10px] text-muted">{srcLabel[src]}</div>
                        <div className="text-sm font-medium">{cached}/{metaStatus.totalGames} <span className="text-[10px] text-muted">({pct}%)</span></div>
                        <div className="h-1 bg-surface2 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-green-500/60 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Wishlist + Owned + Images */}
            <div className="flex gap-2 mb-3">
              <SyncBtn label="🔄 Sync Wishlist" color="blue" running={syncRunning} id="wishlist" onClick={() => runSync("/api/sync/wishlist", "wishlist")} />
              <SyncBtn label="🎮 Sync Owned" color="green" running={syncRunning} id="owned" onClick={() => runSync("/api/sync/owned", "owned")} />
              <SyncBtn label="🖼 Download Images" color="purple" running={syncRunning} id="images" onClick={() => runSync("/api/sync/images", "images")} />
              <SyncBtn label="🔁 Retry 404s" color="orange" running={syncRunning} id="images-retry" onClick={() => runSync("/api/sync/images?retry404=true", "images-retry")} />
              <SyncBtn label="🚫 Import Ignored" color="red" running={syncRunning} id="ignored" onClick={() => setShowIgnoredInput(true)} />
            </div>
            {showIgnoredInput && (
              <div className="mb-3 p-3 rounded border border-red-500/30 bg-red-500/5 space-y-2">
                <div className="text-xs text-muted">
                  Paste the full JSON from{" "}
                  <a href="https://store.steampowered.com/dynamicstore/userdata/" target="_blank" rel="noopener noreferrer"
                    className="text-accent underline hover:text-accent/80">store.steampowered.com/dynamicstore/userdata/</a>
                  {" "}(auto-extracts <code className="text-foreground">rgIgnoredApps</code>) or just the ignored section. Type 0 = not interested, non-zero = played elsewhere.
                </div>
                <textarea id="ignored-input" rows={3} placeholder='{"appid":1, ...} or [appid, appid, ...]'
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono" />
                <div className="flex gap-2">
                  <button onClick={async () => {
                    const input = (document.getElementById("ignored-input") as HTMLTextAreaElement)?.value?.trim();
                    if (!input) return;
                    let body: unknown;
                    try { body = JSON.parse(input); } catch (e) { alert("Invalid JSON: " + e); return; }
                    setShowIgnoredInput(false);
                    setSyncRunning("ignored"); setSyncLog(["Sending to server..."]); setSyncProgress(null);
                    try {
                      const res = await fetch("/api/sync/ignored", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                      if (!res.ok || !res.body) { appendLog(`Error: ${res.status}`); setSyncRunning(null); return; }
                      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
                      while (true) {
                        const { done, value } = await reader.read(); if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n\n"); buffer = lines.pop() || "";
                        for (const line of lines) {
                          const d = line.replace(/^data: /, "").trim(); if (!d) continue;
                          try {
                            const data = JSON.parse(d);
                            if (data.type === "progress") { setSyncProgress({ current: data.current, total: data.total }); if (data.name) appendLog(`[${data.current}/${data.total}] ${data.name}`); }
                            else if (data.type === "done") { appendLog(data.message || "Done."); }
                            else appendLog(data.message || JSON.stringify(data));
                          } catch {}
                        }
                      }
                      setSyncRunning(null); setSyncProgress(null);
                    } catch (e) { appendLog(`Error: ${e}`); setSyncRunning(null); }
                  }} className="px-3 py-1 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30">Import</button>
                  <button onClick={() => setShowIgnoredInput(false)} className="px-3 py-1 text-xs rounded text-muted hover:text-foreground border border-border">Cancel</button>
                </div>
              </div>
            )}
            {/* Fetch missing */}
            <div className="text-[10px] text-muted mb-1">Fetch missing (auto-resumable):</div>
            <div className="flex gap-2 mb-3">
              <SyncBtn label="📦 All 3" color="green" running={syncRunning} id="meta-miss-all" onClick={() => runSync("/api/sync/metadata?source=all&mode=missing", "meta-miss-all")} />
              <SyncBtn label="App Details" color="green" running={syncRunning} id="meta-miss-det" onClick={() => runSync("/api/sync/metadata?source=appdetails&mode=missing", "meta-miss-det")} />
              <SyncBtn label="Reviews" color="green" running={syncRunning} id="meta-miss-rev" onClick={() => runSync("/api/sync/metadata?source=reviews&mode=missing", "meta-miss-rev")} />
              <SyncBtn label="Community" color="green" running={syncRunning} id="meta-miss-ct" onClick={() => runSync("/api/sync/metadata?source=community&mode=missing", "meta-miss-ct")} />
            </div>
            {(metaStatus?.failedAppDetails ?? 0) > 0 && (
              <div className="flex items-center gap-2 mb-3 rounded border border-yellow-500/30 bg-yellow-500/5 px-2.5 py-2">
                <span className="text-[10px] text-yellow-300">{metaStatus!.failedAppDetails} App Details response{metaStatus!.failedAppDetails === 1 ? "" : "s"} returned <code>{"{\"success\":false}"}</code>.</span>
                <SyncBtn label="↻ Retry failed" color="yellow" running={syncRunning} id="meta-retry-failed" onClick={() => runSync("/api/sync/metadata?source=appdetails&mode=failed", "meta-retry-failed")} />
              </div>
            )}
            {/* Re-fetch all per source with session info */}
            <div className="text-[10px] text-muted mb-1">Re-fetch all (overwrites cache):</div>
            {(["appdetails", "reviews", "community"] as const).map((src) => {
              const session = metaStatus?.sessions[src];
              const hasInterrupted = session && session.status !== "done";
              return (
                <div key={src} className="flex items-center gap-2 mb-2">
                  <div className="w-28 text-xs text-muted">{srcLabel[src]}</div>
                  {hasInterrupted ? (
                    <>
                      <span className="text-[10px] text-yellow-400">⏸ {session.done}/{session.total}{session.failed > 0 && `, ${session.failed} err`}{session.started_at && ` · ${new Date(session.started_at + "Z").toLocaleDateString()}`}</span>
                      <SyncBtn label="▶ Resume" color="yellow" running={syncRunning} id={`meta-resume-${src}`} onClick={() => runSync(`/api/sync/metadata?source=${src}&mode=resume`, `meta-resume-${src}`)} />
                      <SyncBtn label="⟳ Fresh" color="red" running={syncRunning} id={`meta-fresh-${src}`} onClick={() => runSync(`/api/sync/metadata?source=${src}&mode=fresh`, `meta-fresh-${src}`)} />
                    </>
                  ) : (
                    <>
                      {session?.status === "done" && <span className="text-[10px] text-green-400">✓ {session.done}/{session.total}{session.started_at && ` · ${new Date(session.started_at + "Z").toLocaleDateString()}`}</span>}
                      <SyncBtn label="⟳ Start" color="yellow" running={syncRunning} id={`meta-fresh-${src}`} onClick={() => runSync(`/api/sync/metadata?source=${src}&mode=fresh`, `meta-fresh-${src}`)} />
                    </>
                  )}
                </div>
              );
            })}
            {/* Progress bar */}
            {syncProgress && (
              <div className="mt-3 mb-2 lg:hidden">
                <div className="flex justify-between text-[10px] text-muted mb-1"><span>{syncRunning}</span><span>{syncProgress.current}/{syncProgress.total}</span></div>
                <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }} />
                </div>
              </div>
            )}
            {/* Log — only shown on small screens (large screens use sticky panel) */}
            {syncLog.length > 0 && (
              <div className="mt-3 bg-background rounded border border-border p-2 max-h-[200px] overflow-y-auto font-mono text-[11px] text-muted space-y-0.5 lg:hidden">
                {syncLog.map((line, i) => (
                  <div key={i} className={line.includes("✗") || line.includes("Error") ? "text-red-400" : line.includes("✓") || line.includes("done") ? "text-green-400" : line.startsWith("---") ? "text-accent" : ""}>{line}</div>
                ))}
              </div>
            )}
          </div>

          </div>{/* end steam tab part 2 */}
          {/* ═══ SYSTEM TAB ═══ */}
          <div className={activeTab !== "system" ? "hidden" : "space-y-6"}>
          {/* Database */}
          <div className="bg-surface rounded-lg border border-border p-4" id="section-database">
            <h2 className="text-sm font-semibold mb-3">🗄️ Database</h2>
            <p className="text-xs text-muted mb-3">Re-run DB init: column migrations + asset count sync. Nothing is deleted.</p>
            <button
              onClick={async () => {
                const res = await fetch("/api/db/reset", { method: "POST" });
                const data = await res.json();
                if (data.ok) alert("DB re-initialized.");
                else alert("Error: " + data.message);
              }}
              className="px-3 py-1.5 rounded text-xs border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
            >⟳ Re-init Database</button>
            <button
              onClick={async () => {
                setSyncRunning("similarities"); setSyncLog(["Recalculating similarities..."]);
                try {
                  const res = await fetch("/api/sync/similarities", { method: "POST" });
                  const data = await res.json();
                  if (data.ok) appendLog(`Done: ${data.games} games, ${data.pairs} similarity pairs computed.`);
                  else appendLog("Error: " + JSON.stringify(data));
                } catch (err) { appendLog(`Error: ${err}`); }
                setSyncRunning(null);
              }}
              disabled={!!syncRunning}
              className="ml-2 px-3 py-1.5 rounded text-xs border border-purple-500/50 text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
            >🔗 Recalculate Similarities</button>
            <button
              onClick={async () => {
                appendLog("Generating auto-tags (release year, sentiment, score)...");
                try {
                  const res = await fetch("/api/sync/auto-tags", { method: "POST" });
                  const data = await res.json();
                  if (data.ok) appendLog(`Auto-tags: release=${data.release}, sentiment=${data.sentiment}, score=${data.score}`);
                  else appendLog("Error: " + JSON.stringify(data));
                } catch (err) { appendLog(`Error: ${err}`); }
              }}
              className="ml-2 px-3 py-1.5 rounded text-xs border border-orange-500/50 text-orange-400 hover:bg-orange-500/10 transition-colors"
            >🏷️ Auto Tags</button>
            <button
              onClick={async () => {
                appendLog("Refreshing TBA/upcoming release dates...");
                setSyncRunning("tba");
                try {
                  const res = await fetch("/api/sync/refresh-tba", { method: "POST" });
                  const reader = res.body?.getReader();
                  if (!reader) return;
                  const decoder = new TextDecoder();
                  let buf = "";
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    const lines = buf.split("\n\n");
                    buf = lines.pop() || "";
                    for (const line of lines) {
                      const m = line.match(/^data: (.+)/);
                      if (!m) continue;
                      const d = JSON.parse(m[1]);
                      if (d.type === "progress") appendLog(`  ${d.name}: "${d.oldDate}" → "${d.newDate}"`);
                      else if (d.type === "done") appendLog(d.message);
                      else if (d.type === "status") appendLog(d.message);
                      else if (d.type === "error") appendLog(`Error: ${d.message}`);
                    }
                  }
                } catch (err) { appendLog(`Error: ${err}`); }
                setSyncRunning(null);
              }}
              disabled={!!syncRunning}
              className="ml-2 px-3 py-1.5 rounded text-xs border border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
            >🔄 Refresh TBA</button>
            <button
              onClick={async () => {
                appendLog("Flushing WAL & backing up...");
                try {
                  const res = await fetch("/api/db/flush-wal", { method: "POST" });
                  const data = await res.json();
                  if (data.ok) {
                    if (data.backed_up) {
                      appendLog(`✓ WAL flushed, backup saved: ${data.backup_file}`);
                      data.delta?.forEach((l: string) => appendLog(`  ${l}`));
                    } else {
                      appendLog("✓ WAL flushed. No changes since last backup.");
                    }
                  } else appendLog("Error: " + JSON.stringify(data));
                } catch (err) { appendLog(`Error: ${err}`); }
              }}
              className="ml-2 px-3 py-1.5 rounded text-xs border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
            >💾 Flush & Backup</button>
            <label className="ml-4 flex items-center gap-1.5 text-xs text-muted">
              Max backups
              <input
                type="number" min={1} max={50}
                defaultValue={settings.max_backups || "5"}
                onBlur={(e) => {
                  const v = Math.max(1, Math.min(50, parseInt(e.target.value) || 5));
                  e.target.value = String(v);
                  update("max_backups", String(v));
                }}
                className="w-14 bg-background border border-border rounded px-1.5 py-0.5 text-xs text-center"
              />
            </label>
          </div>

          </div>{/* end system tab part 1 */}
          {/* ═══ RECOMMEND TAB ═══ */}
          <div className={activeTab !== "recommend" ? "hidden" : "space-y-6"}>
          {/* Recommendation Weights */}
          <RecWeightsConfig settings={settings} onUpdate={update} appendLog={appendLog} />
          </div>{/* end recommend tab */}
          {/* ═══ SYSTEM TAB part 2 ═══ */}
          <div className={activeTab !== "system" ? "hidden" : "space-y-6"}>
          {/* UI Preferences */}
          <div className="bg-surface rounded-lg border border-border p-4" id="section-prefs">
            <h2 className="text-sm font-semibold mb-3">🎨 UI Preferences</h2>
            <p className="text-xs text-muted mb-3">UI prefs (view, columns, sidebar) are saved to both browser and DB. In incognito, prefs load from DB.</p>
            <button
              onClick={() => {
                if (!confirm("Reset all UI preferences (view, columns, sidebar, filters) to defaults?")) return;
                localStorage.clear();
                fetch("/api/prefs", { method: "DELETE" }).then(() => {
                  appendLog("UI preferences reset. Reload the page.");
                });
              }}
              className="px-3 py-1.5 rounded text-xs border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors"
            >🗑 Reset UI Preferences</button>
          </div>

          {/* Share Links */}
          <div className="bg-surface rounded-lg border border-border p-4" id="section-share">
            <h2 className="text-sm font-semibold mb-1">🔗 Share Links</h2>
            <p className="text-xs text-muted mb-4">Create read-only shareable URLs for filtered game collections.</p>
            <ShareLinks lanIps={lanIps} />
          </div>

          {/* System Log — only on small screens, large screens use sticky panel */}
          <div id="section-log" className="lg:hidden"><SystemLog /></div>
          </div>{/* end system tab part 2 */}
          {/* ═══ TAGS TAB ═══ */}
          <div className={activeTab !== "tags" ? "hidden" : "space-y-6"}>
          {/* Tag & Subtag Management */}
          <div id="section-tags"><TagManager /></div>
          </div>{/* end tags tab */}
        </div>{/* end left content */}
        {/* Right: sticky log panel */}
        <div className="flex-1 min-w-0 hidden lg:block">
          <div className="sticky top-14 space-y-3">
            {/* Sync progress */}
            {syncProgress && (
              <div className="bg-surface rounded-lg border border-border p-3">
                <div className="flex justify-between text-[10px] text-muted mb-1"><span>{syncRunning}</span><span>{syncProgress.current}/{syncProgress.total}</span></div>
                <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }} />
                </div>
              </div>
            )}
            {/* Activity log */}
            <div className="bg-surface rounded-lg border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted font-medium">📋 Activity Log</span>
                {syncLog.length > 0 && <button onClick={() => setSyncLog([])} className="text-[9px] text-danger hover:underline">Clear</button>}
              </div>
              <div ref={logRef} className="bg-background rounded border border-border p-2 max-h-[50vh] min-h-[60px] overflow-y-auto font-mono text-[10px] text-muted space-y-0.5 resize-y">
                {syncLog.length === 0 ? (
                  <div className="text-center py-4 text-muted/50">No activity yet</div>
                ) : syncLog.map((line, i) => (
                  <div key={i} className={line.includes("✗") || line.includes("Error") ? "text-red-400" : line.includes("✓") || line.includes("done") || line.includes("Done") ? "text-green-400" : line.startsWith("---") ? "text-accent" : ""}>{line}</div>
                ))}
              </div>
            </div>
            {/* System log inline */}
            <SystemLog />
          </div>
        </div>
        </div>{/* end flex row */}
      </div>
    </div>
  );
}

function ColorCodingSettings({ settings, onUpdate }: { settings: Record<string, string>; onUpdate: (key: string, value: string) => void }) {
  const scoreSource = settings.score_source || "steamdb";
  const colorCoded = settings.color_coded === "1";
  const preset = settings.color_preset || "subtle";

  const getCustom = (): TintColors => ({
    high: settings.color_custom_high || "#22c55e",
    mid: settings.color_custom_mid || "#f59e0b",
    low: settings.color_custom_low || "#ef4444",
    opacity: parseFloat(settings.color_opacity || "0.08"),
  });

  const activeTint: TintColors = preset === "custom" ? getCustom() : (COLOR_PRESETS[preset] || COLOR_PRESETS.subtle);

  const samples = [
    { label: "92 · Very Positive", score: 92 },
    { label: "58 · Mixed", score: 58 },
    { label: "24 · Mostly Negative", score: 24 },
  ];

  return (
    <div className="bg-surface rounded-lg p-4 border border-border space-y-4">
      <div>
        <h2 className="text-sm font-medium mb-1">Score & Color Coding</h2>
        <p className="text-xs text-muted">Choose primary score source and tint style for cards and rows.</p>
      </div>

      {/* Score Source */}
      <div>
        <div className="text-xs text-muted mb-2">Primary Score</div>
        <div className="flex gap-3">
          {[{ value: "steamdb", label: "SteamDB", desc: "Wilson score (adjusts for sample size)" }, { value: "steam", label: "Steam", desc: "Raw positive % from reviews" }].map((opt) => (
            <button key={opt.value} onClick={() => onUpdate("score_source", opt.value)}
              className={`flex-1 p-2.5 rounded-lg border text-left transition-colors ${scoreSource === opt.value ? "border-accent bg-accent/10" : "border-border hover:border-border/80"}`}>
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-[10px] text-muted">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Color Coding Toggle */}
      <div>
        <div className="text-xs text-muted mb-2">Tinting</div>
        <div className="flex gap-3">
          {[{ value: "0", label: "Default", desc: "No tint" }, { value: "1", label: "Color-coded", desc: "Tint by score" }].map((opt) => (
            <button key={opt.value} onClick={() => onUpdate("color_coded", opt.value)}
              className={`flex-1 p-2.5 rounded-lg border text-left transition-colors ${(settings.color_coded || "0") === opt.value ? "border-accent bg-accent/10" : "border-border hover:border-border/80"}`}>
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-[10px] text-muted">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Preset + Custom (only when color-coded) */}
      {colorCoded && (
        <>
          <div>
            <div className="text-xs text-muted mb-2">Color Preset</div>
            <div className="flex gap-2">
              {(["subtle", "vivid", "neon", "custom"] as const).map((p) => (
                <button key={p} onClick={() => onUpdate("color_preset", p)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors capitalize ${preset === p ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-foreground"}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Custom color pickers */}
          {preset === "custom" && (() => {
            const c = getCustom();
            return (
              <div className="flex gap-4 items-end">
                {([
                  { key: "color_custom_high", label: "High (≥70)", val: c.high },
                  { key: "color_custom_mid", label: "Mid (≥40)", val: c.mid },
                  { key: "color_custom_low", label: "Low (<40)", val: c.low },
                ] as const).map(({ key, label, val }) => (
                  <label key={key} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-muted">{label}</span>
                    <input type="color" value={val} onChange={(e) => onUpdate(key, e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
                  </label>
                ))}
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-[10px] text-muted">Opacity ({Math.round(c.opacity * 100)}%)</span>
                  <input type="range" min={0.02} max={0.25} step={0.01} value={c.opacity}
                    onChange={(e) => onUpdate("color_opacity", e.target.value)}
                    className="accent-accent" />
                </label>
              </div>
            );
          })()}

          {/* Preview */}
          <div>
            <div className="text-xs text-muted mb-2">Preview</div>
            <div className="flex gap-2">
              {samples.map((s) => {
                const tintColor = s.score >= 70 ? activeTint.high : s.score >= 40 ? activeTint.mid : activeTint.low;
                const textColor = s.score >= 70 ? activeTint.high : s.score >= 40 ? activeTint.mid : activeTint.low;
                return (
                  <div key={s.score} className="flex-1 rounded-lg border border-border/50 p-3 text-center"
                    style={{ backgroundColor: hexToRgba(tintColor, activeTint.opacity) }}>
                    <div className="text-sm font-bold" style={{ color: textColor }}>{s.score}</div>
                    <div className="text-[10px] text-muted">{s.label.split(" · ")[1]}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SyncBtn({ label, color, running, id, onClick }: { label: string; color: string; running: string | null; id: string; onClick: () => void }) {
  const isThis = running === id;
  const colorMap: Record<string, string> = {
    blue: "border-blue-500/50 text-blue-400 hover:bg-blue-500/10",
    green: "border-green-500/50 text-green-400 hover:bg-green-500/10",
    yellow: "border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10",
    purple: "border-purple-500/50 text-purple-400 hover:bg-purple-500/10",
    red: "border-red-500/50 text-red-400 hover:bg-red-500/10",
    orange: "border-orange-500/50 text-orange-400 hover:bg-orange-500/10",
  };
  const activeMap: Record<string, string> = {
    blue: "bg-blue-500/20 border-blue-500 text-blue-400",
    green: "bg-green-500/20 border-green-500 text-green-400",
    yellow: "bg-yellow-500/20 border-yellow-500 text-yellow-400",
    purple: "bg-purple-500/20 border-purple-500 text-purple-400",
    red: "bg-red-500/20 border-red-500 text-red-400",
    orange: "bg-orange-500/20 border-orange-500 text-orange-400",
  };
  return (
    <button onClick={onClick} disabled={!!running}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isThis ? `${activeMap[color]} animate-pulse` : running ? "opacity-40 cursor-not-allowed border-border text-muted" : colorMap[color]}`}>
      {label}
    </button>
  );
}

const ALL_CSV_COLS = [
  { key: "id", label: "ID", locked: true },
  { key: "name", label: "Name", locked: true },
  { key: "steam_appid", label: "Steam AppID" },
  { key: "notes", label: "Notes" },
  { key: "added_at", label: "Added At" },
  { key: "l0", label: "Tag (L0)", locked: true },
  { key: "genres", label: "Genres", locked: true },
  { key: "meta", label: "Meta", locked: true },
  { key: "description", label: "Description" },
  { key: "developers", label: "Developers" },
  { key: "publishers", label: "Publishers" },
  { key: "release_date", label: "Release Date" },
  { key: "review_sentiment", label: "Review Sentiment" },
  { key: "positive_percent", label: "Positive %" },
  { key: "total_reviews", label: "Total Reviews" },
  { key: "metacritic_score", label: "Metacritic" },
  { key: "steam_genres", label: "Steam Genres" },
  { key: "steam_features", label: "Steam Features" },
  { key: "community_tags", label: "Community Tags" },
  { key: "wishlist_date", label: "Wishlist Date" },
  { key: "steam_image_url", label: "Image URL" },
  { key: "user_rating", label: "User Rating" },
  { key: "queue_position", label: "Curation #" },
];

const DEFAULT_CSV_COLS = ["id", "name", "steam_appid", "notes", "added_at", "l0", "genres", "meta", "user_rating", "queue_position"];

function CsvColumnsConfig({ settings, onUpdate }: { settings: Record<string, string>; onUpdate: (key: string, value: string) => void }) {
  const current: string[] = (() => {
    try { return JSON.parse(settings.csv_export_columns || "[]"); } catch { return DEFAULT_CSV_COLS; }
  })();
  const isDefault = JSON.stringify(current) === JSON.stringify(DEFAULT_CSV_COLS);

  const toggle = (key: string) => {
    const locked = ALL_CSV_COLS.find((c) => c.key === key)?.locked;
    if (locked) return;
    const next = current.includes(key) ? current.filter((c) => c !== key) : [...current, key];
    onUpdate("csv_export_columns", JSON.stringify(next));
  };

  const reset = () => onUpdate("csv_export_columns", JSON.stringify(DEFAULT_CSV_COLS));

  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-medium">CSV Export Columns</h2>
          <p className="text-xs text-muted mt-1">Columns included in the main CSV section. Not-on-steam section always exports all columns.</p>
        </div>
        {!isDefault && (
          <button onClick={reset} className="text-xs text-accent hover:underline">Reset to default</button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ALL_CSV_COLS.map((col) => {
          const active = current.includes(col.key);
          const locked = col.locked;
          return (
            <button key={col.key} onClick={() => toggle(col.key)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                active
                  ? locked ? "border-accent/40 bg-accent/10 text-accent/70 cursor-default" : "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted hover:text-foreground hover:border-border/80"
              }`}>
              {col.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Inline subtag autocomplete input */
function SubtagInput({ allSubtags, onSelect, placeholder = "tag > subtag..." }: {
  allSubtags: { tag: string; subtag: string }[];
  onSelect: (subtag: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.toLowerCase().replace(/\s*[>›]\s*/g, ">");
  const filtered = q.length > 0 ? allSubtags.filter(s => {
    const full = `${s.tag}>${s.subtag}`.toLowerCase();
    return s.subtag.toLowerCase().includes(q) || s.tag.toLowerCase().includes(q) || full.includes(q);
  }).slice(0, 12) : [];

  return (
    <div className="relative inline-block">
      <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) { onSelect(query.trim()); setQuery(""); setOpen(false); } }}
        placeholder={placeholder} className="w-32 bg-background border border-border rounded px-1.5 py-0.5 text-[10px]" />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-0.5 bg-surface border border-border rounded shadow-lg max-h-32 overflow-y-auto w-48">
          {filtered.map((s, i) => (
            <button key={i} className="w-full text-left px-2 py-0.5 text-[10px] hover:bg-surface2/50 flex gap-1"
              onMouseDown={(e) => { e.preventDefault(); onSelect(`${s.tag}>${s.subtag}`); setQuery(""); setOpen(false); }}>
              <span className="text-muted">{s.tag} ›</span> <span>{s.subtag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RecWeightsConfig({ settings, onUpdate, appendLog }: { settings: Record<string, string>; onUpdate: (k: string, v: string) => void; appendLog: (msg: string) => void }) {
  const defaultWeights = { genreMatch: 25, devMatch: 5, ctagMatch: 20, score: 20, maturity: 15, waiting: 15, ratedMatch: 0, priority: 20 };
  const [weights, setWeights] = useState(defaultWeights);
  const [ctagMode, setCtagMode] = useState("count");
  const [sweetSpot, setSweetSpot] = useState({ min: 70, max: 85 });
  const [waitingCap, setWaitingCap] = useState(1825);
  const [useAllRated, setUseAllRated] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Three categories: played (training), priority (boost), exclude (hidden)
  const [played, setPlayed] = useState<string[]>(["done", "played_elsewhere"]);
  const [priority, setPriority] = useState<{ subtag: string; boost: number }[]>([{ subtag: "next", boost: 30 }, { subtag: "franchise", boost: 20 }]);
  const [excludes, setExcludes] = useState<string[]>(["hide", "not_my_type"]);
  const [genrePrefs, setGenrePrefs] = useState<{ tag: string; value: number }[]>([]);

  // Sync state from settings when they arrive (settings load async)
  useEffect(() => {
    if (!settings.rec_weights && !settings.rec_ctag_mode && !settings.rec_sweet_spot) return; // not loaded yet
    if (settingsLoaded) return; // only sync once
    try { setWeights({ ...defaultWeights, ...JSON.parse(settings.rec_weights || "{}") }); } catch {}
    setCtagMode(settings.rec_ctag_mode || "count");
    try { setSweetSpot(JSON.parse(settings.rec_sweet_spot || '{"min":70,"max":85}')); } catch {}
    setWaitingCap(parseInt(settings.rec_waiting_cap || "1825") || 1825);
    setUseAllRated(settings.rec_use_all_rated === "1");
    try { setPlayed(JSON.parse(settings.rec_played || '["done","played_elsewhere"]')); } catch {}
    try { setPriority(JSON.parse(settings.rec_priority || '[{"subtag":"next","boost":30},{"subtag":"franchise","boost":20}]')); } catch {}
    try { setExcludes(JSON.parse(settings.rec_exclude || '["hide","not_my_type"]')); } catch {}
    try { setGenrePrefs(JSON.parse(settings.rec_genre_prefs || "[]")); } catch {}
    setSettingsLoaded(true);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load all subtags + genres/community tags for autocomplete
  const [allSubtags, setAllSubtags] = useState<{ tag: string; subtag: string }[]>([]);
  const [allGenreNames, setAllGenreNames] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/subtags").then(r => r.json()).then((subs: { tag_id: number; name: string }[]) => {
      fetch("/api/tags").then(r => r.json()).then((tags: { id: number; name: string }[]) => {
        const tagMap = new Map(tags.map(t => [t.id, t.name]));
        setAllSubtags(subs.map(s => ({ tag: tagMap.get(s.tag_id) || "?", subtag: s.name })));
      });
    });
    fetch("/api/genres").then(r => r.json()).then((data: { genres: { name: string }[]; communityTags: { name: string }[] }) => {
      const names = [...new Set([...data.genres.map(g => g.name), ...data.communityTags.map(t => t.name)])];
      setAllGenreNames(names.sort());
    }).catch(() => {});
  }, []);

  const [newPrioBoost, setNewPrioBoost] = useState(20);
  const [profileData, setProfileData] = useState<{ playedCount: number; genres: { name: string; weight: number }[]; devs: { name: string; weight: number }[]; ctags: { name: string; weight: number }[] } | null>(null);
  const [newGenrePrefTag, setNewGenrePrefTag] = useState("");
  const [newGenrePrefValue, setNewGenrePrefValue] = useState(50);

  const save = () => {
    onUpdate("rec_weights", JSON.stringify(weights));
    onUpdate("rec_ctag_mode", ctagMode);
    onUpdate("rec_sweet_spot", JSON.stringify(sweetSpot));
    onUpdate("rec_waiting_cap", String(waitingCap));
    onUpdate("rec_use_all_rated", useAllRated ? "1" : "0");
    onUpdate("rec_genre_prefs", JSON.stringify(genrePrefs));
    onUpdate("rec_played", JSON.stringify(played));
    onUpdate("rec_priority", JSON.stringify(priority));
    onUpdate("rec_exclude", JSON.stringify(excludes));
    appendLog("Recommendation config saved.");
  };

  const reset = () => {
    setWeights(defaultWeights);
    setCtagMode("count");
    setSweetSpot({ min: 70, max: 85 });
    setWaitingCap(1825);
    setUseAllRated(false);
    setGenrePrefs([]);
    setPlayed(["done", "played_elsewhere"]);
    setPriority([{ subtag: "next", boost: 30 }, { subtag: "franchise", boost: 20 }]);
    setExcludes(["hide", "not_my_type"]);
  };

  const chipClass = (_color: string) => `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border`;

  return (
    <div className="bg-surface rounded-lg p-4 border border-border" id="section-recommendation">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold">🎯 Recommendation Config</h2>
        <button onClick={() => setShowInfo(!showInfo)} className="text-[10px] text-muted hover:text-foreground border border-border rounded-full w-4 h-4 flex items-center justify-center" title="How scoring works">i</button>
      </div>

      {showInfo && (
        <div className="bg-background rounded border border-border p-3 mb-3 text-[11px] text-muted space-y-1">
          <p><span className="text-cyan-400">📚 Played</span> — Games with these subtags are your training data. Their genres, developers, and community tags build your preference profile.</p>
          <p><span className="text-green-400">⭐ Priority</span> — Games with these subtags get a score boost. Higher boost = stronger push to the top. Use for tags like &quot;next&quot; or &quot;franchise&quot;.</p>
          <p><span className="text-red-400">🚫 Exclude</span> — Games with these subtags are completely hidden from recommendations. Not scored, not shown.</p>
          <p className="pt-1 border-t border-border/50"><span className="text-foreground">Scoring:</span> Each game gets a 0–1 score from 8 signals: genre match, dev/pub match, community tag match, score quality (configurable sweet spot), release maturity, waiting time, rated match, and priority boost. Weights are normalized — enter any numbers.</p>
          <p><span className="text-foreground">Personal Match (⭐📋):</span> Compares each candidate against games you&apos;ve rated or curated. Higher user ratings and lower curation numbers mean stronger influence. Set the &quot;⭐📋 Personal&quot; weight to control impact.</p>
          <p><span className="text-foreground">User Rating:</span> Rate played games 1–10 in the Edit Modal. Higher-rated games contribute more to your preference profile (rating 10 = full weight, 5 = half, unrated = 0.5 neutral). Rate your favorite metroidvanias 9–10 and they&apos;ll dominate your profile.</p>
        </div>
      )}

      {/* Signal weights */}
      {(() => { const total = Object.values(weights as Record<string, number>).reduce((a, b) => a + b, 0); return <p className="text-[10px] text-muted mb-2">Signal weights (total: {total} — remaining from 100: {Math.max(0, 100 - total)})</p>; })()}
      <div className="grid grid-cols-4 gap-2 mb-1">
        {(["genreMatch", "devMatch", "ctagMatch", "score", "maturity", "waiting", "ratedMatch", "priority"] as const).map(k => (
          <label key={k} className="flex items-center gap-2">
            <span className="text-[10px] text-muted w-20 text-right shrink-0">{
              { genreMatch: "Genres", devMatch: "Dev/Pub", ctagMatch: "Comm Tags", score: "Score", maturity: "Maturity", waiting: "Waiting", ratedMatch: "⭐📋 Personal", priority: "Priority" }[k]
            }</span>
            <input type="number" min={0} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) || 0 })}
              className="w-16 bg-background border border-border rounded px-2 py-1 text-sm text-center" />
          </label>
        ))}
      </div>
      <button onClick={() => setWeights({ genreMatch: 0, devMatch: 0, ctagMatch: 0, score: 0, maturity: 0, waiting: 0, ratedMatch: 0, priority: 0 })}
        className="text-[9px] text-muted hover:text-foreground mb-3">Reset all to 0</button>

      {/* Options — 2x2 grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4 text-xs text-muted">
        <label className="flex items-center gap-1.5">
          Community tag mode:
          <select value={ctagMode} onChange={(e) => setCtagMode(e.target.value)}
            className="bg-background border border-border rounded px-2 py-0.5 text-xs">
            <option value="count">By count (popular = stronger)</option>
            <option value="inverse">Inverse (rare = distinctive)</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Score sweet spot:
          <input type="number" min={0} max={100} value={sweetSpot.min} onChange={(e) => setSweetSpot({ ...sweetSpot, min: Number(e.target.value) })}
            className="w-12 bg-background border border-border rounded px-1 py-0.5 text-xs text-center" />
          –
          <input type="number" min={0} max={100} value={sweetSpot.max} onChange={(e) => setSweetSpot({ ...sweetSpot, max: Number(e.target.value) })}
            className="w-12 bg-background border border-border rounded px-1 py-0.5 text-xs text-center" />
          %
        </label>
        <label className="flex items-center gap-1.5">
          Waiting cap:
          <input type="number" min={30} max={7300} step={30} value={waitingCap} onChange={(e) => setWaitingCap(Number(e.target.value) || 1825)}
            className="w-16 bg-background border border-border rounded px-1 py-0.5 text-xs text-center" />
          days
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={useAllRated} onChange={(e) => setUseAllRated(e.target.checked)} className="accent-accent" />
          Include all user-rated games in training
        </label>
      </div>

      {/* Three categories */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Played (training data) */}
        <div>
          <span className="text-[10px] text-cyan-400 font-medium block mb-1">📚 Played (training data)</span>
          <span className="text-[9px] text-muted block mb-1">Games with these subtags teach the algorithm your preferences</span>
          <div className="flex flex-wrap gap-1">
            {played.map(s => (
              <span key={s} className={chipClass("cyan")} style={{ backgroundColor: "rgba(6,182,212,0.1)", borderColor: "rgba(6,182,212,0.3)", color: "#06b6d4" }}>
                {s} <button onClick={() => setPlayed(played.filter(x => x !== s))} className="font-bold">×</button>
              </span>
            ))}
            <SubtagInput allSubtags={allSubtags} onSelect={(s) => { if (!played.includes(s)) setPlayed([...played, s]); }} />
          </div>
        </div>

        {/* Priority (boost) */}
        <div>
          <span className="text-[10px] text-green-400 font-medium block mb-1">⭐ Priority (boost)</span>
          <span className="text-[9px] text-muted block mb-1">Games with these subtags get a score boost</span>
          <div className="flex flex-wrap gap-1">
            {priority.map((p, i) => (
              <span key={p.subtag} className={chipClass("green")} style={{ backgroundColor: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.3)", color: "#22c55e" }}>
                {p.subtag} (+{p.boost}) <button onClick={() => setPriority(priority.filter((_, j) => j !== i))} className="font-bold">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1 mt-1 items-center">
            <SubtagInput allSubtags={allSubtags} onSelect={(s) => { if (!priority.some(p => p.subtag === s)) setPriority([...priority, { subtag: s, boost: newPrioBoost }]); }} placeholder="tag > subtag..." />
            <span className="text-[9px] text-muted">boost:</span>
            <input type="number" value={newPrioBoost} onChange={(e) => setNewPrioBoost(Number(e.target.value))} className="w-10 bg-background border border-border rounded px-1 py-0.5 text-[10px] text-center" />
          </div>
        </div>

        {/* Exclude (hidden) */}
        <div>
          <span className="text-[10px] text-red-400 font-medium block mb-1">🚫 Exclude (hidden)</span>
          <span className="text-[9px] text-muted block mb-1">Games with these subtags are completely hidden from recommendations</span>
          <div className="flex flex-wrap gap-1">
            {excludes.map(s => (
              <span key={s} className={chipClass("red")} style={{ backgroundColor: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#ef4444" }}>
                {s} <button onClick={() => setExcludes(excludes.filter(x => x !== s))} className="font-bold">×</button>
              </span>
            ))}
            <SubtagInput allSubtags={allSubtags} onSelect={(s) => { if (!excludes.includes(s)) setExcludes([...excludes, s]); }} />
          </div>
        </div>
      </div>

      {/* Genre Preferences (boost/penalty) */}
      <div className="mb-4">
        <span className="text-[10px] text-amber-400 font-medium block mb-1">🎮 Genre Preferences (boost/penalty)</span>
        <span className="text-[9px] text-muted block mb-1">Add genres or community tags with positive (boost) or negative (penalty) values. These directly adjust your profile.</span>
        <div className="flex flex-wrap gap-1 mb-2">
          {genrePrefs.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border"
              style={{ backgroundColor: p.value > 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                borderColor: p.value > 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)",
                color: p.value > 0 ? "#22c55e" : "#ef4444" }}>
              {p.tag} ({p.value > 0 ? "+" : ""}{p.value})
              <button onClick={() => setGenrePrefs(genrePrefs.filter((_, j) => j !== i))} className="font-bold">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1 items-center relative">
          <div className="relative">
            <input type="text" value={newGenrePrefTag} onChange={(e) => setNewGenrePrefTag(e.target.value)}
              placeholder="e.g. Metroidvania" className="w-40 bg-background border border-border rounded px-1.5 py-0.5 text-[10px]" />
            {newGenrePrefTag.length > 0 && (() => {
              const q = newGenrePrefTag.toLowerCase();
              const matches = allGenreNames.filter(n => n.toLowerCase().includes(q)).slice(0, 10);
              if (matches.length === 0) return null;
              return (
                <div className="absolute z-50 top-full left-0 mt-0.5 bg-surface border border-border rounded shadow-lg max-h-32 overflow-y-auto w-48">
                  {matches.map(name => (
                    <button key={name} className="w-full text-left px-2 py-0.5 text-[10px] hover:bg-surface2/50"
                      onMouseDown={(e) => { e.preventDefault(); setNewGenrePrefTag(name); }}>
                      {name}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <input type="number" value={newGenrePrefValue} onChange={(e) => setNewGenrePrefValue(Number(e.target.value))}
            className="w-14 bg-background border border-border rounded px-1 py-0.5 text-[10px] text-center" />
          <button onClick={() => {
            if (newGenrePrefTag.trim()) {
              setGenrePrefs([...genrePrefs, { tag: newGenrePrefTag.trim(), value: newGenrePrefValue }]);
              setNewGenrePrefTag("");
            }
          }} className="text-[10px] text-amber-400 hover:underline">+ Add</button>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={async () => {
          save();
          appendLog("Recalculating recommendation scores...");
          const res = await fetch("/api/play-next");
          const data = await res.json();
          appendLog(`Scored ${data.games?.length || 0} games. Profile: ${data.profile?.playedCount || 0} played.`);
        }} className="px-3 py-1.5 rounded text-xs border border-accent/50 text-accent hover:bg-accent/10">💾 Save & Recalculate</button>
        <button onClick={reset} className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground">↺ Reset defaults</button>
        <button onClick={async () => {
          const res = await fetch("/api/play-next");
          const data = await res.json();
          setProfileData(data.profile);
        }} className="px-3 py-1.5 rounded text-xs border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10">👤 View Profile</button>
      </div>
      {profileData && (
        <div className="mt-3 bg-background rounded border border-border p-3 text-[11px] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-cyan-400 font-medium">Your Preference Profile ({profileData.playedCount} played games)</span>
            <button onClick={() => setProfileData(null)} className="text-muted text-[9px]">✕</button>
          </div>
          <div className="grid grid-cols-3 gap-3 max-h-48 overflow-y-auto">
            <div>
              <span className="text-muted block mb-1">Genres</span>
              {profileData.genres?.map((g: { name: string; weight: number }) => (
                <div key={g.name} className="flex justify-between"><span>{g.name}</span><span className="text-green-400">{g.weight}%</span></div>
              ))}
            </div>
            <div>
              <span className="text-muted block mb-1">Developers</span>
              {profileData.devs?.map((d: { name: string; weight: number }) => (
                <div key={d.name} className="flex justify-between"><span className="truncate">{d.name}</span><span className="text-purple-400">{d.weight}%</span></div>
              ))}
            </div>
            <div>
              <span className="text-muted block mb-1">Community Tags</span>
              {profileData.ctags?.map((t: { name: string; weight: number }) => (
                <div key={t.name} className="flex justify-between"><span>{t.name}</span><span className="text-cyan-400">{t.weight}%</span></div>
              ))}
            </div>
          </div>
          <p className="text-[9px] text-muted pt-1 border-t border-border/50">
            Games are scored against this profile. Genre/dev/community tag match = how similar a candidate is to your played games. Score quality favors 70-85%. Maturity favors older releases. Waiting nudges games sitting in your library.
          </p>
        </div>
      )}
    </div>
  );
}

function SystemLog() {
  const [logs, setLogs] = useState<{ ts: string; level: string; msg: string }[]>([]);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/logs").then(r => r.json()).then(setLogs).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const levelColor: Record<string, string> = {
    ERROR: "text-red-400", SYSTEM: "text-cyan-400", INFO: "text-blue-400", DEBUG: "text-gray-500", AUDIT: "text-amber-400",
  };

  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold cursor-pointer" onClick={() => setExpanded(!expanded)}>
          {expanded ? "▾" : "▸"} System Log ({logs.length})
        </h2>
        <div className="flex gap-2">
          <button onClick={refresh} className="text-[10px] text-muted hover:text-foreground">↻ Refresh</button>
          <button onClick={() => { fetch("/api/logs", { method: "DELETE" }).then(refresh); }}
            className="text-[10px] text-danger hover:underline">Clear</button>
        </div>
      </div>
      {expanded && (
        <div className="bg-background rounded border border-border p-2 max-h-64 min-h-[60px] overflow-y-auto font-mono text-[11px] space-y-0.5 resize-y">
          {logs.length === 0 ? (
            <div className="text-muted text-center py-4">No log entries</div>
          ) : logs.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted shrink-0">{l.ts}</span>
              <span className={`shrink-0 w-12 ${levelColor[l.level] || "text-muted"}`}>{l.level}</span>
              <span className="text-foreground break-all">{l.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagManager() {
  const [tags, setTags] = useState<{ id: number; name: string; color: string }[]>([]);
  const [subtags, setSubtags] = useState<SubtagRow[]>([]);
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("");
  const [editingSub, setEditingSub] = useState<number | null>(null);
  const [editSubName, setEditSubName] = useState("");
  const [editSubType, setEditSubType] = useState<string>("genre");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [showNewTag, setShowNewTag] = useState(false);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then(setTags);
    fetch("/api/subtags").then((r) => r.json()).then(setSubtags);
  }, []);

  const startEditTag = (tag: { id: number; name: string; color: string }) => {
    setEditingTag(tag.id); setEditTagName(tag.name); setEditTagColor(tag.color);
  };
  const saveTag = async () => {
    if (!editingTag) return;
    await fetch(`/api/tags/${editingTag}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editTagName, color: editTagColor }) });
    setTags((prev) => prev.map((t) => t.id === editingTag ? { ...t, name: editTagName, color: editTagColor } : t));
    setEditingTag(null);
  };
  const startEditSub = (sub: SubtagRow) => {
    setEditingSub(sub.id); setEditSubName(sub.name); setEditSubType(sub.type);
  };
  const saveSub = async () => {
    if (!editingSub) return;
    await fetch(`/api/subtags/${editingSub}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editSubName, type: editSubType }) });
    setSubtags((prev) => prev.map((s) => s.id === editingSub ? { ...s, name: editSubName, type: editSubType } : s));
    setEditingSub(null);
  };
  const toggleExpand = (id: number) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const createTag = async () => {
    if (!newTagName.trim()) return;
    const res = await fetch("/api/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }) });
    if (res.ok) { const tag = await res.json(); setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name))); setNewTagName(""); setShowNewTag(false); }
    else { const err = await res.json(); alert(err.error || "Failed to create tag"); }
  };

  return (
    <div className="bg-surface rounded-lg p-4 border border-border">
      <h2 className="text-sm font-medium mb-3">Tags & Subtags</h2>
      <p className="text-xs text-muted mb-3">Click a tag to edit name/color. Expand to see and edit subtags (rename, change genre/meta type).</p>
      {showNewTag ? (
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded bg-surface2/30 border border-accent/30">
          <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
          <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name"
            onKeyDown={(e) => { if (e.key === "Enter") createTag(); if (e.key === "Escape") setShowNewTag(false); }}
            className="flex-1 bg-background border border-border rounded px-2 py-0.5 text-sm focus:outline-none focus:border-accent" autoFocus />
          <button onClick={createTag} className="text-xs text-green-400 hover:underline">Create</button>
          <button onClick={() => setShowNewTag(false)} className="text-xs text-muted hover:underline">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setShowNewTag(true)} className="mb-3 px-3 py-1 rounded text-xs border border-border text-muted hover:text-foreground hover:border-accent transition-colors">+ New Tag</button>
      )}
      {/* Tag sidebar order */}
      <div className="space-y-1">
        {tags.map((tag, tagIdx) => {
          const tagSubs = subtags.filter((s) => s.tag_id === tag.id);
          const isExpanded = expanded.has(tag.id);
          return (
            <div key={tag.id}>
              <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface2/30">
                <div className="flex flex-col shrink-0">
                  <button disabled={tagIdx === 0} onClick={() => { const arr = [...tags]; [arr[tagIdx-1], arr[tagIdx]] = [arr[tagIdx], arr[tagIdx-1]]; setTags(arr); }}
                    className="text-[7px] text-muted hover:text-foreground disabled:opacity-20 leading-none">▲</button>
                  <button disabled={tagIdx === tags.length - 1} onClick={() => { const arr = [...tags]; [arr[tagIdx], arr[tagIdx+1]] = [arr[tagIdx+1], arr[tagIdx]]; setTags(arr); }}
                    className="text-[7px] text-muted hover:text-foreground disabled:opacity-20 leading-none">▼</button>
                </div>
                {editingTag === tag.id ? (
                  <>
                    <input type="color" value={editTagColor} onChange={(e) => setEditTagColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent" />
                    <input type="text" value={editTagName} onChange={(e) => setEditTagName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTag(); if (e.key === "Escape") setEditingTag(null); }}
                      className="flex-1 bg-background border border-accent rounded px-2 py-0.5 text-sm focus:outline-none" autoFocus />
                    <button onClick={saveTag} className="text-xs text-green-400 hover:underline">Save</button>
                    <button onClick={() => setEditingTag(null)} className="text-xs text-muted hover:underline">Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => toggleExpand(tag.id)} className="text-[10px] text-muted w-4">{tagSubs.length > 0 ? (isExpanded ? "▼" : "▶") : "·"}</button>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1 text-sm cursor-pointer hover:text-accent" onClick={() => startEditTag(tag)}>{tag.name}</span>
                    <span className="text-[10px] text-muted">{tagSubs.length} subtags</span>
                    <button onClick={() => startEditTag(tag)} className="text-[10px] text-muted hover:text-foreground">✏️</button>
                  </>
                )}
              </div>
              {/* Subtags */}
              {isExpanded && tagSubs.length > 0 && (
                <div className="ml-8 space-y-0.5 mb-1">
                  {tagSubs.map((sub) => (
                    <div key={sub.id} className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-surface2/20 text-xs">
                      {editingSub === sub.id ? (
                        <>
                          <input type="text" value={editSubName} onChange={(e) => setEditSubName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveSub(); if (e.key === "Escape") setEditingSub(null); }}
                            className="flex-1 bg-background border border-accent rounded px-2 py-0.5 text-xs focus:outline-none" autoFocus />
                          <select value={editSubType} onChange={(e) => setEditSubType(e.target.value)}
                            className="bg-background border border-border rounded px-1 py-0.5 text-[10px]">
                            <option value="genre">genre</option>
                            <option value="meta">meta</option>
                          </select>
                          <button onClick={saveSub} className="text-green-400 hover:underline">Save</button>
                          <button onClick={() => setEditingSub(null)} className="text-muted hover:underline">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${sub.type === "genre" ? "bg-blue-500/20 text-blue-300" : "bg-orange-500/20 text-orange-300"}`}>{sub.type}</span>
                          <span className="flex-1 cursor-pointer hover:text-accent" onClick={() => startEditSub(sub)}>{sub.name}</span>
                          <button onClick={() => startEditSub(sub)} className="text-muted hover:text-foreground">✏️</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={() => {
        const order = tags.map(t => t.id);
        localStorage.setItem("gm_tag_order", JSON.stringify(order));
        fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "tag_order", value: JSON.stringify(order) }) });
      }} className="mt-2 text-[10px] text-accent hover:underline">💾 Save sidebar order</button>
    </div>
  );
}

function ShareLinks({ lanIps }: { lanIps: string[] }) {
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [newName, setNewName] = useState("");
  const [newFilterJson, setNewFilterJson] = useState("{}");
  const [expiryDays, setExpiryDays] = useState<number>(0);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined"
    ? (lanIps.length > 0 ? `http://${lanIps[0]}:3000` : window.location.origin)
    : "";

  const load = () => {
    fetch("/api/share").then(r => r.json()).then((rows: ShareToken[]) => setTokens(rows)).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("share_filter") : null;
    if (raw) { try { setNewFilterJson(raw); } catch { /* ignore */ } }
  }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filter_json: newFilterJson, expires_in_days: expiryDays || undefined }),
      });
      if (res.ok) { setNewName(""); setNewFilterJson("{}"); load(); }
    } finally { setCreating(false); }
  };

  const revoke = async (token: string) => {
    if (!confirm("Revoke this share link? It will stop working immediately.")) return;
    await fetch(`/api/share/${token}`, { method: "DELETE" });
    load();
  };

  const copyUrl = async (token: string) => {
    const url = `${baseUrl}/share/${token}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const EXPIRY_OPTIONS = [
    { label: "Never", value: 0 },
    { label: "7 days", value: 7 },
    { label: "30 days", value: 30 },
    { label: "90 days", value: 90 },
  ];

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-muted">Collection name</span>
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. My Wishlist"
            className="bg-background border border-border rounded px-2 py-1 text-xs w-44 focus:outline-none focus:border-accent"
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-muted">Expires</span>
          <select value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-accent">
            {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <span className="text-[10px] text-muted">Filter JSON <span className="text-muted/50">(paste from Share button on main page, or leave {"{}"} for all games)</span></span>
          <input
            type="text" value={newFilterJson} onChange={(e) => setNewFilterJson(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent"
          />
        </label>
        <button
          onClick={create} disabled={creating || !newName.trim()}
          className="px-3 py-1.5 rounded text-xs bg-accent/20 border border-accent text-accent hover:bg-accent/30 disabled:opacity-50"
        >{creating ? "Creating…" : "Create Link"}</button>
      </div>

      {/* Token list */}
      {tokens.length > 0 && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface2 text-muted text-left">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t, i) => (
                <tr key={t.token} className={i % 2 === 0 ? "bg-background/50" : ""}>
                  <td className="px-3 py-2 font-medium">{t.name}</td>
                  <td className="px-3 py-2 text-muted">{t.created_at.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-muted">{t.expires_at || "Never"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <a href={`/share/${t.token}`} target="_blank" rel="noreferrer"
                        className="text-accent hover:underline font-mono">/share/{t.token}</a>
                      <button onClick={() => copyUrl(t.token)}
                        className="text-[10px] text-muted hover:text-accent">
                        {copied === t.token ? "✓ Copied" : "📋 Copy"}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => revoke(t.token)}
                      className="text-[10px] text-danger hover:text-red-400">Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tokens.length === 0 && (
        <p className="text-xs text-muted">No share links yet.</p>
      )}
    </div>
  );
}

function SteamDbImport() {
  const [payload, setPayload] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const bookmarklet = `javascript:(()=>{const app=document.querySelector('.scope-app');const appid=app?.dataset.appid||location.pathname.match(/app\\/(\\d+)/)?.[1];const cell=(label)=>{const row=[...document.querySelectorAll('.table tr')].find((tr)=>tr.querySelector('td')?.textContent?.trim().startsWith(label));return row?.querySelectorAll('td')[1]?.textContent?.trim()||''};const values=(selector)=>[...document.querySelectorAll(selector)].map((el)=>el.getAttribute('content')||el.textContent?.trim()||'').filter(Boolean);const data={source:'steamdb-bookmarklet',appid:Number(appid),name:document.querySelector('h1[itemprop=name]')?.textContent?.trim()||'',developers:values('[itemprop=author]'),publishers:values('[itemprop=publisher]'),release_date:document.querySelector('relative-time[itemprop=datePublished]')?.getAttribute('content')||cell('Release Date'),features:[...document.querySelectorAll('.header-thing-categories a[aria-label]')].map((el)=>el.getAttribute('aria-label')).filter(Boolean),community_tags:[...document.querySelectorAll('.header-app-tags a')].map((el)=>(el.textContent||'').replace(/^\\S+\\s*/,'').trim()).filter(Boolean),header_image:document.querySelector('.app-logo[itemprop=image]')?.getAttribute('src')||''};navigator.clipboard.writeText(JSON.stringify(data,null,2)).then(()=>alert('SteamDB metadata copied. Paste it into Steam Game Manager.')).catch(()=>prompt('Copy this metadata:',JSON.stringify(data,null,2)))})();`;

  const copyBookmarklet = async () => {
    await navigator.clipboard.writeText(bookmarklet);
    setStatus("Bookmarklet copied. Create a browser bookmark and paste it as its URL.");
  };

  const pasteClipboard = async () => {
    try { setPayload(await navigator.clipboard.readText()); } catch { setStatus("Clipboard access was denied. Paste the copied JSON manually."); }
  };

  const importMetadata = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { setStatus("The pasted data is not valid JSON."); return; }
    setImporting(true);
    setStatus(null);
    try {
      const response = await fetch("/api/steamdb/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "SteamDB metadata import failed.");
      setStatus(`Imported SteamDB metadata for App ID ${body.appid}${body.header_downloaded ? " and downloaded its header" : ""}.`);
      setPayload("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SteamDB metadata import failed.");
    } finally { setImporting(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button onClick={copyBookmarklet} className="px-3 py-1.5 rounded text-xs border border-accent text-accent hover:bg-accent/10">📋 Copy Bookmarklet</button>
        <button onClick={pasteClipboard} className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground">Paste Clipboard</button>
        <button onClick={importMetadata} disabled={importing || !payload.trim()} className="px-3 py-1.5 rounded text-xs border border-green-500/50 text-green-400 hover:bg-green-500/10 disabled:opacity-50">{importing ? "Importing…" : "Import Metadata"}</button>
      </div>
      <p className="text-[10px] text-muted">Copy the bookmarklet, save it as a browser bookmark, run it on a SteamDB app page, then paste its JSON here.</p>
      <textarea value={payload} onChange={(event) => setPayload(event.target.value)} rows={4} placeholder='Paste SteamDB bookmarklet JSON here'
        className="w-full bg-background border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-accent" />
      {status && <p className="text-xs text-muted">{status}</p>}
    </div>
  );
}

function FriendLibraries() {
  const [friends, setFriends] = useState<{ steam_id: string; persona_name: string; fetched_at: string }[]>([]);
  const [steamId, setSteamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    fetch("/api/compare").then((response) => response.ok ? response.json() : []).then(setFriends).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const refresh = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ steam_id: id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to fetch this Steam library.");
      setSteamId("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to fetch this Steam library.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this cached friend library?")) return;
    await fetch(`/api/compare?steam_id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input value={steamId} onChange={(event) => setSteamId(event.target.value)} placeholder="17-digit Steam ID" inputMode="numeric"
          className="flex-1 min-w-48 bg-background border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent" />
        <button onClick={() => refresh(steamId.trim())} disabled={loading || !steamId.trim()}
          className="px-3 py-1.5 rounded text-xs bg-accent/20 border border-accent text-accent hover:bg-accent/30 disabled:opacity-50">{loading ? "Fetching…" : "Add / Refresh"}</button>
        <Link href="/compare" className="px-3 py-1.5 rounded text-xs border border-border text-muted hover:text-foreground">Open Comparison</Link>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {friends.length > 0 ? (
        <div className="space-y-1">
          {friends.map((friend) => <div key={friend.steam_id} className="flex items-center gap-2 text-xs bg-background/50 border border-border rounded px-2 py-1.5">
            <span className="flex-1">{friend.persona_name}</span>
            <span className="text-[10px] text-muted">Updated {friend.fetched_at}</span>
            <button onClick={() => refresh(friend.steam_id)} disabled={loading} className="text-[10px] text-accent hover:underline">Refresh</button>
            <button onClick={() => remove(friend.steam_id)} className="text-[10px] text-red-400 hover:underline">Remove</button>
          </div>)}
        </div>
      ) : <p className="text-xs text-muted">No cached friend libraries.</p>}
    </div>
  );
}
