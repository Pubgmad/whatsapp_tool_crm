'use client';

import { useEffect, useState } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';
import HonestLimitsCallout from './honest-limits-callout';

export default function SloCertificationPanel({ api, postJson }) {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => setReport(await api('/api/super-admin/slo-certification'));

  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [api]);

  return (
    <section className="settingGroup">
      <HonestLimitsCallout limitId="slo_certification" compact />
      <header className="wa-module-heading">
        <h3><Activity size={18} /> Load-test &amp; queue SLO certification</h3>
        <button type="button" title="Refresh SLO report" aria-label="Refresh SLO report" disabled={busy} onClick={() => { setBusy(true); load().finally(() => setBusy(false)); }}>
          <RefreshCcw size={16} />
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {report?.live && (
        <>
          <p role="status">
            Live certification: <strong>{report.live.certified ? 'PASS' : 'ATTENTION'}</strong>
            {report.last?.lastRunAt && ` · last recorded ${new Date(report.last.lastRunAt).toLocaleString()}`}
          </p>
          <ul>
            {report.live.checks.map((check) => (
              <li key={check.id}>{check.pass ? '✓' : '✗'} {check.label} — {check.detail}</li>
            ))}
          </ul>
          <button
            type="button"
            className="secondaryAction"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await postJson('/api/super-admin/slo-certification', { action: 'record' });
                await load();
              } catch (cause) {
                setError(cause.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Record certification run
          </button>
          <p className="wa-module-note">After VPS volume tests, run <code>node scripts/load-test-slo.mjs --note &quot;…&quot;</code> then record here.</p>
        </>
      )}
    </section>
  );
}
