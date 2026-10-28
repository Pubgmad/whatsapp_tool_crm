import { Loader2 } from 'lucide-react';

/** Route-level fallback for App Router transitions — no full-screen takeover. */
export default function AppLoading() {
  return (
    <div className="msRouteLoading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading page">
      <span className="msNavProgress" aria-hidden="true">
        <span className="msNavProgressBar" />
      </span>
      <p className="msRouteLoadingHint">
        <Loader2 className="spin" size={16} aria-hidden="true" />
        Loading…
      </p>
    </div>
  );
}
