'use client';

import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';

function formatTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function CampaignFailedWorkbench({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api('/api/workspace/campaign-failures?limit=75'));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [api]);

  if (!data && !error) {
    return <section className="parityPanel"><p>Loading failed delivery workbench…</p></section>;
  }

  return (
    <section className="parityPanel" aria-label="Failed campaign deliveries">
      <header className="wa-module-heading">
        <h2>Failed delivery workbench</h2>
        <button type="button" title="Refresh" aria-label="Refresh failed deliveries" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p><strong>{data.total}</strong> failed recipient(s) across all campaigns.</p>
          {data.rows.length > 0 ? (
            <div className="parityTableWrap">
              <table className="parityTable">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Contact</th>
                    <th>Error</th>
                    <th>Attempts</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.campaignName}</strong>
                        <small>{row.campaignStatus}</small>
                      </td>
                      <td>
                        <strong>{row.contactName || 'Unknown'}</strong>
                        <small>{row.contactPhone}</small>
                      </td>
                      <td>{row.errorMessage || '—'}</td>
                      <td>{row.attempts} / {row.maxAttempts}</td>
                      <td>{formatTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No failed recipients in the latest window.</p>
          )}
        </>
      )}
    </section>
  );
}
