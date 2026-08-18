import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { setKbFeedbackVerdict } from "@/lib/db";
import { isKbFeedbackReason } from "@/lib/kb-feedback-reasons";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (!level) {
    return NextResponse.json({ ok: false, error: "sign in required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; helpful?: unknown; reason?: unknown }
    | null;

  const id = typeof body?.id === "number" && Number.isInteger(body.id) ? body.id : null;
  const helpful = typeof body?.helpful === "boolean" ? body.helpful : null;
  if (id === null || helpful === null) {
    return NextResponse.json({ ok: false, error: "id and helpful required" }, { status: 400 });
  }

  // A reason only means anything on a "no". Silently dropping it on a "yes"
  // keeps the column honest — a reason attached to a positive verdict would
  // read as a complaint nobody made.
  const reason = !helpful && isKbFeedbackReason(body?.reason) ? body.reason : null;

  try {
    await setKbFeedbackVerdict(id, helpful, reason);
  } catch (e) {
    console.error("[kb-feedback] could not save verdict:", e);
    return NextResponse.json({ ok: false, error: "could not save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
