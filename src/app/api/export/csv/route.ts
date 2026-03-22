import { getDb } from "@/lib/db";
import { generateCsv } from "@/lib/export";
import { NextResponse } from "next/server";

export function GET() {
  const csv = generateCsv(getDb());
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="games-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
