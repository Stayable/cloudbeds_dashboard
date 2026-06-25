import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { setPin } from "@/lib/pins";

export const dynamic = "force-dynamic";

// Self-service: the logged-in user changes ONLY their own level's PIN. The cookie
// is a signed level token, so the level can't be spoofed; we never accept a
// target level from the client. The cookie stays valid (it signs the level, not
// the PIN), so the user is not logged out.
export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (!level) {
    return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin.trim() : "";
  if (pin.length < 4) {
    return NextResponse.json({ ok: false, error: "PIN must be at least 4 characters" }, { status: 400 });
  }
  if (pin.length > 64) {
    return NextResponse.json({ ok: false, error: "PIN must be 64 characters or fewer" }, { status: 400 });
  }

  try {
    await setPin(level, pin);
  } catch {
    return NextResponse.json({ ok: false, error: "could not update PIN" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
