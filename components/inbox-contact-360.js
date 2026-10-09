'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './inbox-contact-360.css';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function uniqueTags(value) {
  return [...new Set(String(value || '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

export default function InboxContact360({ contactId, api, pageSize = 30 }) {
  const [profile, setProfile] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [page, setPage] = useState({ hasMore: false, nextCursor: null });
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestVersion = useRef(0);

  const loadTimeline = useCallback(async (cursor = null, append = false) => {
    if (!contactId || typeof api !== 'function') return;
    const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(pageSize, 100))) });
    if (cursor) query.set('cursor', cursor);
    const result = await api(`/api/workspace/inbox/contacts/${encodeURIComponent(contactId)}/timeline?${query}`);
    setTimeline((current) => append
      ? [...new Map([...current, ...result.items].map((item) => [item.key, item])).values()]
      : result.items);
    setPage(result.page);
  }, [api, contactId, pageSize]);

  useEffect(() => {
    if (!contactId || typeof api !== 'function') return undefined;
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    setProfile(null);
    setTimeline([]);
    Promise.all([
      api(`/api/workspace/inbox/contacts/${encodeURIComponent(contactId)}`),
      loadTimeline()
    ]).then(([result]) => {
      if (requestVersion.current !== version) return;
      setProfile(result);
      setTags(result.contact.tags.join(', '));
    }).catch((reason) => {
      if (requestVersion.current === version) setError(reason.message || 'Could not load contact profile');
    }).finally(() => {
      if (requestVersion.current === version) setLoading(false);
    });
    return () => { requestVersion.current += 1; };
  }, [api, contactId, loadTimeline]);

  async function saveTags(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api(`/api/workspace/inbox/contacts/${encodeURIComponent(contactId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: uniqueTags(tags) })
      });
      setProfile((current) => current ? {
        ...current,
        contact: { ...current.contact, tags: result.tags, updatedAt: result.updatedAt }
      } : current);
      setTags(result.tags.join(', '));
      await loadTimeline();
    } catch (reason) {
      setError(reason.message || 'Could not save tags');
    } finally {
      setSaving(false);
    }
  }

  if (!contactId) return <aside className="contact360"><p>Select a conversation to view the contact profile.</p></aside>;
  if (loading && !profile) return <aside className="contact360" aria-busy="true"><p>Loading contact profile…</p></aside>;
  if (!profile) return <aside className="contact360"><p role="alert">{error || 'Contact profile is unavailable.'}</p></aside>;

  const { contact, assignment, referral, activity, permissions } = profile;
  return (
    <aside className="contact360" aria-label={`${contact.name || contact.phone} contact profile`}>
      <header className="contact360Header">
        <div>
          <span className="softLabel">Contact 360</span>
          <h3>{contact.name || 'Unnamed contact'}</h3>
          <a href={`tel:${contact.phone}`}>{contact.phone}</a>
        </div>
        <span className={contact.consent.unsubscribed ? 'badge bad' : contact.consent.marketingPermission ? 'badge good' : 'badge warn'}>
          {contact.consent.unsubscribed ? 'Unsubscribed' : contact.consent.marketingPermission ? 'Opted in' : 'Consent unknown'}
        </span>
      </header>

      {error && <p role="alert">{error}</p>}

      <section aria-labelledby="contact-assignment">
        <h4 id="contact-assignment">Assignment and referral</h4>
        <dl>
          <div><dt>Assigned to</dt><dd>{assignment?.assignedTo || 'Unassigned'}</dd></div>
          <div><dt>Conversation</dt><dd>{assignment?.status || 'No conversation'}</dd></div>
          <div><dt>Source</dt><dd>{contact.source || 'Unknown'}</dd></div>
          <div><dt>Referral</dt><dd>{referral ? referral.details.headline || referral.details.sourceName || referral.details.sourceType || 'Captured' : 'Unknown attribution'}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="contact-tags">
        <h4 id="contact-tags">Tags</h4>
        {permissions.canEditTags ? (
          <form onSubmit={saveTags}>
            <label>
              Comma-separated tags
              <input value={tags} onChange={(event) => setTags(event.target.value)} maxLength={1020} />
            </label>
            <button type="submit" className="secondaryAction" disabled={saving}>{saving ? 'Saving…' : 'Save tags'}</button>
          </form>
        ) : (
          <p>{contact.tags.length ? contact.tags.join(', ') : 'No tags'}</p>
        )}
      </section>

      <section aria-labelledby="contact-attributes">
        <h4 id="contact-attributes">Attributes</h4>
        {Object.keys(contact.attributes).length ? (
          <dl>{Object.entries(contact.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
        ) : <p>No custom attributes.</p>}
      </section>

      <section aria-labelledby="contact-consent">
        <h4 id="contact-consent">Consent</h4>
        <p>{contact.consent.optInAt ? `${contact.consent.optInSource} · ${formatDate(contact.consent.optInAt)}` : 'No opt-in timestamp recorded.'}</p>
        {contact.consent.history.length > 0 && (
          <details>
            <summary>{contact.consent.history.length} evidence record{contact.consent.history.length === 1 ? '' : 's'}</summary>
            <ul>{contact.consent.history.map((item) => <li key={item.id}><strong>{item.source}</strong> — {item.evidence} <small>{formatDate(item.occurredAt)}</small></li>)}</ul>
          </details>
        )}
      </section>

      <section aria-labelledby="contact-activity">
        <h4 id="contact-activity">Activity</h4>
        <div className="contact360Metrics">
          <span>Campaigns <strong>{activity.campaigns}</strong></span>
          <span>Clicks <strong>{activity.trackedClicks}</strong></span>
          <span>Orders <strong>{activity.orders}</strong></span>
          <span>Calls <strong>{activity.calls}</strong></span>
          <span>Flows <strong>{activity.flowEvents}</strong></span>
        </div>
      </section>

      <section aria-labelledby="contact-timeline">
        <h4 id="contact-timeline">Timeline</h4>
        {timeline.length ? (
          <ol className="contact360Timeline">
            {timeline.map((item) => (
              <li key={item.key}>
                <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
                <small className={`attribution ${item.attribution.level}`}>{item.attribution.label}</small>
              </li>
            ))}
          </ol>
        ) : <p>No activity recorded.</p>}
        {page.hasMore && (
          <button type="button" className="secondaryAction" onClick={() => loadTimeline(page.nextCursor, true)}>
            Load older activity
          </button>
        )}
      </section>
    </aside>
  );
}
