'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, MessageSquare, RefreshCcw, Search, Send } from 'lucide-react';
import './whatsapp-modules.css';
import HonestLimitsCallout from './honest-limits-callout';

export default function WhatsAppGroups({ api, postJson, enabled, embedded = false }) {
  const [mode, setMode] = useState('groups');
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [messagePage, setMessagePage] = useState(1);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled) return;
    const params = new URLSearchParams({ page: String(page), pageSize: '20', messagePage: String(messagePage), messagePageSize: '50' });
    if (selectedId) params.set('groupId', selectedId);
    if (search) params.set('q', search);
    const result = await api(`/api/workspace/groups-inbox?${params}`);
    setData(result);
    if (!selectedId && result.selectedGroupId) setSelectedId(result.selectedGroupId);
  }, [api, enabled, messagePage, page, search, selectedId]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '20', messagePage: String(messagePage), messagePageSize: '50' });
    if (selectedId) params.set('groupId', selectedId);
    if (search) params.set('q', search);
    api(`/api/workspace/groups-inbox?${params}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        if (!selectedId && result.selectedGroupId) setSelectedId(result.selectedGroupId);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [api, enabled, messagePage, page, search, selectedId]);

  if (!enabled) {
    return (
      <section className="wa-module">
        <p>WhatsApp Groups are disabled for this workspace. Ask your platform administrator to enable the feature.</p>
      </section>
    );
  }

  const run = async (task) => {
    setBusy(true);
    setError('');
    try {
      await task();
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wa-module">
      <header className="wa-module-heading">
        <h2><MessageSquare size={19} /> Unified inbox</h2>
        <button type="button" title="Refresh groups" aria-label="Refresh groups" disabled={busy} onClick={() => run(load)}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {!embedded && <div className="wa-inbox-modes" role="tablist" aria-label="Inbox mode">
        <button type="button" role="tab" aria-selected={mode === 'direct'} className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}>1:1 conversations</button>
        <button type="button" role="tab" aria-selected={mode === 'groups'} className={mode === 'groups' ? 'active' : ''} onClick={() => setMode('groups')}>Groups</button>
      </div>}
      {error && <p className="wa-module-error" role="alert">{error}</p>}
      <HonestLimitsCallout limitId="whatsapp_groups" />
      {!embedded && mode === 'direct' ? (
        <div className="wa-inbox-empty" role="tabpanel">
          <h3>1:1 conversations</h3>
          <p>Use the main Inbox for customer conversations, assignments, notes, and automations. Group threads remain isolated here so group activity cannot be mistaken for a customer chat.</p>
        </div>
      ) : (
        <div role="tabpanel">
          <p role="status">Meta Groups entitlement: <strong>{data?.entitlement?.status || 'loading'}</strong></p>
          {data && !data.entitlement.entitled && <p className="wa-module-note">Group messaging is unavailable until Meta explicitly grants the Groups capability. No entitlement is simulated by this application.</p>}
          <div className="wa-group-toolbar">
            <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}>
              <label><span className="srOnly">Search groups</span><input value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="Search groups" /></label>
              <button type="submit"><Search size={17} /> Search</button>
            </form>
            <button type="button" className="secondaryAction" disabled={busy || !data?.entitlement?.entitled} onClick={() => run(async () => { await postJson('/api/whatsapp/groups', { action: 'sync' }); await load(); })}><RefreshCcw size={17} /> Sync from Meta</button>
          </div>
          <div className="wa-group-inbox">
            <aside aria-label="Group threads">
              {(data?.groups || []).map((group) => (
                <button key={group.id} type="button" className={selectedId === group.id ? 'active' : ''} onClick={() => run(async () => {
                  setSelectedId(group.id);
                  setMessagePage(1);
                  if (group.unreadCount) await postJson('/api/workspace/groups-inbox', { action: 'mark_read', groupId: group.id });
                })}>
                  <span><strong>{group.subject}</strong>{group.unreadCount > 0 && <b aria-label={`${group.unreadCount} unread`}>{group.unreadCount}</b>}</span>
                  <small>{group.latestMessage?.body || `${group.participantCount} participants`}</small>
                </button>
              ))}
              {!data?.groups?.length && <p>No synced groups match this search.</p>}
              <nav className="wa-group-pagination" aria-label="Group pages">
                <button type="button" disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
                <span>{data?.pagination?.groups?.page || 1} / {data?.pagination?.groups?.pages || 1}</span>
                <button type="button" disabled={busy || page >= (data?.pagination?.groups?.pages || 1)} onClick={() => setPage((value) => value + 1)}>Next</button>
              </nav>
            </aside>
            <article className="wa-group-thread" aria-live="polite">
              <div className="wa-group-messages">
                {data?.pagination?.messages?.pages > 1 && <button type="button" disabled={busy || messagePage >= data.pagination.messages.pages} onClick={() => setMessagePage((value) => value + 1)}>Load older messages</button>}
                {(data?.messages || []).map((message) => (
                  <div key={message.id} className={`wa-group-message ${message.direction}`}>
                    <p>{message.body || '[Empty message]'}</p>
                    <small>{message.unsupported ? 'Unsupported content shown safely' : message.type} · {message.status}</small>
                  </div>
                ))}
                {selectedId && !data?.messages?.length && <p>No messages in this group yet.</p>}
              </div>
              <form onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  await postJson('/api/workspace/groups-inbox', { action: 'send', groupId: selectedId, text });
                  setText('');
                });
              }}>
                <label>Message<textarea required maxLength={4096} rows={3} value={text} onChange={(event) => setText(event.target.value)} /></label>
                <button type="submit" disabled={busy || !selectedId || !data?.entitlement?.entitled}><Send size={17} /> Send to group</button>
                <small><CheckCheck size={14} /> Delivery status updates appear beside each message.</small>
              </form>
            </article>
          </div>
        </div>
      )}
    </section>
  );
}
