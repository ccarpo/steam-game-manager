import { getDb } from "@/lib/db";
import { generateTxt } from "@/lib/export";
import { NextResponse } from "next/server";

export function GET() {
  const txt = generateTxt(getDb());
  return new NextResponse(txt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="games-export-${new Date().toISOString().slice(0, 10)}.txt"`,
    },
  });
}
