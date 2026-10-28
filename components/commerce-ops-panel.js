'use client';

import { useEffect, useState } from 'react';
import { RefreshCcw, ShoppingBag } from 'lucide-react';
import './whatsapp-modules.css';

function MetricCard({ label, value, hint }) {
  return (
    <article className="wa-ad-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

export default function CommerceOpsPanel({ api, role, onOpenOrders }) {
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
      setError(cause.message || 'Commerce summary could not be loaded.');
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!canView) return undefined;
    let active = true;
    api('/api/workspace/commerce-ops')
      .then((result) => { if (active) setData(result); })
      .catch((cause) => { if (active) { setError(cause.message || 'Commerce summary could not be loaded.'); setData(null); } });
    return () => { active = false; };
  }, [api, canView]);

  if (!canView) return null;

  const ordersTotal = data?.orders?.total ?? 0;
  const openFulfillment = data?.orders?.open ?? 0;
  const paidOrders = data?.orders?.paid ?? 0;
  const merchantOpen = data?.merchantCheckoutsOpen ?? 0;
  const nativeOpen = data?.nativeCheckoutsOpen ?? 0;
  const recoveryPending = data?.recoveryQueued ?? 0;
  const recovery = data?.checkoutRecovery;
  const hasActivity = ordersTotal > 0 || merchantOpen > 0 || nativeOpen > 0 || recoveryPending > 0;
  const connectorRows = Array.isArray(data?.connectorsByProvider) ? data.connectorsByProvider : [];
  const storeOrderRows = Array.isArray(data?.storeOrdersByProvider) ? data.storeOrdersByProvider : [];
  const connectorTotal = connectorRows.reduce((sum, row) => sum + Number(row.total || 0), 0);

  return (
    <section className="wa-module commerceOpsPanel" aria-label="Commerce operations summary">
      <header className="wa-module-heading saasPageHeadToolbar">
        <div>
          <strong className="wa-module-toolbarLabel">Commerce operations</strong>
          <span className="wa-module-subhead">Orders, checkouts, and recovery from verified workspace records</span>
        </div>
        <button type="button" title="Refresh commerce summary" aria-label="Refresh commerce summary" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>

      {error && (
        <div className="analyticsSectionError" role="alert">
          <strong>Could not load commerce summary</strong>
          <p>{error}</p>
          <button className="secondaryAction" type="button" onClick={load}>Retry</button>
        </div>
      )}

      {!data && !error && <p role="status">Loading commerce summary…</p>}

      {data && !error && (
        <>
          <div className="wa-ad-kpis" aria-label="Commerce metrics">
            <MetricCard label="WhatsApp orders" value={ordersTotal} hint="All time" />
            <MetricCard label="Open fulfillment" value={openFulfillment} hint="Needs action" />
            <MetricCard label="Paid orders" value={paidOrders} hint="Verified payment" />
            <MetricCard label="Open checkouts" value={merchantOpen + nativeOpen} hint={`Merchant ${merchantOpen} · Native ${nativeOpen}`} />
          </div>

          <div className="wa-ad-kpis" aria-label="Recovery metrics">
            <MetricCard label="Recovery queue" value={recoveryPending} hint="Pending reminders" />
            <MetricCard
              label="Detected (30d)"
              value={recovery ? recovery.detected : '—'}
              hint={recovery ? 'Abandoned checkouts' : 'Recovery analytics unavailable'}
            />
            <MetricCard
              label="Recovered (30d)"
              value={recovery ? recovery.recovered : '—'}
              hint={recovery && recovery.recoveredRevenue ? `${recovery.recoveredRevenue} ${recovery.recoveredCurrency || ''}`.trim() : 'Verified purchases only'}
            />
            <MetricCard
              label="Store connectors"
              value={connectorTotal}
              hint={connectorRows.length ? connectorRows.map((row) => `${row.provider}: ${row.enabled || 0}/${row.total || 0}`).join(' · ') : 'None configured'}
            />
          </div>

          {!hasActivity && (
            <div className="wa-module-empty" role="status">
              <strong>No commerce activity yet</strong>
              <p>
                Zero counts mean this workspace has no matching orders, open checkouts, or recovery queue rows — not a failed refresh.
                Enable catalog visibility on your WhatsApp number, or connect Shopify/WooCommerce, then manage orders in the table below.
              </p>
            </div>
          )}

          {storeOrderRows.length > 0 && (
            <p className="wa-module-note" role="status">
              Store-linked orders: {storeOrderRows.map((row) => `${row.provider} ${row.total}`).join(' · ')}
            </p>
          )}

          {Array.isArray(data.awaitingLiveVerification) && data.awaitingLiveVerification.length > 0 && (
            <details className="techDetails saasAdvancedBlock">
              <summary>External verification checklist</summary>
              <ul className="wa-module-note">{data.awaitingLiveVerification.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
