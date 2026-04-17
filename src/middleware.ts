import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const start = Date.now();
  const res = NextResponse.next();
  const ms = Date.now() - start;
  const path = req.nextUrl.pathname;
  // Skip noisy asset/static requests
  if (!path.startsWith("/_next") && !path.startsWith("/favicon")) {
    console.log(`${req.method} ${path} ${ms}ms`);
  }
  return res;
}
