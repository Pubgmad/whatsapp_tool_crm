'use client';

import { honestLimitById } from '../lib/honest-product-limits.js';

export default function HonestLimitsCallout({ limitId, compact = false }) {
  const limit = honestLimitById(limitId);
  if (!limit) return null;
  const summary = limit.tenantSummary || limit.boundary;
  if (compact) {
    return (
      <p className="wa-module-note honestLimitCallout" role="note">
        {summary}
      </p>
    );
  }
  return (
    <aside className="honestLimitCallout" role="note" aria-label={limit.title}>
      <strong>{limit.title}</strong>
      <p>{summary}</p>
      <details className="techDetails">
        <summary>More details</summary>
        <p>{limit.boundary}</p>
        {limit.operatorActions?.length > 0 && (
          <details className="techDetails">
            <summary>Admin setup notes</summary>
            <ul>
              {limit.operatorActions.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </details>
        )}
      </details>
    </aside>
  );
}
