"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PageLink } from "@/lib/auth";

// The pill row inside the top chrome. Split out as a client component purely so
// the CURRENT page can be highlighted (usePathname) — Nav itself stays a server
// component that reads the auth cookie.
export default function NavLinks({ pages }: { pages: PageLink[] }) {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto">
      {pages.map((p) => {
        // "/" only matches exactly; every other page also matches its subpaths.
        const active = p.href === "/" ? pathname === "/" : pathname.startsWith(p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex h-[34px] shrink-0 items-center whitespace-nowrap rounded-[7px] px-3.5 text-[12.5px] font-semibold transition-colors " +
              (active
                ? "bg-accent/[.18] text-white shadow-[inset_0_0_0_1px_rgb(var(--blue)/.45)]"
                : "text-[#8FB3DD] hover:bg-white/[.08] hover:text-white")
            }
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
