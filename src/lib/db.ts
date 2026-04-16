import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { generateTxt, generateCsv } from "./export";
import { pushLog } from "./log-buffer";

/** Log to both console and UI buffer */
function dbLog(msg: string) { pushLog("SYSTEM", msg); console.log(`[db] ${msg}`); }

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "games.db");
const BACKUP_DIR = path.join(DB_DIR, "backups");

let db: Database.Database | null = null;

// Snapshot at startup for diff on exit
let startSnapshot: { gameCount: number; gameIds: Set<number>; tagCount: number; updated_at: string } | null = null;

function takeSnapshot(d: Database.Database) {
  const games = d.prepare("SELECT id FROM games").all() as { id: number }[];
  const tagCount = (d.prepare("SELECT COUNT(*) as c FROM game_tags").get() as { c: number }).c;
  const latest = (d.prepare("SELECT MAX(updated_at) as u FROM games").get() as { u: string | null })?.u || "";
  return { gameCount: games.length, gameIds: new Set(games.map(g => g.id)), tagCount, updated_at: latest };
}

function computeDelta(d: Database.Database): string[] {
  if (!startSnapshot) return [];
  const now = takeSnapshot(d);
  const lines: string[] = [];
  const added = [...now.gameIds].filter(id => !startSnapshot!.gameIds.has(id));
  const removed = [...startSnapshot.gameIds].filter(id => !now.gameIds.has(id));
  if (added.length > 0) {
    const names = d.prepare(`SELECT id, name FROM games WHERE id IN (${added.join(",")})`).all() as { id: number; name: string }[];
    lines.push(`Games added (${added.length}): ${names.map(g => `${g.name} [${g.id}]`).join(", ")}`);
  }
  if (removed.length > 0) lines.push(`Games removed (${removed.length}): IDs ${removed.join(", ")}`);
  if (now.gameCount === startSnapshot.gameCount && added.length === 0 && removed.length === 0 && now.updated_at !== startSnapshot.updated_at) {
    lines.push(`Games updated (updated_at changed: ${startSnapshot.updated_at} → ${now.updated_at})`);
  }
  const tagDiff = now.tagCount - startSnapshot.tagCount;
  if (tagDiff !== 0) lines.push(`Tag assignments: ${tagDiff > 0 ? "+" : ""}${tagDiff} (${startSnapshot.tagCount} → ${now.tagCount})`);
  return lines;
}

/** Flush WAL + backup if changes detected. Returns { backed_up, delta, backup_file } */
export function flushAndBackup(opts?: { force?: boolean }): { backed_up: boolean; delta: string[]; backup_file?: string } {
  const d = getDb();
  const delta = computeDelta(d);
  d.pragma("wal_checkpoint(TRUNCATE)");
  const force = opts?.force ?? false;
  if (!force && delta.length === 0) return { backed_up: false, delta };
  const ts = new Date(Date.now() + 5.5 * 3600000).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseDir = force ? path.join(BACKUP_DIR, "manual") : path.join(BACKUP_DIR, "auto");
  const backupFolder = path.join(baseDir, ts);
  if (!fs.existsSync(backupFolder)) fs.mkdirSync(backupFolder, { recursive: true });
  // Copy DB
  fs.copyFileSync(DB_PATH, path.join(backupFolder, "games.db"));
  // Write delta log
  if (delta.length > 0) fs.writeFileSync(path.join(backupFolder, "delta.log"), delta.join("\n") + "\n");
  // Export TXT and CSV
  try {
    fs.writeFileSync(path.join(backupFolder, "games.txt"), generateTxt(d));
    fs.writeFileSync(path.join(backupFolder, "games.csv"), generateCsv(d));
  } catch (e) { console.error("[db] Export during backup failed:", e); }
  // Keep only last N backups per folder
  let maxBackups = 5;
  try {
    const row = d.prepare("SELECT value FROM settings WHERE key = 'max_backups'").get() as { value: string } | undefined;
    if (row) maxBackups = Math.max(1, parseInt(row.value) || 5);
  } catch {}
  if (fs.existsSync(baseDir)) {
    const backups = fs.readdirSync(baseDir).filter(f => {
      try { return fs.statSync(path.join(baseDir, f)).isDirectory(); } catch { return false; }
    }).sort();
    while (backups.length > maxBackups) {
      const old = backups.shift()!;
      fs.rmSync(path.join(baseDir, old), { recursive: true, force: true });
    }
  }
  // Reset snapshot so next flush compares from this point
  startSnapshot = takeSnapshot(d);
  return { backed_up: true, delta, backup_file: ts };
}

export function resetDb(): void {
  if (db) { db.close(); db = null; }
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

export function reinitDb(): void {
  if (db) { db.close(); db = null; }
  getDb();
}

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const start = Date.now();
  dbLog("Initializing database...");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  initSchema(db);
  startSnapshot = takeSnapshot(db);
  dbLog(`Ready in ${Date.now() - start}ms (${startSnapshot.gameCount} games)`);

  // Flush WAL + backup + close DB on process exit (Ctrl+C, kill, etc.)
  const cleanup = () => {
    if (db) {
      try {
        flushAndBackup();
        db.close();
        dbLog("WAL flushed and DB closed.");
      } catch (e) { console.error("[db] Cleanup error:", e); }
      db = null;
    }
  };
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);

  // Periodic WAL flush every 5 minutes (covers Windows where SIGINT may not fire)
  const flushInterval = setInterval(() => {
    if (db) {
      try { db.pragma("wal_checkpoint(PASSIVE)"); } catch {}
    }
  }, 5 * 60 * 1000);
  flushInterval.unref(); // don't keep process alive just for this

  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'genre',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(tag_id, name)
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      steam_appid INTEGER,
      steam_image_url TEXT,
      description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      steam_genres TEXT DEFAULT '[]',
      steam_features TEXT DEFAULT '[]',
      community_tags TEXT DEFAULT '[]',
      developers TEXT DEFAULT '',
      publishers TEXT DEFAULT '',
      release_date TEXT DEFAULT '',
      review_sentiment TEXT DEFAULT '',
      positive_percent INTEGER DEFAULT 0,
      total_reviews INTEGER DEFAULT 0,
      metacritic_score INTEGER DEFAULT 0,
      screenshots TEXT DEFAULT '[]',
      movies TEXT DEFAULT '[]',
      total_screenshots INTEGER DEFAULT 0,
      total_movies INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS game_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      subtag_id INTEGER,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
      FOREIGN KEY (subtag_id) REFERENCES subtags(id) ON DELETE SET NULL,
      UNIQUE(game_id, tag_id, subtag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
    CREATE INDEX IF NOT EXISTS idx_game_tags_game ON game_tags(game_id);
    CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags(tag_id);
  `);

  // Migration: add type column to subtags if missing
  const cols = db.prepare("PRAGMA table_info(subtags)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "type")) {
    db.exec("ALTER TABLE subtags ADD COLUMN type TEXT DEFAULT 'genre'");
  }

  // Migration: add movies column to games if missing
  const gameCols = db.prepare("PRAGMA table_info(games)").all() as { name: string }[];
  if (!gameCols.some((c) => c.name === "movies")) {
    db.exec("ALTER TABLE games ADD COLUMN movies TEXT DEFAULT '[]'");
  }

  // Migration: add total_screenshots / total_movies columns
  if (!gameCols.some((c) => c.name === "total_screenshots")) {
    db.exec("ALTER TABLE games ADD COLUMN total_screenshots INTEGER DEFAULT 0");
  }
  if (!gameCols.some((c) => c.name === "total_movies")) {
    db.exec("ALTER TABLE games ADD COLUMN total_movies INTEGER DEFAULT 0");
  }
  if (!gameCols.some((c) => c.name === "wishlist_date")) {
    db.exec("ALTER TABLE games ADD COLUMN wishlist_date TEXT");
  }

  // Migration: add added_at column + backfill from wishlist_date
  if (!gameCols.some((c) => c.name === "added_at")) {
    db.exec("ALTER TABLE games ADD COLUMN added_at TEXT");
    // Backfill: copy existing wishlist_date (which has real+fallback mix) into added_at
    db.exec("UPDATE games SET added_at = wishlist_date WHERE wishlist_date IS NOT NULL AND wishlist_date != ''");
    // For any remaining NULLs, use today's date
    const today = new Date().toISOString().split("T")[0];
    db.prepare("UPDATE games SET added_at = ? WHERE added_at IS NULL OR added_at = ''").run(today);
  }

  // Migration: add queue_position column for custom play ordering
  if (!gameCols.some((c) => c.name === "queue_position")) {
    db.exec("ALTER TABLE games ADD COLUMN queue_position REAL");
  }

  // Migration: add user_rating column (1-10 personal rating for recommendation weighting)
  if (!gameCols.some((c) => c.name === "user_rating")) {
    db.exec("ALTER TABLE games ADD COLUMN user_rating REAL");
  }

  // Startup: sync total_screenshots/total_movies from disk
  syncAssetCounts(db);

  // Pre-migration backup (only if any migration will actually run)
  const needsDevPubMigration = (() => {
    const s = db.prepare("SELECT developers FROM games WHERE developers != '' AND developers IS NOT NULL LIMIT 1").get() as { developers: string } | undefined;
    return s && !s.developers.startsWith("[");
  })();
  const needsAutoTagMigration = (() => {
    const old = db.prepare("SELECT id FROM tags WHERE name IN ('release','sentiment','score') LIMIT 1").get();
    return !!old;
  })();
  if (needsDevPubMigration || needsAutoTagMigration) {
    const backupDir = path.join(DB_DIR, "backups", "pre-migration");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(backupDir, `games_${ts}.db`);
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(DB_PATH, dest);
    dbLog(`Pre-migration backup: ${dest}`);
  }

  // Migration: convert developers/publishers from comma-separated to JSON arrays
  migrateDevPubToJson(db);

  // Migration: merge old separate release/sentiment/score tags into unified "auto" tag
  migrateAutoTags(db);
}

function migrateDevPubToJson(db: Database.Database) {
  // Check if already migrated: if any developer field starts with "[", assume done
  const sample = db.prepare("SELECT developers FROM games WHERE developers != '' AND developers IS NOT NULL LIMIT 1").get() as { developers: string } | undefined;
  if (!sample || sample.developers.startsWith("[")) return;

  dbLog("Migrating developers/publishers to JSON arrays...");

  // Check if steam_cache table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='steam_cache'").get();
  if (!tables) { dbLog("No steam_cache table, skipping migration."); return; }

  const games = db.prepare("SELECT id, steam_appid FROM games WHERE steam_appid IS NOT NULL").all() as { id: number; steam_appid: number }[];
  const getCache = db.prepare("SELECT appdetails FROM steam_cache WHERE appid = ?");
  const update = db.prepare("UPDATE games SET developers = ?, publishers = ? WHERE id = ?");

  let migrated = 0;
  const tx = db.transaction(() => {
    for (const g of games) {
      const cached = getCache.get(g.steam_appid) as { appdetails: string } | undefined;
      if (!cached) continue;
      try {
        const det = JSON.parse(cached.appdetails) as Record<string, { success: boolean; data?: { developers?: string[]; publishers?: string[] } }>;
        const data = det?.[String(g.steam_appid)]?.data;
        if (!data) continue;
        const devs = JSON.stringify(data.developers || []);
        const pubs = JSON.stringify(data.publishers || []);
        update.run(devs, pubs, g.id);
        migrated++;
      } catch { /* skip */ }
    }
  });
  tx();
  dbLog(`Migrated ${migrated}/${games.length} games to JSON arrays.`);
}

/** Ensure "steam" L0 tag with subtags: wishlist, removed_from_wishlist, owned, ignored, played_elsewhere */
export function ensureSteamTag(db: Database.Database): {
  tagId: number;
  subtags: Record<string, number>;
} {
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES ('steam', '#66c0f4')").run();
  const tag = db.prepare("SELECT id FROM tags WHERE name = 'steam'").get() as { id: number };
  const names = ["wishlist", "removed_from_wishlist", "owned", "ignored", "played_elsewhere"];
  const subtags: Record<string, number> = {};
  for (const name of names) {
    const stype = (name === "wishlist" || name === "owned") ? "meta" : "meta";
    db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, ?)").run(tag.id, name, stype);
    const row = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ?").get(tag.id, name) as { id: number };
    subtags[name] = row.id;
  }
  return { tagId: tag.id, subtags };
}

function syncAssetCounts(db: Database.Database) {
  const ASSETS_DIR = path.join(process.cwd(), "data", "assets", "games");
  if (!fs.existsSync(ASSETS_DIR)) return;

  // Skip if counts are already populated (not a fresh DB) — run manually via Settings > Re-init DB
  const hasAny = db.prepare("SELECT 1 FROM games WHERE total_screenshots > 0 OR total_movies > 0 LIMIT 1").get();
  if (hasAny) { dbLog("Asset counts already populated, skipping scan."); return; }

  const games = db.prepare("SELECT id, steam_appid FROM games").all() as { id: number; steam_appid: number | null }[];
  const update = db.prepare("UPDATE games SET total_screenshots = ?, total_movies = ? WHERE id = ? AND (total_screenshots != ? OR total_movies != ?)");

  let changed = 0;
  const tx = db.transaction(() => {
    for (const g of games) {
      const dir = path.join(ASSETS_DIR, String(g.steam_appid || `manual_${g.id}`));
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      const ss = files.filter((f) => /^ss_\d+\.jpg$/.test(f)).length;
      const mov = files.filter((f) => f.endsWith(".mp4")).length;
      const r = update.run(ss, mov, g.id, ss, mov);
      if (r.changes > 0) changed++;
    }
  });
  tx();
  const scanned = games.filter(g => fs.existsSync(path.join(ASSETS_DIR, String(g.steam_appid || `manual_${g.id}`)))).length;
  dbLog(`Asset scan: ${scanned} games checked, ${changed} updated`);
}

/** Migrate old separate release/sentiment/score L0 tags into unified "auto" tag */
function migrateAutoTags(db: Database.Database) {
  const oldNames = ["release", "sentiment", "score"];
  // Check if any old tags exist
  const oldTags = db.prepare(`SELECT id, name FROM tags WHERE name IN (${oldNames.map(() => "?").join(",")})`).all(...oldNames) as { id: number; name: string }[];
  if (oldTags.length === 0) return;

  // Check if "auto" tag already has subtags (already migrated)
  const autoTag = db.prepare("SELECT id FROM tags WHERE name = 'auto'").get() as { id: number } | undefined;
  if (autoTag) {
    const autoSubs = db.prepare("SELECT COUNT(*) as c FROM subtags WHERE tag_id = ?").get(autoTag.id) as { c: number };
    if (autoSubs.c > 0) return; // already migrated
  }

  dbLog("Migrating release/sentiment/score tags into unified 'auto' tag...");

  // Ensure auto tag
  db.prepare("INSERT OR IGNORE INTO tags (name, color) VALUES ('auto', '#f97316')").run();
  const autoId = (db.prepare("SELECT id FROM tags WHERE name = 'auto'").get() as { id: number }).id;

  let migrated = 0;
  const tx = db.transaction(() => {
    for (const oldTag of oldTags) {
      const typeMap: Record<string, string> = { release: "release", sentiment: "sentiment", score: "score" };
      const newType = typeMap[oldTag.name] || "meta";

      // Get old subtags
      const oldSubs = db.prepare("SELECT id, name FROM subtags WHERE tag_id = ?").all(oldTag.id) as { id: number; name: string }[];

      for (const oldSub of oldSubs) {
        // Create new subtag under auto with the correct type
        db.prepare("INSERT OR IGNORE INTO subtags (tag_id, name, type) VALUES (?, ?, ?)").run(autoId, oldSub.name, newType);
        const newSub = db.prepare("SELECT id FROM subtags WHERE tag_id = ? AND name = ? AND type = ?").get(autoId, oldSub.name, newType) as { id: number };

        // Move game_tags from old subtag to new
        const gameTags = db.prepare("SELECT game_id FROM game_tags WHERE tag_id = ? AND subtag_id = ?").all(oldTag.id, oldSub.id) as { game_id: number }[];
        for (const gt of gameTags) {
          db.prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, subtag_id) VALUES (?, ?, ?)").run(gt.game_id, autoId, newSub.id);
          migrated++;
        }
      }

      // Delete old tag (cascades to subtags and game_tags via FK)
      db.prepare("DELETE FROM game_tags WHERE tag_id = ?").run(oldTag.id);
      db.prepare("DELETE FROM subtags WHERE tag_id = ?").run(oldTag.id);
      db.prepare("DELETE FROM tags WHERE id = ?").run(oldTag.id);
    }
  });
  tx();
  dbLog(`Migrated ${migrated} auto-tag assignments from ${oldTags.map(t => t.name).join(", ")} into 'auto' tag.`);
}

/** Read Steam API key and Steam ID from the settings table */
export function getSteamCredentials(db: Database.Database): { steamId: string; apiKey: string } {
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const get = (key: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || "";
  };
  return { steamId: get("steam_id"), apiKey: get("steam_api_key") };
}
