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
  if (summary === 'ready') return 'Ready';
  if (summary === 'blocked') return 'Action needed';
  return 'Awaiting verification';
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

  if (data?.summary === 'ready' && !error) {
    return (
      <section className="saasBanner automationReadyBanner" role="status" aria-label="Automation messaging readiness">
        <div>
          <strong>Messaging ready</strong>
          <span> Live automation checks passed. Header Connected means Meta login; this confirms messaging readiness.</span>
        </div>
        <button type="button" className="secondaryAction compactAction" disabled={busy} onClick={load}>
          <RefreshCcw size={16} /> Refresh
        </button>
      </section>
    );
  }

  return (
    <section className="automationLiveOps" aria-label="Connection readiness">
      <header>
        <div>
          <strong>Connection readiness</strong>
          <span>Fix these items before relying on live automation.</span>
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
          <ul className="automationLiveOpsList">
            {data.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.label}</strong>
                <span className={`badge ${badgeKind(check.status)}`}>{String(check.status).replace(/_/g, ' ')}</span>
                <small>{check.detail}</small>
              </li>
            ))}
          </ul>
          {data.webhookUrl ? (
            <details className="techDetails">
              <summary>Webhook endpoint</summary>
              <code>{data.webhookUrl}</code>
            </details>
          ) : null}
        </>
      )}
      <details className="techDetails">
        <summary>Product notes</summary>
        <HonestLimitsCallout limitId="automation_visual_canvas" compact />
        <HonestLimitsCallout limitId="in_chat_webview_chrome" compact />
      </details>
    </section>
  );
}
