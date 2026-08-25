import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import {
  askKb,
  corpusFingerprint,
  kbAskConfigured,
  kbChatEnabled,
  normaliseQuestion,
} from "@/lib/kb-ask";
import { canServeCached, kbDailyCap, questionCacheKey } from "@/lib/kb-cache";
import { getCorpus } from "@/lib/kb-corpus";
import {
  bumpKbCacheHit,
  countKbAnswersToday,
  findCachedKbAnswer,
  insertKbAnswer,
} from "@/lib/db";

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

  // Not launched yet. Checked here as well as in the mount: hiding the button
  // while leaving this endpoint answering would still call the model and still
  // bill for anyone who knew the path — that is not "off".
  if (!kbChatEnabled()) {
    return NextResponse.json({ ok: false, error: "not enabled" }, { status: 404 });
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

  // ── The answer cache. Checked BEFORE the daily cap, deliberately: a cached
  // answer costs nothing, so rationing it would be friction that buys no money.
  // A cache serve writes no new row and returns the ORIGINAL id, so a verdict
  // left on it attaches to the one canonical answer.
  const fingerprint = corpusFingerprint(getCorpus());
  const cacheKey = questionCacheKey(question);
  if (cacheKey) {
    try {
      const hit = await findCachedKbAnswer(cacheKey, fingerprint);
      if (hit && canServeCached(hit, fingerprint)) {
        await bumpKbCacheHit(hit.id).catch((e) =>
          console.error("[kb-ask] could not count cache hit:", e),
        );
        return NextResponse.json({
          ok: true,
          id: hit.id,
          cached: true,
          answered: hit.answered,
          answer: hit.answer,
          citations: hit.citations
            ? hit.citations.split(",").map((c) => {
                const [slug, anchor] = c.split("#");
                return { slug, anchor };
              })
            : [],
        });
      }
    } catch (e) {
      // A cache miss and a broken cache must behave the same: ask the model.
      // Never fail a reader's question over an optimisation.
      console.error("[kb-ask] cache lookup failed:", e);
    }
  }

  // ── The daily cap. Gates only PAID calls, which is why it sits after the
  // cache. Portfolio-wide, not per person — the PIN cookie is a level, not an
  // identity, so there is nobody to count against (see lib/kb-cache.ts).
  //
  // Fails OPEN on a database error: the cap is cost protection, and a Neon
  // blip must not take the assistant down. The Anthropic Console spend limit is
  // the backstop that does not depend on our database being up.
  const cap = kbDailyCap();
  try {
    if ((await countKbAnswersToday()) >= cap) {
      return NextResponse.json(
        {
          ok: false,
          error: `The assistant has reached today's limit of ${cap} answers. Search the knowledgebase directly, or try again tomorrow.`,
        },
        { status: 429 },
      );
    }
  } catch (e) {
    console.error("[kb-ask] daily cap check failed, allowing the call:", e);
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
      cacheKey,
      corpusFingerprint: fingerprint,
    });
  } catch (e) {
    console.error("[kb-ask] could not record answer:", e);
  }

  return NextResponse.json({ ok: true, id, ...answer });
}
