import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { Database } from "./sqlite";

export type UserRole = "reader" | "user" | "admin";

export interface User {
  id: number;
  username: string;
  role: UserRole;
}

const HASH_PREFIX = "scrypt:";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored.startsWith(HASH_PREFIX)) return false;
  const rest = stored.slice(HASH_PREFIX.length);
  const [salt, hash] = rest.split(":");
  if (!salt || !hash) return false;
  const expected = scryptSync(password, salt, 64);
  const actual = Buffer.from(hash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function getUserByUsername(db: Database, username: string): User | null {
  const row = db.prepare("SELECT id, username, role FROM users WHERE username = ? COLLATE NOCASE").get(username) as
    | { id: number; username: string; role: UserRole }
    | undefined;
  return row || null;
}

export function createUser(db: Database, username: string, password: string, role: UserRole = "admin"): User {
  const hash = hashPassword(password);
  const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(username, hash, role);
  return { id: Number(info.lastInsertRowid), username, role };
}

export function hasUsers(db: Database): boolean {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c > 0;
}
