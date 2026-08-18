import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { askKb, kbAskConfigured, normaliseQuestion } from "@/lib/kb-ask";
import { insertKbAnswer } from "@/lib/db";

export const dynamic = "force-dynamic";

// This route is NOT in the middleware matcher's exclusion list, so the PIN gate
// already runs in front of it. The cookie check below is belt-and-braces for the
// gate-disabled path, and is deliberately "any authenticated level" — /kb is a
// SHARED page at base level, so the chatbot's audience is every signed-in staff
// member and no narrower. See lib/auth.ts canAccess.

export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (!level) {
    return NextResponse.json({ ok: false, error: "sign in required" }, { status: 401 });
  }

  if (!kbAskConfigured()) {
    return NextResponse.json(
      { ok: false, error: "The knowledgebase assistant is not configured yet (ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? normaliseQuestion(body.question) : null;
  if (!question) {
    return NextResponse.json({ ok: false, error: "question required" }, { status: 400 });
  }

  let answer;
  try {
    answer = await askKb(question);
  } catch (e) {
    console.error("[kb-ask] model call failed:", e);
    return NextResponse.json(
      { ok: false, error: "Could not reach the assistant. Search the knowledgebase directly." },
      { status: 502 },
    );
  }

  // Record the answer so a verdict can attach to it later. A logging failure
  // must never swallow an answer the reader is waiting for — they lose the
  // feedback buttons, not the answer.
  let id: number | null = null;
  try {
    id = await insertKbAnswer({
      question,
      answer: answer.answer,
      answered: answer.answered,
      unverified: !!answer.unverified,
      citations: answer.citations.map((c) => `${c.slug}#${c.anchor}`).join(","),
    });
  } catch (e) {
    console.error("[kb-ask] could not record answer:", e);
  }

  return NextResponse.json({ ok: true, id, ...answer });
}
