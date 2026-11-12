import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "./lib/config";
import { SESSION_COOKIE } from "./lib/appwrite/ids";

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  try {
    if (!getConfig().mock) {
      // Session cookies are HttpOnly and set by server actions. This proxy only
      // marks app pages as private so a shared cache cannot store a session.
      void request.cookies.get(SESSION_COOKIE);
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
    }
  } catch {
    /* Invalid configuration is handled by the pages themselves. */
  }
  return response;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/setup",
    "/settings",
    "/not-authorized",
    "/account/:path*",
    "/api/decisions/:path*",
  ],
};
