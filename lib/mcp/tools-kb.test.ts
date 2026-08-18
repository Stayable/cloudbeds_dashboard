import { describe, expect, it } from "vitest";
import { KB_TOOLS } from "./tools-kb";
import { getCorpus } from "../kb-corpus";
import { McpArgError } from "./types";

const byName = (n: string) => {
  const t = KB_TOOLS.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};

describe("KB_TOOLS registration", () => {
  it("exposes exactly the three read tools", () => {
    expect(KB_TOOLS.map((t) => t.name).sort()).toEqual([
      "get_kb_document",
      "list_kb_documents",
      "search_kb",
    ]);
  });

  it("is read-only — no tool name implies a write", () => {
    for (const t of KB_TOOLS) {
      expect(t.name).not.toMatch(/^(set|update|delete|create|write|post)_/);
    }
  });
});

describe("list_kb_documents", () => {
  it("lists every document with its slug and snapshot date", async () => {
    const { data } = await byName("list_kb_documents").handler({});
    const docs = (data as { documents: { slug: string; snapshotDate: string }[] }).documents;
    expect(docs).toHaveLength(getCorpus().length);
    for (const d of docs) {
      expect(d.slug).toBeTruthy();
      expect(d.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("includes the new lease-residents document", async () => {
    const { data } = await byName("list_kb_documents").handler({});
    const slugs = (data as { documents: { slug: string }[] }).documents.map((d) => d.slug);
    expect(slugs).toContain("lease-residents");
  });

  // Freshness must describe the WEAKEST document, not the strongest, or the
  // caller is told the whole corpus is as current as its best-kept page.
  it("reports the OLDEST snapshot as asOf", async () => {
    const { freshness } = await byName("list_kb_documents").handler({});
    const oldest = getCorpus()
      .map((d) => d.snapshotDate)
      .sort()[0];
    expect(freshness.asOf).toBe(oldest);
  });

  it("warns the caller not to resolve conflicts itself", async () => {
    const { freshness } = await byName("list_kb_documents").handler({});
    expect(freshness.note.toLowerCase()).toContain("unresolved");
  });
});

describe("search_kb", () => {
  it("returns real section bodies, not marked-up snippets", async () => {
    const { data } = await byName("search_kb").handler({ query: "pet fee", limit: 5 });
    const results = (data as { results: { body: string }[] }).results;
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.body).not.toContain("<mark>");
      expect(r.body.length).toBeGreaterThan(0);
    }
  });

  it("finds the lease pet fee, which only exists in the new document", async () => {
    const { data } = await byName("search_kb").handler({ query: "pet fee signed lease", limit: 8 });
    const results = (data as { results: { slug: string; body: string }[] }).results;
    expect(results.some((r) => r.body.includes("$25"))).toBe(true);
  });

  it("honours the limit", async () => {
    const { data } = await byName("search_kb").handler({ query: "fee", limit: 2 });
    expect((data as { results: unknown[] }).results).toHaveLength(2);
  });

  // An empty result must SAY it is empty. A bare [] reads to a model as "no
  // constraint" and invites it to answer from general knowledge.
  it("states plainly when nothing matched", async () => {
    const { data } = await byName("search_kb").handler({
      query: "zzzzqqq nonexistent topic",
      limit: 5,
    });
    const d = data as { resultCount: number; note?: string };
    expect(d.resultCount).toBe(0);
    expect(d.note).toMatch(/does not cover/i);
  });

  it("rejects an empty query as an argument error, not a crash", async () => {
    await expect(byName("search_kb").handler({ query: "   " })).rejects.toBeInstanceOf(McpArgError);
  });
});

describe("get_kb_document", () => {
  it("returns the whole document with every section", async () => {
    const { data, freshness } = await byName("get_kb_document").handler({ slug: "fee-schedule" });
    const d = data as { slug: string; sections: { anchor: string }[] };
    expect(d.slug).toBe("fee-schedule");
    expect(d.sections.length).toBeGreaterThan(3);
    expect(freshness.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // The per-property damage fees and the key-fee conflict are the two things
  // added on 08/19/26 that a caller is most likely to be asked about.
  it("carries the per-property damage fees and the unresolved key fee", async () => {
    const { data } = await byName("get_kb_document").handler({ slug: "fee-schedule" });
    const text = (data as { sections: { body: string }[] }).sections.map((s) => s.body).join("\n");
    expect(text).toContain("$1,000");
    expect(text).toContain("Not on file");
    expect(text).toContain("$2.50");
    expect(text.toLowerCase()).toContain("unresolved");
  });

  it("names the known slugs when given a bad one", async () => {
    await expect(byName("get_kb_document").handler({ slug: "no-such-doc" })).rejects.toThrow(
      /Known slugs/,
    );
  });
});
