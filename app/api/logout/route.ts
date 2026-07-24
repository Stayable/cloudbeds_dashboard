import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";

// Log out: clear the signed auth cookie. Client (components/LogOut.tsx) then
// hard-navigates to /login, where middleware re-gates every route. POST only —
// a GET could be prefetched/triggered accidentally and log the user out.
export const runtime = "nodejs";

export async function POST() {
  (await cookies()).set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
