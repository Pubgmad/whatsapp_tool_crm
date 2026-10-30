'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plug, Search } from 'lucide-react';
import './whatsapp-modules.css';

export default function ConnectorMarketplacePanel({ api, postJson, role, setActiveView }) {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [secretReveal, setSecretReveal] = useState(null);
  const canEdit = role === 'Owner' || role === 'Manager';

  const load = async () => {
    try {
      setData(await api('/api/integrations/marketplace/connectors'));
    } catch (cause) {
      setError(cause.message);
    }
  };

  useEffect(() => { load(); }, [api]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const providers = data?.providers || [];
    if (!term) return providers;
    return providers.filter((item) => `${item.label} ${item.summary} ${item.category}`.toLowerCase().includes(term));
  }, [data, query]);

  const run = async (fn, success) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      if (success) setNotice(success);
      if (result?.secret) setSecretReveal(result);
      await load();
      return result;
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wa-module">
      <header className="wa-module-heading">
        <h2><Plug size={19} /> Connector marketplace</h2>
      </header>
      {error && <p className="wa-module-error" role="alert">{error}</p>}
      {notice && <p className="formSuccess" role="status">{notice}</p>}
      {data?.operatorNote && <p className="wa-module-note">{data.operatorNote}</p>}
      <label className="searchBox">
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search connectors" />
      </label>
      <div className="capabilityGrid">
        {filtered.map((provider) => (
          <article key={provider.id}>
            <strong>{provider.label}</strong>
            <small>{provider.category} · {provider.installStatus}</small>
            <p>{provider.summary}</p>
            <p className="wa-module-note">{provider.connectionNote}</p>
            {provider.inboundUrl && <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{provider.inboundUrl}</code>}
            <div className="actionCluster">
              {provider.id === 'google_sheets' && (
                <button type="button" className="secondaryAction" onClick={() => setActiveView?.('bots')}>Open Sheets bot</button>
              )}
              {provider.id === 'zoho_crm' && canEdit && provider.installStatus !== 'connected' && (
                <button type="button" className="primaryAction" disabled={busy || !provider.platformReady} onClick={() => run(async () => {
                  const result = await postJson('/api/integrations/marketplace/connectors', { action: 'startZoho', provider: 'zoho_crm' });
                  if (result.url) window.location.href = result.url;
                  return result;
                })}>Connect Zoho</button>
              )}
              {provider.id === 'zoho_crm' && canEdit && provider.installStatus === 'connected' && (
                <button type="button" className="secondaryAction" disabled={busy} onClick={() => run(
                  () => postJson('/api/integrations/marketplace/connectors', { action: 'testZoho', provider: 'zoho_crm' }),
                  'Zoho connection verified'
                )}>Test connection</button>
              )}
              {['zapier', 'pabbly'].includes(provider.id) && canEdit && (
                <button type="button" className="primaryAction" disabled={busy} onClick={() => run(
                  () => postJson('/api/integrations/marketplace/connectors', { action: 'installWebhook', provider: provider.id }),
                  'Webhook credentials created — copy the secret now'
                )}>Generate webhook</button>
              )}
              {['zapier', 'pabbly'].includes(provider.id) && canEdit && provider.installStatus === 'connected' && (
                <button type="button" className="secondaryAction" disabled={busy} onClick={() => run(async () => {
                  const outboundUrl = window.prompt('Paste your Zapier/Pabbly Catch Hook HTTPS URL (leave blank to clear)');
                  if (outboundUrl === null) return null;
                  return postJson('/api/integrations/marketplace/connectors', {
                    action: 'setOutboundUrl',
                    provider: provider.id,
                    outboundUrl: outboundUrl.trim()
                  });
                }, 'Outbound webhook saved')}>
                  {provider.outboundConfigured ? 'Update outbound URL' : 'Set outbound URL'}
                </button>
              )}
              {['shopify', 'woocommerce'].includes(provider.id) && (
                <button type="button" className="secondaryAction" onClick={() => setActiveView?.('integrations')}>Open store connectors</button>
              )}
              {provider.installStatus === 'connected' && canEdit && !['shopify', 'woocommerce', 'google_sheets'].includes(provider.id) && (
                <button type="button" className="secondaryAction" disabled={busy} onClick={() => run(
                  () => postJson('/api/integrations/marketplace/connectors', { action: 'disconnect', provider: provider.id }),
                  'Disconnected'
                )}>Disconnect</button>
              )}
            </div>
          </article>
        ))}
      </div>
      {secretReveal?.secret && (
        <div className="wa-module-setup" role="status">
          <strong>Copy once — webhook signing secret</strong>
          <p>Header: <code>{secretReveal.header || 'x-mathstrat-signature'}</code></p>
          <p>URL: <code>{secretReveal.inboundUrl}</code></p>
          <p>Secret: <code>{secretReveal.secret}</code></p>
          <p>{secretReveal.note}</p>
          <button type="button" className="secondaryAction" onClick={() => setSecretReveal(null)}>Dismiss</button>
        </div>
      )}
    </section>
  );
}
