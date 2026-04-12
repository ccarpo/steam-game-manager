import { getLogBuffer, clearLogBuffer } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getLogBuffer());
}

export async function DELETE(_req: NextRequest) {
  clearLogBuffer();
  return NextResponse.json({ ok: true });
}
