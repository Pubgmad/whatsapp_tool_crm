'use client';

import './feedback.css';

/** Thin top progress bar for navigation / global pending work. */
export default function NavProgress({ active = false, label = 'Loading' }) {
  if (!active) return null;
  return (
    <div className="msNavProgress" role="progressbar" aria-busy="true" aria-label={label}>
      <span className="msNavProgressBar" />
    </div>
  );
}
