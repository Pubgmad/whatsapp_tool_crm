'use client';

import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import './whatsapp-modules.css';

export default function EcommercePlaybooksPanel({ api, postJson, role }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState({ connectorId: '', flowId: '', templateId: '', delayMinutes: 60, consentAcknowledged: false });
  const canEdit = role === 'Owner';

  const load = async () => {
    try {
      const result = await api('/api/commerce/playbooks');
      setData(result);
      if (!selected && result.playbooks?.[0]) setSelected(result.playbooks[0].id);
    } catch (cause) {
      setError(cause.message);
    }
  };

  useEffect(() => { load(); }, [api]);

  const playbook = (data?.playbooks || []).find((item) => item.id === selected);

  return (
    <section className="wa-module">
      <header className="wa-module-heading">
        <h2><ShoppingBag size={19} /> Ecommerce playbooks</h2>
      </header>
      {error && <p className="wa-module-error" role="alert">{error}</p>}
      {notice && <p className="formSuccess" role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading playbooks…</p>}
      <div className="capabilityGrid">
        {(data?.playbooks || []).map((item) => (
          <article key={item.id} className={selected === item.id ? 'is-selected' : ''}>
            <strong>{item.label}</strong>
            <small>{item.provider} · {item.kind}</small>
            <p>{item.description}</p>
            <button type="button" className="secondaryAction" onClick={() => {
              setSelected(item.id);
              setForm((c) => ({ ...c, delayMinutes: item.defaultDelayMinutes || 60 }));
            }}>Configure</button>
          </article>
        ))}
      </div>

      {playbook && canEdit && (
        <form className="formGrid" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setNotice('');
          try {
            await postJson('/api/commerce/playbooks', {
              action: 'activate',
              playbookId: playbook.id,
              ...form
            });
            setNotice('Playbook activated — messaging only runs when consent and eligibility pass');
            await load();
          } catch (cause) {
            setError(cause.message);
          } finally {
            setBusy(false);
          }
        }}>
          <h3>Activate: {playbook.label}</h3>
          {playbook.kind === 'checkout_recovery' && (
            <label>Connected store
              <select required value={form.connectorId} onChange={(e) => setForm((c) => ({ ...c, connectorId: e.target.value }))}>
                <option value="">Select store</option>
                {(data.connectors || []).filter((c) => c.provider === playbook.provider).map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.provider})</option>
                ))}
              </select>
            </label>
          )}
          <label>Utility / recovery workflow
            <select value={form.flowId} onChange={(e) => setForm((c) => ({ ...c, flowId: e.target.value }))} required={playbook.kind === 'commerce_preset'}>
              <option value="">Select flow</option>
              {(data.flows || []).map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
            </select>
          </label>
          <label>Approved template (optional)
            <select value={form.templateId} onChange={(e) => setForm((c) => ({ ...c, templateId: e.target.value }))}>
              <option value="">None</option>
              {(data.templates || []).map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.language})</option>)}
            </select>
          </label>
          <label>Delay (minutes)<input type="number" min={0} max={43200} value={form.delayMinutes} onChange={(e) => setForm((c) => ({ ...c, delayMinutes: Number(e.target.value) }))} /></label>
          <label><input type="checkbox" checked={form.consentAcknowledged} onChange={(e) => setForm((c) => ({ ...c, consentAcknowledged: e.target.checked }))} required /> I confirm recovery messages only go to eligible consented contacts</label>
          <button className="primaryAction" type="submit" disabled={busy || !form.consentAcknowledged}>Activate playbook</button>
        </form>
      )}

      <h3>Active activations</h3>
      <div className="wa-module-table">
        <table>
          <thead><tr><th>Playbook</th><th>Provider</th><th>Delay</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data?.activations || []).map((row) => (
              <tr key={row.id}>
                <td>{row.playbook_id}</td>
                <td>{row.provider}</td>
                <td>{row.delay_minutes}m</td>
                <td>{row.status}</td>
                <td>
                  {canEdit && row.status === 'active' && (
                    <button type="button" disabled={busy} onClick={async () => {
                      setBusy(true);
                      try {
                        await postJson('/api/commerce/playbooks', { action: 'setStatus', activationId: row.id, status: 'paused' });
                        await load();
                      } catch (cause) {
                        setError(cause.message);
                      } finally {
                        setBusy(false);
                      }
                    }}>Pause</button>
                  )}
                </td>
              </tr>
            ))}
            {!data?.activations?.length && <tr><td colSpan={5}>No activations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
