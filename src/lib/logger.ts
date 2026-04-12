import { getDb } from "./db";
import { pushLog, getLogBuffer, clearLogBuffer } from "./log-buffer";
export type { LogEntry } from "./log-buffer";

export type LogLevel = "off" | "error" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = { off: 0, error: 1, info: 2, debug: 3 };

let cached: { level: LogLevel; ts: number } | null = null;

export { getLogBuffer, clearLogBuffer };

export function getLogLevel(): LogLevel {
  if (cached && Date.now() - cached.ts < 10000) return cached.level;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'log_level'").get() as { value: string } | undefined;
    const level = (row?.value || "error") as LogLevel;
    cached = { level, ts: Date.now() };
    return level;
  } catch {
    return "error";
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] <= LEVELS[getLogLevel()];
}

export const log = {
  error: (...args: unknown[]) => { const msg = args.map(String).join(" "); pushLog("ERROR", msg); if (shouldLog("error")) console.error("[ERROR]", ...args); },
  info: (...args: unknown[]) => { const msg = args.map(String).join(" "); pushLog("INFO", msg); if (shouldLog("info")) console.log("[INFO]", ...args); },
  debug: (...args: unknown[]) => { const msg = args.map(String).join(" "); if (shouldLog("debug")) { pushLog("DEBUG", msg); console.log("[DEBUG]", ...args); } },
  /** Always captured to buffer regardless of log level — for migrations, startup, etc. */
  system: (...args: unknown[]) => { const msg = args.map(String).join(" "); pushLog("SYSTEM", msg); console.log("[SYSTEM]", ...args); },
};
