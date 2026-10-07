'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import HonestLimitsCallout from './honest-limits-callout';

export default function A11yCertificationPanel({ api }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/super-admin/a11y-certification')
      .then(setStatus)
      .catch((cause) => setError(cause.message));
  }, [api]);

  return (
    <section className="settingGroup">
      <header className="wa-module-heading">
        <h3><Eye size={18} /> Accessibility E2E matrix</h3>
      </header>
      <HonestLimitsCallout limitId="a11y_certification" compact />
      {error && <p role="alert">{error}</p>}
      {status && (
        <>
          <p role="status">
            Certified: <strong>{status.certified ? 'yes' : 'no'}</strong>
            {status.lastRunAt && ` · last run ${new Date(status.lastRunAt).toLocaleString()}`}
          </p>
          <ul>
            {status.projects?.map((p) => (
              <li key={p.id}>{p.pass ? '✓' : '○'} {p.label}</li>
            ))}
          </ul>
          <p className="wa-module-note">After green E2E: <code>node scripts/record-a11y-e2e.mjs</code></p>
        </>
      )}
    </section>
  );
}
