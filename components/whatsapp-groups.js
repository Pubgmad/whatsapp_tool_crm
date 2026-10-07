'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, RefreshCcw } from 'lucide-react';
import './whatsapp-modules.css';
import HonestLimitsCallout from './honest-limits-callout';

export default function WhatsAppGroups({ api, postJson, enabled }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!enabled) return;
    setData(await api('/api/whatsapp/groups'));
  };

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api('/api/whatsapp/groups')
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [api, enabled]);

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
        <h2><MessageSquare size={19} /> WhatsApp Groups</h2>
        <button type="button" title="Refresh groups" aria-label="Refresh groups" disabled={busy} onClick={() => run(load)}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {error && <p className="wa-module-error" role="alert">{error}</p>}
      <HonestLimitsCallout limitId="whatsapp_groups" />
      {data?.operatorNote && <p className="wa-module-note">{data.operatorNote}</p>}
      <p role="status">Meta capability: {data?.metaCapability || 'loading'}</p>
      <button
        type="button"
        className="primaryAction"
        disabled={busy}
        onClick={() => run(() => postJson('/api/whatsapp/groups', { action: 'sync' }))}
      >
        Sync groups from Meta
      </button>
      <div className="wa-module-table">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Participants</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.groups || []).map((group) => (
              <tr key={group.id}>
                <td>{group.subject || group.meta_group_id}</td>
                <td>{group.participant_count}</td>
                <td>{group.sync_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="wa-module-controls"
        onSubmit={(event) => {
          event.preventDefault();
          run(async () => {
            await postJson('/api/whatsapp/groups', { action: 'send', groupId, text });
            setText('');
          });
        }}
      >
        <label>
          Group ID
          <select required value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">Select synced group</option>
            {(data?.groups || []).map((group) => (
              <option key={group.id} value={group.meta_group_id}>{group.subject || group.meta_group_id}</option>
            ))}
          </select>
        </label>
        <label>
          Message
          <textarea required maxLength={4096} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !groupId}>Send to group</button>
      </form>
    </section>
  );
}
