/** Shared in-memory ring buffer for UI-visible logs. No dependencies. */
const MAX_ENTRIES = 200;

export interface LogEntry { ts: string; level: string; msg: string }

const buffer: LogEntry[] = [];

export function pushLog(level: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  buffer.push({ ts, level, msg });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export function getLogBuffer(): LogEntry[] { return buffer; }
export function clearLogBuffer() { buffer.length = 0; }
