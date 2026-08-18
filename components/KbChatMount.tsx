import { cookies } from "next/headers";
import KbChat from "@/components/KbChat";
import { AUTH_COOKIE, RESTRICTED_LEVELS, verifyCookie } from "@/lib/auth";

// SERVER component gate for the floating chatbot, mirroring Nav.tsx exactly:
// renders nothing without a valid cookie, and nothing for a fully-restricted
// level. That keeps the widget off /login, /test, and /elise.
//
// The audience is deliberately every authenticated non-restricted level — the
// same set that already reaches /kb, which is a SHARED page at base level
// (lib/auth.ts SHARED_PAGES). Kyle, 08/19/26: "All Staff on the dashboard, so
// even MAIN can access it." Nothing is widened by this component; the
// knowledgebase was already visible to exactly these people.
//
// `elise` is excluded because it is an external leasing partner. The KB carries
// AKIA numbers, the emergency escalation procedure, and internal notes on where
// our own website is wrong — none of that goes to a vendor.

export default async function KbChatMount() {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (!level || RESTRICTED_LEVELS.has(level)) return null;
  return <KbChat />;
}
