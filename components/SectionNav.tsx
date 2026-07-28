// Sticky section navigation pane shared by every dashboard surface
// (convention: vertical rail on lg+, horizontal scroller on mobile).
// Pure server-rendered anchor links — no client JS.
//
// Visual idiom is the design system's rail: a bordered card whose hover/active
// row carries a blue left edge. The numeric step badge is kept — it ties each
// row to the numbered section headings on the page.
export type NavItem = { id: string; label: string; n: number | null };

export default function SectionNav({
  items,
  title = "On this page",
}: {
  items: NavItem[];
  title?: string;
}) {
  return (
    <nav className="mb-4 lg:mb-0 lg:w-[214px] lg:shrink-0">
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-card lg:sticky lg:top-[104px]">
        <div className="hidden border-b border-line px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[.09em] text-txt3 lg:block">
          {title}
        </div>
        <ul className="flex overflow-x-auto lg:block lg:overflow-visible">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                className="flex items-center gap-2 whitespace-nowrap border-l-[3px] border-transparent px-3.5 py-2.5 text-[12.5px] font-semibold text-txt2 transition-colors hover:border-accent hover:bg-surface2 hover:text-txt"
              >
                {item.n !== null && (
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-surface3 text-[10px] font-semibold text-txt3">
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
