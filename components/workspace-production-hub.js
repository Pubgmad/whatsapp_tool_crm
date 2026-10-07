'use client';

import { useEffect, useState } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';
import HonestLimitsCallout from './honest-limits-callout';

const SECTION_LABELS = {
  coreCrm: 'Core CRM',
  campaignsGrowth: 'Campaigns & growth',
  flowsAutomation: 'Flows & automation',
  aiBots: 'AI & bots',
  adsAttribution: 'Ads & attribution',
  commercePayments: 'Commerce & payments',
  integrations: 'Integrations',
  metaWhatsapp: 'Meta WhatsApp',
  platformSaas: 'Platform & SaaS',
  productBoundaries: 'Product boundaries'
};

function Metric({ label, value, detail }) {
  return (
    <article className="productionHubMetric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

export default function WorkspaceProductionHub({ api, hub: hubProp = null }) {
  const [hub, setHub] = useState(hubProp);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setHub(await api('/api/workspace/production-hub'));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setHub(hubProp);
  }, [hubProp]);

  useEffect(() => {
    if (hubProp) return;
    load();
  }, [api, hubProp]);

  if (!hub && !error) return <section className="productionHub"><p>Loading production dashboard…</p></section>;

  const cert = hub?.certification;

  return (
    <section className="productionHub">
      <header className="wa-module-heading">
        <h2><Activity size={20} /> Production CRM dashboard</h2>
        <button type="button" title="Refresh" aria-label="Refresh production dashboard" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {error && <p role="alert" className="wa-module-error">{error}</p>}
      {cert && (
        <p role="status">
          Workspace certification: <strong>{cert.ready ? 'Ready' : 'Needs attention'}</strong>
          {' · '}
          {cert.checks.filter((c) => !c.pass).length} open check(s)
        </p>
      )}
      {hub?.sections && Object.entries(hub.sections).map(([key, section]) => (
        <details key={key} className="productionHubSection" open={key === 'coreCrm' || key === 'productBoundaries'}>
          <summary>{SECTION_LABELS[key] || key}</summary>
          {key === 'coreCrm' && (
            <div className="productionHubGrid">
              <Metric label="Waiting conversations" value={section.inbox?.waitingNow ?? '—'} detail={`${section.inbox?.breachedNow ?? 0} SLA breached`} />
              <Metric label="Assigned open" value={section.inbox?.openAssigned ?? '—'} />
              <Metric label="7d SLA breaches" value={section.inbox?.breached7d ?? '—'} />
            </div>
          )}
          {key === 'campaignsGrowth' && (
            <div className="productionHubGrid">
              <Metric label="Active campaigns" value={section.campaigns?.activeCampaigns ?? 0} />
              <Metric label="Failed recipients" value={section.campaigns?.failedRecipients ?? 0} detail="Use Retry failed on each campaign" />
              <Metric label="MM API status" value={section.marketingMessages?.marketingMessagesStatus ?? 'UNKNOWN'} />
              <Metric label="Queue SLO" value={section.operations?.queue?.slo?.lagOk ? 'OK' : 'Attention'} />
            </div>
          )}
          {key === 'flowsAutomation' && (
            <p>Active automation flows: <strong>{section.automationFlows ?? 0}</strong> · Flow drop-off rows: {section.flowDropOff?.length ?? 0}</p>
          )}
          {key === 'aiBots' && (
            <div className="productionHubGrid">
              <Metric label="Safety events (24h)" value={section.safety?.last24h?.total ?? 0} />
              <Metric label="Injection blocks" value={section.safety?.last24h?.injection ?? 0} />
              <Metric label="AI requests (30d)" value={section.aiUsage?.totalRequests30d ?? 0} />
            </div>
          )}
          {key === 'adsAttribution' && (
            <div className="productionHubGrid">
              <Metric label="Ads connected" value={section.ads?.connected ? 'Yes' : 'No'} />
              <Metric label="CRM ad operations" value={section.ads?.operationsTotal ?? 0} />
              <Metric label="Active experiments" value={section.ads?.activeExperiments ?? 0} />
            </div>
          )}
          {key === 'commercePayments' && (
            <div className="productionHubGrid">
              <Metric label="WhatsApp orders" value={section.commerce?.ordersTotal ?? 0} />
              <Metric label="Open orders" value={section.commerce?.openOrders ?? 0} />
              <Metric label="Billing check" value={section.billingReady ? 'Pass' : 'Review'} />
            </div>
          )}
          {key === 'integrations' && (
            <ul className="productionHubList">
              {section.connectors?.slice(0, 12).map((item) => (
                <li key={item.id}>{item.label}: {item.connected ? 'connected' : 'not connected'}{item.lastError ? ` (${item.lastError})` : ''}</li>
              ))}
              {section.recipes?.map((r) => (
                <li key={r.id}>{r.label} (recipe)</li>
              ))}
            </ul>
          )}
          {key === 'metaWhatsapp' && (
            <div className="productionHubGrid">
              <Metric label="Meta health" value={section.healthStatus} />
              <Metric label="Registered numbers" value={section.registeredNumbers} />
              <Metric label="Synced groups" value={section.syncedGroups} />
              <Metric label="Groups API" value={section.capabilities?.groups_messaging?.status ?? 'UNKNOWN'} />
            </div>
          )}
          {key === 'platformSaas' && (
            <div className="productionHubGrid">
              <Metric label="Subscription" value={section.subscriptionStatus} />
              <Metric label="A11y E2E certified" value={section.a11y?.certified ? 'Yes' : 'Run test:e2e + record:a11y'} />
              <Metric label="Partial capabilities" value={section.partialCapabilities} detail={`${section.improvementBacklogCount} tracked in registry`} />
            </div>
          )}
          {key === 'productBoundaries' && (
            <ul className="productionHubList">
              {section.limits?.map((limit) => (
                <li key={limit.id}><strong>{limit.title}:</strong> {limit.boundary}</li>
              ))}
            </ul>
          )}
        </details>
      ))}
      <HonestLimitsCallout limitId="ai_safety_eval" compact />
    </section>
  );
}
