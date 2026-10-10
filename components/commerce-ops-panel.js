'use client';

import { useEffect, useState } from 'react';
import { RefreshCcw, ShoppingBag } from 'lucide-react';
import './whatsapp-modules.css';

export default function CommerceOpsPanel({ api, role }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canView = role === 'Owner' || role === 'Manager';

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await api('/api/workspace/commerce-ops'));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!canView) return undefined;
    let active = true;
    api('/api/workspace/commerce-ops')
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [api, canView]);

  if (!canView) return null;

  return (
    <section className="wa-module">
      <header className="wa-module-heading">
        <h2><ShoppingBag size={19} /> Commerce operations</h2>
        <button type="button" title="Refresh commerce summary" aria-label="Refresh commerce summary" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {error && <p role="alert" className="wa-module-error">{error}</p>}
      {data && (
        <div className="wa-module-table">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>WhatsApp orders (total)</td><td>{data.orders?.total ?? 0}</td></tr>
              <tr><td>Open fulfillment</td><td>{data.orders?.open ?? 0}</td></tr>
              <tr><td>Paid orders</td><td>{data.orders?.paid ?? 0}</td></tr>
              <tr><td>Open merchant checkouts</td><td>{data.merchantCheckoutsOpen ?? 0}</td></tr>
              <tr><td>Open native checkouts</td><td>{data.nativeCheckoutsOpen ?? 0}</td></tr>
              <tr><td>Recovery queue (pending)</td><td>{data.recoveryQueued ?? 0}</td></tr>
              <tr><td>Recovery detected (30d)</td><td>{data.checkoutRecovery?.detected ?? '—'}</td></tr>
              <tr><td>Recovery queued (30d)</td><td>{data.checkoutRecovery?.queued ?? '—'}</td></tr>
              <tr><td>Recovered checkouts (30d)</td><td>{data.checkoutRecovery?.recovered ?? '—'}</td></tr>
              <tr><td>Recovered revenue (verified)</td><td>{data.checkoutRecovery?.recoveredRevenue ?? '0'} {data.checkoutRecovery?.recoveredCurrency || ''}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {data?.awaitingLiveVerification?.length > 0 && (
        <aside className="wa-module-note" role="note">
          <strong>Awaiting live verification:</strong>
          <ul>{data.awaitingLiveVerification.map((item) => <li key={item}>{item}</li>)}</ul>
        </aside>
      )}
      {!data && !error && <p role="status">Loading commerce summary…</p>}
    </section>
  );
}
