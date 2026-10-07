import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function hasFailedAppDetails(value: string | null, appid: number): boolean {
  if (!value) return false;
  try {
    const data = JSON.parse(value) as Record<string, { success?: boolean }>;
    return data[String(appid)]?.success === false;
  } catch { return false; }
}

/**
 * GET /api/sync/metadata/failed?format=appids|csv|json|steamdb
 * Returns the list of games whose cached appdetails response is {"success":false}.
 */
export async function GET(req: NextRequest) {
  const db = getDb();
  const format = req.nextUrl.searchParams.get("format") || "appids";

  const rows = db.prepare(`
    SELECT sc.appid, g.name, sc.appdetails
    FROM steam_cache sc
    LEFT JOIN games g ON g.steam_appid = sc.appid
    WHERE sc.appdetails IS NOT NULL AND sc.appdetails != ''
  `).all() as { appid: number; name: string | null; appdetails: string }[];

  const failed = rows
    .filter((r) => hasFailedAppDetails(r.appdetails, r.appid))
    .map((r) => ({ appid: r.appid, name: r.name || `App ${r.appid}`, url: `https://steamdb.info/app/${r.appid}` }));

  switch (format) {
    case "json":
      return NextResponse.json({ total: failed.length, games: failed });
    case "csv": {
      const csv = failed.map((g) => `${g.appid},"${g.name.replace(/"/g, '""')}",${g.url}`);
      return new Response(
        ["appid,name,steamdb", ...csv].join("\n"),
        { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=failed-appdetails.csv" } },
      );
    }
    case "steamdb":
      return new Response(failed.map((g) => g.url).join("\n"), {
        headers: { "Content-Type": "text/plain" },
      });
    case "appids":
    default:
      return new Response(failed.map((g) => g.appid).join("\n"), {
        headers: { "Content-Type": "text/plain" },
      });
  }
}
