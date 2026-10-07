import { Database } from "./sqlite";
import { audit } from "./audit";
import { ensureAutoTag, assignAutoSubtag } from "./auto-tags";
import {
  Category, CATEGORY_LABEL, RULES_VERSION, NOT_A_GAME_NAME_PATTERN,
  classifyByRules, confidenceFor, Achievements,
} from "./classifier";

interface ClassificationRow {
  game_id: number;
  category: Category;
  reason: string;
  confidence: string;
  rules_version: number;
  override_category: Category | null;
  override_at: string | null;
}

function mirrorStatusSubtag(db: Database, autoTagId: number, gameId: number, category: Category) {
  assignAutoSubtag(db, autoTagId, "status", gameId, CATEGORY_LABEL[category]);
}

export function classifyGames(
  db: Database,
  opts: { mode: "new" | "all" } | { gameIds: number[] },
): { classified: number; skipped: number; byCategory: Record<Category, number> } {
  const mode = "mode" in opts ? opts.mode : "new";

  // Candidates: games with the steam>owned subtag
  const candidates = db.prepare(
    `SELECT g.*, s.name AS owned_sub FROM games g
     JOIN game_tags gt ON gt.game_id = g.id
     JOIN tags t ON t.id = gt.tag_id AND t.name = 'steam'
     JOIN subtags s ON s.id = gt.subtag_id AND s.name = 'owned'
     ${"gameIds" in opts ? `WHERE g.id IN (${opts.gameIds.map(() => "?").join(",")})` : ""}`
  ).all(...("gameIds" in opts ? opts.gameIds : [])) as {
    id: number; name: string; steam_appid: number | null; playtime_forever: number;
    app_type: string; steam_genres: string; steam_features: string;
  }[];

  const savedRows = db.prepare("SELECT * FROM game_classification").all() as ClassificationRow[];
  const saved = new Map(savedRows.map((r) => [r.game_id, r]));

  const achRows = db.prepare("SELECT * FROM steam_achievements").all() as {
    appid: number; total: number; achieved: number; names_achieved: string; status: string;
  }[];
  const achMap = new Map(achRows.map((r) => [r.appid, r]));

  const upsert = db.prepare(
    `INSERT INTO game_classification (game_id, category, reason, confidence, rules_version, classified_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(game_id) DO UPDATE SET
       category = excluded.category, reason = excluded.reason,
       confidence = excluded.confidence, rules_version = excluded.rules_version,
       classified_at = excluded.classified_at`
  );

  const byCategory: Record<Category, number> = { COMPLETED: 0, IN_PROGRESS: 0, ENDLESS: 0, NOT_A_GAME: 0 };
  let classified = 0, skipped = 0;

  const autoTagId = ensureAutoTag(db);

  const tx = db.transaction(() => {
    for (const g of candidates) {
      const row = saved.get(g.id);

      // Layer 1: manual override always wins
      if (row?.override_category) {
        mirrorStatusSubtag(db, autoTagId, g.id, row.override_category);
        byCategory[row.override_category]++;
        skipped++;
        continue;
      }

      // Layer 1.5: name pattern overrides saved classifications (same reason format as rule 2)
      const nameMatch = g.name.match(NOT_A_GAME_NAME_PATTERN);
      if (nameMatch) {
        const alreadyCorrect = row?.category === "NOT_A_GAME" && row.rules_version === RULES_VERSION;
        if (alreadyCorrect) {
          mirrorStatusSubtag(db, autoTagId, g.id, "NOT_A_GAME");
          byCategory.NOT_A_GAME++;
          skipped++;
          continue;
        }
        const reason = `Rule: Name pattern: ${nameMatch[0]}`;
        upsert.run(g.id, "NOT_A_GAME", reason, confidenceFor(reason), RULES_VERSION);
        mirrorStatusSubtag(db, autoTagId, g.id, "NOT_A_GAME");
        byCategory.NOT_A_GAME++;
        classified++;
        continue;
      }

      // Layer 2: reuse saved classification (mode "new" only)
      if (mode === "new" && row && row.rules_version === RULES_VERSION) {
        mirrorStatusSubtag(db, autoTagId, g.id, row.category);
        byCategory[row.category]++;
        skipped++;
        continue;
      }

      // Layer 3: rules
      const achRow = g.steam_appid != null ? achMap.get(g.steam_appid) : undefined;
      const achievements: Achievements | null =
        achRow && achRow.status === "ok" && achRow.total > 0
          ? {
              total: achRow.total,
              achieved: achRow.achieved,
              percentage: Math.round((achRow.achieved / achRow.total) * 1000) / 10,
              namesAchieved: (() => { try { return JSON.parse(achRow.names_achieved); } catch { return []; } })(),
            }
          : null;

      const genres = safeArr(g.steam_genres);
      const feats = safeArr(g.steam_features);
      const store = g.app_type === "" && genres.length === 0 && feats.length === 0
        ? null
        : { appType: g.app_type || "", genres, categories: feats };

      const { category, reason } = classifyByRules({
        name: g.name,
        playtimeHours: (g.playtime_forever || 0) / 60,
        achievements,
        store,
      });
      const fullReason = `Rule: ${reason}`;
      upsert.run(g.id, category, fullReason, confidenceFor(fullReason), RULES_VERSION);
      mirrorStatusSubtag(db, autoTagId, g.id, category);
      byCategory[category]++;
      classified++;
    }
  });
  tx();

  return { classified, skipped, byCategory };
}

function safeArr(json: string): string[] {
  try { const a = JSON.parse(json || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}

export function setOverride(db: Database, gameId: number, category: Category | null) {
  const existing = db.prepare("SELECT * FROM game_classification WHERE game_id = ?").get(gameId) as ClassificationRow | undefined;
  if (category) {
    db.prepare(
      `INSERT INTO game_classification (game_id, category, reason, confidence, rules_version, override_category, override_at)
       VALUES (?, ?, 'Manual override', 'HIGH', ?, ?, datetime('now'))
       ON CONFLICT(game_id) DO UPDATE SET override_category = excluded.override_category, override_at = excluded.override_at`
    ).run(gameId, existing?.category ?? category, RULES_VERSION, category);
  } else {
    db.prepare("UPDATE game_classification SET override_category = NULL, override_at = NULL WHERE game_id = ?").run(gameId);
  }
  const row = db.prepare("SELECT * FROM game_classification WHERE game_id = ?").get(gameId) as ClassificationRow | undefined;
  const effective = row ? (row.override_category ?? row.category) : category;
  if (effective && row) {
    const autoTagId = ensureAutoTag(db);
    mirrorStatusSubtag(db, autoTagId, gameId, effective);
  }
  audit("classification_override", `game_id=${gameId} override=${category ?? "cleared"}`);
  return row;
}
