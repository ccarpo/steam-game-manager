import { NextResponse, NextRequest } from "next/server";
import { verifySession } from "./lib/session";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/health",
  "/favicon.ico",
  "/__nextjs_source-map",
];

const PUBLIC_PREFIXES = ["/_next/static", "/_next/image"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    console.error("[auth] AUTH_SECRET is not set — access is denied.");
    return pathname.startsWith("/api")
      ? NextResponse.json({ error: "AUTH_SECRET not configured" }, { status: 503 })
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const token = request.cookies.get("sgm-session")?.value;
  const session = token ? await verifySession(token, secret) : null;

  if (!session) {
    const res = pathname.startsWith("/api")
      ? NextResponse.json({ error: "unauthenticated" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
    res.cookies.set("sgm-session", "", { maxAge: 0, path: "/" });
    return res;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", String(session.sub));
  requestHeaders.set("x-user-role", session.role);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  logRequest(request, res);
  return res;
}

function logRequest(req: NextRequest, _res: NextResponse) {
  const path = req.nextUrl.pathname;
  if (!path.startsWith("/_next") && !path.startsWith("/favicon")) {
    console.log(`${req.method} ${path} 0ms`);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
