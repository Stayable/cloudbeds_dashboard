// Says out loud when leasing data is not updating, and why.
//
// Kyle, 08/08/26: "make it so that the dashboard says the error and say waiting
// for elise to reply." The wording is composed in lib/elise-status.ts from a
// STORED sync status rather than hardcoded here, so a successful sync removes the
// whole banner — including the "waiting on EliseAI" sentence — with no code
// change. See the comment at the top of that file for why that matters.
//
// Rendered on both /ops §2 and /elise: they read the same tables, so both would
// otherwise show a stale funnel with no explanation.
import type { EliseBanner } from "@/lib/elise-status";

/** `failing` and `never` are problems someone must act on; `stale` is a caution.
 *  Tokens only (design-system rule) — no raw colours. */
const TONE = {
  failing: { box: "border-neg/30 bg-negbg", head: "text-neg", body: "text-txt2" },
  never: { box: "border-neg/30 bg-negbg", head: "text-neg", body: "text-txt2" },
  stale: { box: "border-warn/30 bg-warnbg", head: "text-warn", body: "text-txt2" },
} as const;

export default function EliseSyncBanner({ banner }: { banner: EliseBanner }) {
  if (banner.kind === null) return null;
  const tone = TONE[banner.kind];

  return (
    <div className={`rounded-[10px] border px-4 py-3 ${tone.box}`} role="status">
      <p className={`text-[13px] font-semibold ${tone.head}`}>{banner.headline}</p>
      <ul className={`mt-1.5 space-y-1 text-xs ${tone.body}`}>
        {banner.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      {banner.note && (
        <p className={`mt-2 border-t border-line pt-2 text-xs ${tone.body}`}>{banner.note}</p>
      )}
    </div>
  );
}
