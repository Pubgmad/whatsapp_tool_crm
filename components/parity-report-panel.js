'use client';

import { useEffect, useState } from 'react';

const statusLabel = {
  production_ready_code: 'Code ready',
  partial: 'Partial',
  live_attention: 'Needs live attention',
  gap: 'Not in scope'
};

export default function ParityReportPanel({
  api,
  parityPath = '/api/super-admin/parity',
  title = 'Product parity',
  subtitle = 'AiSensy & Meta benchmark vs this codebase (dynamic registry).'
}) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api(parityPath)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((reason) => {
        if (active) setError(reason.message || 'Could not load parity report');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, parityPath]);

  if (loading) return <section className="parityPanel"><h2>{title}</h2><p>Loading parity registry…</p></section>;
  if (error) return <section className="parityPanel"><h2>{title}</h2><p role="alert">{error}</p></section>;
  if (!report) return null;

  const counts = report.summary?.byStatus || {};

  return (
    <section className="parityPanel">
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <div className="paritySummary" aria-label="Registry summary">
        <span><strong>{report.summary?.total || 0}</strong> capabilities</span>
        <span><strong>{counts.strong || 0}</strong> strong</span>
        <span><strong>{counts.partial || 0}</strong> partial</span>
        <span><strong>{counts.gap || 0}</strong> gap</span>
        {report.summary?.operations && (
          <span>
            Worker: <strong>{report.summary.operations.worker || 'unknown'}</strong>
          </span>
        )}
      </div>
      <div className="parityTableWrap">
        <table className="parityTable">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Code</th>
              <th>Live</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {report.capabilities.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.label}</strong>
                  {item.operatorNote && <small>{item.operatorNote}</small>}
                </td>
                <td>{item.codeStatus}</td>
                <td>{statusLabel[item.liveStatus] || item.liveStatus}</td>
                <td>{item.meta?.status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
