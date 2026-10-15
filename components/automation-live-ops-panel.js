'use client';

import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import HonestLimitsCallout from './honest-limits-callout';

function badgeKind(status) {
  if (status === 'ready') return 'good';
  if (status === 'blocked') return 'bad';
  if (status === 'info') return 'neutral';
  return 'warn';
}

function summaryLabel(summary) {
  if (summary === 'ready') return 'Live verified';
  if (summary === 'blocked') return 'Blocked — fix ops first';
  return 'Awaiting live verification';
}

export default function AutomationLiveOpsPanel({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api('/api/workspace/live-readiness'));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [api]);

  return (
    <section className="automationLiveOps" aria-label="Connection readiness">
      <header>
        <div>
          <strong>Connection readiness</strong>
          <span>WhatsApp connection, Flows, and messaging status for this workspace.</span>
        </div>
        <button type="button" className="secondaryAction" disabled={busy} onClick={load}>
          <RefreshCcw size={16} /> Refresh
        </button>
      </header>
      {error && <p className="formError" role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">
            Status: <strong>{summaryLabel(data.summary)}</strong>
          </p>
          {data.webhookUrl ? (
            <details className="techDetails">
              <summary>Webhook endpoint</summary>
              <code>{data.webhookUrl}</code>
            </details>
          ) : null}
          <ul className="automationLiveOpsList">
            {data.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.label}</strong>
                <span className={`badge ${badgeKind(check.status)}`}>{String(check.status).replace(/_/g, ' ')}</span>
                <small>
                  {check.detail}
                  {check.operatorHint ? ` — ${check.operatorHint}` : ''}
                </small>
              </li>
            ))}
          </ul>
        </>
      )}
      <HonestLimitsCallout limitId="in_chat_webview_chrome" compact />
      <HonestLimitsCallout limitId="automation_visual_canvas" compact />
    </section>
  );
}
