import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createUser, getUserByUsername, hasUsers, verifyPassword } from "@/lib/auth";
import { signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "AUTH_SECRET not configured" }, { status: 503 });
  }

  const db = getDb();
  const body = await req.json().catch(() => ({})) as { username?: string; password?: string };
  const username = (body.username || "").trim();
  const password = (body.password || "").trim();
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password required" }, { status: 400 });
  }

  let user = getUserByUsername(db, username);
  if (!user) {
    // First-run setup: create the initial admin if no users exist.
    if (!hasUsers(db)) {
      user = createUser(db, username, password, "admin");
    } else {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
  }

  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const hashRow = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string } | undefined;
  if (!hashRow || !verifyPassword(password, hashRow.password_hash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const token = await signSession({ sub: user.id, username: user.username, role: user.role, exp }, secret);

  const res = NextResponse.json({ ok: true, user: { username: user.username, role: user.role }, setup: !hasUsers(db) });
  res.cookies.set("sgm-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}
