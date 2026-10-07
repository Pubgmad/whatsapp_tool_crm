'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Inbox } from 'lucide-react';

function formatTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function InboxSlaWidget({ api, role, onOpenInbox }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/workspace/inbox-sla')
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason) => {
        if (active) setError(reason.message || 'Could not load inbox queue');
      });
    return () => {
      active = false;
    };
  }, [api]);

  if (error) {
    return (
      <section className="inboxSlaWidget" aria-live="polite">
        <p role="alert">{error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="inboxSlaWidget">
        <p>Loading support queue…</p>
      </section>
    );
  }

  const isAgent = role === 'Agent';

  return (
    <section className="inboxSlaWidget" aria-label="Support queue">
      <header>
        <h3><Inbox size={18} /> Support queue</h3>
        <span>{data.policyConfigured ? `SLA target: ${data.responseMinutes ?? '—'} min` : 'Support policy not configured'}</span>
      </header>
      <div className="inboxSlaMetrics">
        <article>
          <Clock size={16} />
          <strong>{data.waitingNow}</strong>
          <span>Waiting reply</span>
        </article>
        <article className={data.breachedNow > 0 ? 'warn' : ''}>
          <AlertTriangle size={16} />
          <strong>{data.breachedNow}</strong>
          <span>SLA breached</span>
        </article>
        <article>
          <strong>{isAgent ? data.myOpenConversations : data.openConversations}</strong>
          <span>{isAgent ? 'Your open chats' : 'Open conversations'}</span>
        </article>
        {!isAgent && (
          <article>
            <strong>{data.breached7d}</strong>
            <span>Breaches (7d)</span>
          </article>
        )}
      </div>
      {data.waiting?.length > 0 && (
        <ul className="inboxSlaWaitingList">
          {data.waiting.map((item) => (
            <li key={item.conversationId} className={item.breached ? 'breached' : ''}>
              <strong>{item.contactName || 'Contact'}</strong>
              <span>{item.breached ? 'SLA breached' : 'Waiting'}</span>
              <small>{formatTime(item.waitingSince)}</small>
              {isAgent && item.assignedToMe && <small>Assigned to you</small>}
            </li>
          ))}
        </ul>
      )}
      {onOpenInbox && (
        <button type="button" className="secondaryAction" onClick={onOpenInbox}>
          Open inbox
        </button>
      )}
    </section>
  );
}
