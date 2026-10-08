import { getDb } from "@/lib/db";
import { hasUsers } from "@/lib/auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json({ hasUsers: hasUsers(db) });
}
