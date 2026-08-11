import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHead, PageHead } from "@/components/ui";
import { getCorpus, getDocument } from "@/lib/kb-corpus";
import { renderMarkdown } from "@/lib/kb-markdown";
import { snapshotAge } from "@/lib/kb-parse";
import { easternToday } from "@/lib/dates";

// One knowledgebase document. Sections are rendered individually so the <h2>
// carries the anchor produced by splitSections — the SAME anchor search links
// to. marked never generates an id here, so the two cannot drift apart.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocument(slug);
  return { title: doc ? `${doc.title} — Stayable Knowledgebase` : "Not found — Stayable Knowledgebase" };
}

export default async function KbDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocument(slug);
  if (!doc) notFound();

  const today = easternToday();
  const age = snapshotAge(doc.snapshotDate, today);
  const headings = doc.sections.filter((s) => s.heading !== null);
  const others = getCorpus().filter((d) => d.slug !== doc.slug);

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead
        eyebrow="Knowledgebase"
        title={doc.title}
        sub={
          <>
            {doc.source}
            {doc.counties.length > 0 && ` · ${doc.counties.join(", ")}`}
          </>
        }
      >
        <Link href="/kb" className="inline-flex h-8 items-center rounded-md border border-chromeLine bg-white/[.06] px-3 text-xs font-semibold text-chromeText transition-colors hover:bg-white/[.14]">
          ← Search
        </Link>
      </PageHead>

      <div
        className={
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border px-4 py-2.5 text-[12.5px] " +
          (age.stale ? "border-warn/30 bg-warnbg text-warn" : "border-line bg-surface2 text-txt3")
        }
      >
        <span className="font-semibold">{age.text}</span>
        <span>
          This is a copy taken on that date. The original may have changed since — it is not synced.
        </span>
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto font-semibold text-accent underline underline-offset-2"
          >
            Open the original ↗
          </a>
        )}
      </div>

      {headings.length > 1 && (
        <Card>
          <CardHead title="Sections" />
          <div className="flex flex-wrap gap-2 px-5 py-3.5">
            {headings.map((s) => (
              <a
                key={s.anchor}
                href={`#${s.anchor}`}
                className="rounded border border-line px-2 py-1 text-[12px] text-txt2 hover:border-accent hover:text-accent"
              >
                {s.heading}
              </a>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-5 sm:px-6">
          {doc.sections.map((s) => (
            <section key={s.anchor} id={s.anchor} className="kb-anchor mb-7 last:mb-0">
              {s.heading && (
                <h2 className="mb-2.5 text-[15px] font-semibold tracking-[-.01em] text-txt">
                  {s.heading}
                </h2>
              )}
              <div
                className="kb-prose"
                // Rendered by lib/kb-markdown.ts, which neutralises raw HTML.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }}
              />
            </section>
          ))}
        </div>
      </Card>

      {others.length > 0 && (
        <Card>
          <CardHead title="Other documents" />
          <ul className="divide-y divide-line">
            {others.map((d) => (
              <li key={d.slug} className="px-5 py-2.5">
                <Link href={`/kb/${d.slug}`} className="text-[13.5px] text-txt2 hover:text-accent">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
