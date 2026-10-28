import { Loader2 } from 'lucide-react';

export default function SuperAdminLoading() {
  return (
    <div className="msRouteLoading" role="status" aria-live="polite" aria-busy="true" aria-label="Loading Super Admin">
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
