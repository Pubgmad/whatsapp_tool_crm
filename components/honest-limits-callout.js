'use client';

import { honestLimitById } from '../lib/honest-product-limits.js';

export default function HonestLimitsCallout({ limitId, compact = false }) {
  const limit = honestLimitById(limitId);
  if (!limit) return null;
  if (compact) {
    return (
      <p className="wa-module-note honestLimitCallout" role="note">
        <strong>Production boundary:</strong> {limit.boundary}
      </p>
    );
  }
  return (
    <aside className="honestLimitCallout" role="note" aria-label={`${limit.title} production boundary`}>
      <strong>{limit.title}</strong>
      <p>{limit.boundary}</p>
      {limit.operatorActions?.length > 0 && (
        <ul>
          {limit.operatorActions.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
