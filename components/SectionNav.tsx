// Sticky section navigation pane shared by every per-user dashboard
// (convention: vertical sidebar on lg+, horizontal pill bar on mobile).
// Pure server-rendered anchor links — no client JS.
export type NavItem = { id: string; label: string; n: number | null };

export default function SectionNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="mb-6 lg:mb-0 lg:w-44 lg:shrink-0">
      <div className="sticky top-4 z-10 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-6 lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <p className="mb-2 hidden text-xs font-medium uppercase tracking-wide text-slate-400 lg:block">
          On this page
        </p>
        <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                {item.n !== null && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white">
                    {item.n}
                  </span>
                )}
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
