import Link from "next/link";
import { Card, CardHead, Notice, PageHead } from "@/components/ui";
import { corpusOutline, searchKb } from "@/lib/kb-corpus";
import { snapshotAge } from "@/lib/kb-parse";
import { kbView } from "@/lib/kb-view";
import { logKbQuery } from "@/lib/kb-log";
import { easternToday } from "@/lib/dates";
import type { OutlineDoc } from "@/lib/kb-search";

// Company documents and SOPs, searchable. Search only — there is no LLM here
// (spec §1). A search box keeps working when a model, a key or a provider does
// not, which is most of why it ships.
//
// Gated at the MAIN pin with no access-control code of its own: canAccess falls
// through to "any authenticated, non-restricted level" for unrecognised routes,
// so exec sees it and the isolated elise level cannot reach it.
export const dynamic = "force-dynamic";

export const metadata = { title: "Stayable — Knowledgebase" };

function Snapshot({ date, today }: { date: string; today: string }) {
  const age = snapshotAge(date, today);
  return (
    <span className={age.stale ? "text-warn" : "text-txt3"} title="When this copy was taken">
      {age.text}
    </span>
  );
}

function CorpusList({ docs, today }: { docs: OutlineDoc[]; today: string }) {
  if (!docs.length) {
    return <Notice tone="warn">The knowledgebase has no documents in it yet.</Notice>;
  }
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.slug} className="px-5 py-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/kb/${d.slug}`} className="text-[14px] font-semibold text-txt hover:text-accent">
              {d.title}
            </Link>
            <span className="text-[11.5px]">
              <Snapshot date={d.snapshotDate} today={today} />
            </span>
          </div>
          {d.headings.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
              {d.headings.map((h) => (
                <Link
                  key={h.anchor}
                  href={`/kb/${d.slug}#${h.anchor}`}
                  className="rounded border border-line px-1.5 py-0.5 text-[11.5px] text-txt3 hover:border-accent hover:text-accent"
                >
                  {h.heading}
                </Link>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function KbPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "");
  const today = easternToday();

  const results = raw.trim() ? searchKb(raw) : [];
  const view = kbView(raw, results, corpusOutline());

  // Query logging (spec §8): text + count only, no identity. Awaited rather than
  // floated so the write is not cut off when the response finishes; it can never
  // throw (lib/kb-log.ts).
  if (view.mode !== "browse") await logKbQuery(view.query, view.results.length);

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead
        eyebrow="Stayable · RISE8"
        title="Knowledgebase"
        sub="Company documents and SOPs. Search returns the section that answers you, with its source and snapshot date."
      />

      <Card>
        <form action="/kb" method="get" className="flex flex-wrap gap-2 p-4">
          <input
            type="search"
            name="q"
            defaultValue={view.query}
            autoFocus
            placeholder="e.g. eviction process in Osceola"
            aria-label="Search the knowledgebase"
            className="h-10 min-w-0 flex-1 rounded-md border border-lineStrong bg-surface px-3 text-[14px] text-txt placeholder:text-txt3 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Search
          </button>
          {view.query && (
            <Link
              href="/kb"
              className="inline-flex h-10 items-center rounded-md border border-lineStrong px-3 text-[13px] font-semibold text-txt2 hover:border-accent hover:text-accent"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>

      {view.mode === "results" && (
        <Card>
          <CardHead
            title={`${view.results.length} ${view.results.length === 1 ? "section" : "sections"} for “${view.query}”`}
            hint="Ranked by exact phrase in a heading, then in the text, then by how many of your words appear."
          />
          <ul className="divide-y divide-line">
            {view.results.map((r) => (
              <li key={`${r.slug}#${r.anchor}`} className="px-5 py-4">
                <Link
                  href={`/kb/${r.slug}#${r.anchor}`}
                  className="text-[14px] font-semibold text-txt hover:text-accent"
                >
                  {r.title}
                  {r.heading && <span className="text-txt3"> → </span>}
                  {r.heading}
                </Link>
                <div className="mt-1 text-[11.5px]">
                  <Snapshot date={r.snapshotDate} today={today} />
                </div>
                <p
                  className="mt-2 text-[13px] leading-[1.6] text-txt2"
                  // snippetHtml is escaped then highlighted in lib/kb-search.ts —
                  // the only markup it can contain is <mark>.
                  dangerouslySetInnerHTML={{ __html: r.snippetHtml }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view.mode === "empty" && (
        <Notice tone="warn">
          Nothing in the knowledgebase matches <strong>“{view.query}”</strong>. Everything we have is
          listed below — nothing is being hidden, and no weak matches are being shown in place of a
          real one.
        </Notice>
      )}

      <Card>
        <CardHead
          title="Everything in the knowledgebase"
          hint={
            view.mode === "results"
              ? "Browse the full corpus."
              : "Every document, with its sections. Snapshot dates are when the copy was taken — the originals may have moved on since."
          }
        />
        <CorpusList docs={view.outline} today={today} />
      </Card>
    </main>
  );
}
