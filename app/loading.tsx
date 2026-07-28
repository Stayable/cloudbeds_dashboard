// Route-transition signal. Next renders this whenever a route segment is
// pending — because every dashboard page is force-dynamic and fetches Cloudbeds
// data server-side, navigating between pages suspends long enough for this to
// show. A dimmed, blurred backdrop + spinner tells the user the page changed
// and is loading, instead of a frozen screen.
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-chrome/40 backdrop-blur-sm"
    >
      <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
      <span className="text-xs font-semibold uppercase tracking-widest text-white/80">
        Loading…
      </span>
    </div>
  );
}
