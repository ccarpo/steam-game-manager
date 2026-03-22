import { flushAndBackup } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST() {
  try {
    const result = flushAndBackup();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
