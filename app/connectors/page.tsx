import { listTokens } from "@/lib/mcp/tokens";
import { relativeAge } from "@/lib/mcp/connector-view";
import IssueConnector from "@/components/IssueConnector";
import ConnectorRow from "@/components/ConnectorRow";

// Reads the DB on every request: a stale token list would show a revoked URL
// as live, which is the one thing this page must never do.
export const dynamic = "force-dynamic";

export const metadata = { title: "Connectors — Stayable" };

function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${String(d.getUTCFullYear()).slice(2)}`;
}

export default async function ConnectorsPage() {
  let tokens: Awaited<ReturnType<typeof listTokens>> = [];
  let loadFailed = false;
  try {
    tokens = await listTokens();
  } catch {
    loadFailed = true;
  }
  const now = Date.now();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header>
        <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Admin</p>
        <h1 className="mt-1 text-2xl font-semibold text-txt">MCP connectors</h1>
        <p className="mt-2 max-w-2xl text-sm text-txt2">
          One URL per person, individually revocable. Each is recorded against the email it was
          given to — that record is a label typed here, not proof of identity, so it is accurate
          only as far as this page is filled in accurately.
        </p>
      </header>

      <section className="mt-6 rounded-[10px] border border-line bg-surface2 p-4 text-sm text-txt2">
        <p>
          <span className="font-semibold text-txt">The MCP carries no guest data, deliberately.</span>{" "}
          The <code>/bea</code> balance-due exception does not extend here — a URL sitting in a
          settings pane is a weaker gate than the PIN, so it carries the less sensitive data. Ask a
          connector who owes rent and it returns nothing. Tell people this before they connect, or
          it reads as broken.
        </p>
      </section>

      <div className="mt-6">
        <IssueConnector />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-txt">Issued</h2>
        {loadFailed ? (
          <p className="mt-3 text-sm text-neg">
            Could not load the token list. If the database is down, live connectors are affected
            too — they resolve tokens against the same database. If it is only this page,
            connectors keep working.
          </p>
        ) : tokens.length === 0 ? (
          <p className="mt-3 text-sm text-txt2">No URLs issued yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-lineStrong">
                  {["Tied to", "URL", "Label", "Created", "Last used", ""].map((h) => (
                    <th
                      key={h}
                      className="pb-2 pr-3 text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const dead = t.revokedAt !== null;
                  return (
                    <tr key={t.id} className="border-b border-line align-top">
                      <td className={"py-3 pr-3 " + (dead ? "text-txt3 line-through" : "text-txt")}>
                        {t.email ?? "—"}
                      </td>
                      {/* Enough of the token to match a URL someone is holding,
                          and far too little to reconstruct one — 12 of 64 hex
                          characters. Rows minted before previews existed show a
                          dash and always will: the token was never stored. */}
                      <td className="py-3 pr-3 font-mono text-[12px] text-txt2">
                        {t.preview ? `/api/mcp/${t.preview}` : "—"}
                      </td>
                      <td className="py-3 pr-3 text-txt2">{t.label ?? "—"}</td>
                      <td className="py-3 pr-3 text-txt2">{fmtDate(t.createdAt)}</td>
                      <td className="py-3 pr-3 text-txt2">
                        {dead ? `revoked ${fmtDate(t.revokedAt!)}` : relativeAge(t.lastUsedAt, now)}
                      </td>
                      <td className="py-3">
                        {dead ? null : <ConnectorRow id={t.id} email={t.email} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
