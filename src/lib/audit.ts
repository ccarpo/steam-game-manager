import fs from "fs";
import path from "path";
import { pushLog } from "./log-buffer";

const LOG_PATH = path.join(process.cwd(), "data", "audit.log");

/** Append an audit entry to data/audit.log + system log buffer */
export function audit(action: string, detail?: string) {
  const ts = new Date().toISOString();
  const line = detail ? `${ts} [${action}] ${detail}\n` : `${ts} [${action}]\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch {}
  pushLog("AUDIT", `[${action}] ${detail || ""}`);
}
