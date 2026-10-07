'use client';

import { useEffect, useState } from 'react';

export default function WorkspaceOperationsPanel({ api, report: reportProp = null }) {
  const [report, setReport] = useState(reportProp);
  const [error, setError] = useState('');

  useEffect(() => {
    setReport(reportProp);
  }, [reportProp]);

  useEffect(() => {
    if (reportProp) return undefined;
    let active = true;
    api('/api/workspace/operations')
      .then((value) => {
        if (active) setReport(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message || 'Operations report unavailable');
      });
    return () => {
      active = false;
    };
  }, [api, reportProp]);

  if (error) return <section className="opsPanel"><p role="alert">{error}</p></section>;
  if (!report) return <section className="opsPanel"><p>Loading production operations…</p></section>;

  const queue = report.campaigns?.queue || {};
  const send = report.campaigns?.sendEvents || {};

  return (
    <section className="opsPanel">
      <h3>Production operations</h3>
      <p className="wa-module-note">Queue health, rate limits, SLA, templates, and integrations for this workspace.</p>
      <div className="opsGrid">
        <article>
          <strong>Campaign queue</strong>
          <span>{queue.queued_jobs || 0} queued · {queue.processing_jobs || 0} processing</span>
          <span>SLO lag: {queue.slo?.lagOk ? 'within target' : 'attention'} ({queue.slo?.maxLagSeconds || queue.maxLagSeconds}s)</span>
          <span>24h rate limits: {send.rateLimited24h || 0} · retryable failures: {send.retryable24h || 0}</span>
        </article>
        <article>
          <strong>Inbox SLA</strong>
          <span>{report.inbox?.waitingNow || 0} waiting · {report.inbox?.breachedNow || 0} breached now</span>
          <span>7d breaches: {report.inbox?.breached7d || 0}</span>
        </article>
        <article>
          <strong>Marketing Messages API</strong>
          <span>Status: {report.marketingMessages?.marketingMessagesStatus || 'UNKNOWN'} · path: {report.marketingMessages?.sendPath || '—'}</span>
          <small>{report.marketingMessages?.operatorNote}</small>
        </article>
        <article>
          <strong>AI usage (30d)</strong>
          <span>{report.ai?.totalRequests30d || 0} suggestion requests</span>
        </article>
      </div>
      {report.templates?.formats?.length > 0 && (
        <details>
          <summary>Template format matrix ({report.templates.approvedTemplates} approved)</summary>
          <ul>
            {report.templates.formats.map((format) => (
              <li key={format.id}>{format.label}: {format.approvedCount}</li>
            ))}
          </ul>
        </details>
      )}
      {report.integrations?.catalog?.length > 0 && (
        <details>
          <summary>Supported integrations catalog</summary>
          <ul>
            {report.integrations.catalog.map((item) => (
              <li key={item.id}>{item.label} ({item.kind})</li>
            ))}
          </ul>
        </details>
      )}
      {report.campaigns?.failedRecipientSamples?.length > 0 && (
        <details>
          <summary>Recent failed recipient classification</summary>
          <ul>
            {report.campaigns.failedRecipientSamples.map((item, index) => (
              <li key={index}>
                {item.retryable ? 'Retryable' : 'Blocked'} — {item.reason}: {item.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
