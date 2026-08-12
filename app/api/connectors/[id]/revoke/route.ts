import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { revokeToken } from "@/lib/mcp/tokens";

export const dynamic = "force-dynamic";

/** Kill one connector URL. Admin only. Idempotent — revokeToken's WHERE skips
 *  an already-revoked row, so its original timestamp survives a second click.
 *  The row itself is KEPT so "who had access in August" stays answerable. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (level !== "admin") {
    return NextResponse.json({ ok: false, error: "not authorised" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  try {
    await revokeToken(Number(id));
  } catch {
    return NextResponse.json({ ok: false, error: "could not revoke" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
