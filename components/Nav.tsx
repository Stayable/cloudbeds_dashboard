import Link from "next/link";
import { cookies } from "next/headers";
import { AUTH_COOKIE, RESTRICTED_LEVELS, accessiblePages, verifyCookie } from "@/lib/auth";

// Persistent top nav — one login, reach every page your role permits without
// re-entering a PIN. SERVER component: reads the signed auth cookie directly
// (no client round-trip). Self-hides (renders null) when there's no valid
// cookie or the level is fully restricted (elise) — so it never appears on
// /login, /test, or /elise. Route access itself is still enforced by
// middleware/canAccess; this only decides what to *show*.
export default async function Nav() {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (!level || RESTRICTED_LEVELS.has(level)) return null;

  const pages = accessiblePages(level);

  return (
    <nav className="sticky top-0 z-40 border-b border-white/10 bg-ink text-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto px-4 py-2.5 sm:px-6">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-white/60">
          Stayable
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {pages.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
