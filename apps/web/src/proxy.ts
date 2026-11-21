import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard for the workspace. The `pf_mode` cookie records whether the
 * browser is in the demo workspace or signed in to the API (whose own
 * httpOnly session cookie is verified by the API on every request).
 */
export function proxy(request: NextRequest) {
  // The browser only ever calls /api/v1 on this origin. The API address is read here on every request, so one
  // built image works in any environment: rewrites() in next.config are fixed when the app is built, which made
  // a Docker-built image proxy to its build-time default whatever PRESSFLOW_API_URL said at runtime.
  if (request.nextUrl.pathname.startsWith("/api/v1/")) {
    const api = (process.env.PRESSFLOW_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
    return NextResponse.rewrite(new URL(request.nextUrl.pathname + request.nextUrl.search, api));
  }
  const mode = request.cookies.get("pf_mode")?.value;
  if (!mode) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app", "/app/:path*", "/api/v1/:path*"] };
