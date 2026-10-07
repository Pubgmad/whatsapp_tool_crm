'use client';

import { useEffect, useState } from 'react';
import { BadgeCheck, RefreshCcw } from 'lucide-react';

export default function WorkspaceProductionCertPanel({ api }) {
  const [cert, setCert] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setCert(await api('/api/workspace/production-certification'));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [api]);

  if (!cert && !error) {
    return (
      <section className="parityPanel">
        <p>Loading production certification…</p>
      </section>
    );
  }

  const failed = cert?.checks?.filter((item) => !item.pass) || [];

  return (
    <section className="parityPanel" aria-label="Production certification">
      <header className="wa-module-heading">
        <h2><BadgeCheck size={20} /> Production certification</h2>
        <button type="button" title="Refresh" aria-label="Refresh certification" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {cert && (
        <>
          <p role="status">
            Workspace status: <strong>{cert.ready ? 'Ready for production sends' : 'Needs attention'}</strong>
            {cert.generatedAt && <small> · Updated {new Date(cert.generatedAt).toLocaleString()}</small>}
          </p>
          <div className="parityTableWrap">
            <table className="parityTable">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {cert.checks.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.label}</strong></td>
                    <td>{item.pass ? 'Pass' : 'Fail'}</td>
                    <td>{item.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {failed.length > 0 && (
            <p>
              <strong>{failed.length}</strong> open check(s). Resolve connection, worker, and billing items before scaling campaigns.
            </p>
          )}
        </>
      )}
    </section>
  );
}
