import { NextResponse, type NextRequest } from "next/server";

/**
 * Route guard for the workspace. The `pf_mode` cookie records whether the
 * browser is in the demo workspace or signed in to the API (whose own
 * httpOnly session cookie is verified by the API on every request).
 */
export function proxy(request: NextRequest) {
  const mode = request.cookies.get("pf_mode")?.value;
  if (!mode) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/app", "/app/:path*"] };
