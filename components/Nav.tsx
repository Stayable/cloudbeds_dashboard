import { cookies } from "next/headers";
import LogOut from "@/components/LogOut";
import NavLinks from "@/components/NavLinks";
import ThemeToggle from "@/components/ThemeToggle";
import { AUTH_COOKIE, RESTRICTED_LEVELS, accessiblePages, verifyCookie, type Level } from "@/lib/auth";

// Persistent top chrome — one login, reach every page your role permits without
// re-entering a PIN. SERVER component: reads the signed auth cookie directly
// (no client round-trip). Self-hides (renders null) when there's no valid
// cookie or the level is fully restricted (elise) — so it never appears on
// /login, /test, or /elise. Route access itself is still enforced by
// middleware/canAccess; this only decides what to *show*.
//
// Layout is the design source's 56px navy bar: wordmark + gold dot, pill nav,
// then role / theme / log out on the right.

// How each PIN level is described in the chrome. These are the levels the app
// already defines (lib/auth.ts) — nothing here is inferred about a person.
const ROLE: Record<Level, { name: string; title: string }> = {
  base: { name: "Portfolio", title: "Base access" },
  exec: { name: "Executive", title: "CEO · full access" },
  ops: { name: "Operations", title: "Ops access" },
  crystal: { name: "Crystal", title: "VP Operations" },
  monica: { name: "Monica", title: "Revenue Management" },
  bea: { name: "Bea", title: "Ops Support" },
  elise: { name: "EliseAI", title: "Leasing partner" },
};

export default async function Nav() {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (!level || RESTRICTED_LEVELS.has(level)) return null;

  const pages = accessiblePages(level);
  const role = ROLE[level];

  return (
    <nav className="sticky top-0 z-40 border-b border-chromeLine bg-chrome">
      <div className="mx-auto flex h-14 max-w-[1560px] items-center gap-6 px-4 sm:px-6">
        {/* Wordmark — "Stayable" + the gold dot. Capital S per Kyle 08/12/26,
            overriding the lowercase treatment in the original design comp. */}
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-[18px] font-bold tracking-[-.02em] text-white">Stayable</span>
          <span className="h-[5px] w-[5px] -translate-y-[3px] rounded-full bg-gold" />
        </div>

        <NavLinks pages={pages} />

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-[12.5px] font-semibold text-white">{role.name}</div>
            <div className="text-[10.5px] tracking-[.04em] text-[#6E96C9]">{role.title}</div>
          </div>
          <ThemeToggle />
          <LogOut />
        </div>
      </div>
    </nav>
  );
}
