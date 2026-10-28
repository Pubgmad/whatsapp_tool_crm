'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import WorkspaceProductionHub from './workspace-production-hub';
import WorkspaceOperationsPanel from './workspace-operations-panel';
import CampaignFailedWorkbench from './campaign-failed-workbench';
import WorkspaceProductionCertPanel from './workspace-production-cert-panel';
import ParityReportPanel from './parity-report-panel';
import CampaignSourceAnalyticsPanel from './campaign-source-analytics-panel';
import JourneyReportPanel from './journey-report-panel';
import './whatsapp-modules.css';

function sectionMessage(sectionErrors, key, fallback) {
  const entry = sectionErrors?.[key];
  if (!entry?.message) return '';
  return entry.message || fallback;
}

export default function WorkspaceResultsManagerShell({ api, postJson }) {
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deepProbe, setDeepProbe] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const path = `/api/workspace/results-bundle${deepProbe ? '?probe=1' : ''}`;
      setBundle(await api(path));
    } catch (cause) {
      setBundle(null);
      setError(cause.message || 'Campaign insights could not be loaded for this workspace.');
    } finally {
      setBusy(false);
    }
  }, [api, deepProbe]);

  useEffect(() => {
    load();
  }, [load]);

  if (!bundle && !error) {
    return (
      <section className="wa-module analyticsInsightsShell" aria-busy="true">
        <header className="wa-module-heading saasPageHead">
          <div>
            <h2>Campaign insights</h2>
            <p className="wa-module-note">Loading campaign origins and journey outcomes…</p>
          </div>
        </header>
      </section>
    );
  }

  const sectionErrors = bundle?.sectionErrors || {};
  const originsError = sectionMessage(sectionErrors, 'campaignSources', 'Campaign origins unavailable.');

  return (
    <div className="workspaceQualityStack analyticsInsightsShell">
      <header className="wa-module-heading saasPageHead">
        <div>
          <h2>Campaign insights</h2>
          <p className="wa-module-note">Broadcast origins and journey outcomes for this workspace.</p>
        </div>
        <div className="wa-module-controls analyticsToolbar">
          <button type="button" className="secondaryAction" disabled={busy} onClick={load}>
            <RefreshCcw size={16} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="analyticsSectionError" role="alert">
          <strong>Campaign insights unavailable</strong>
          <p>{error}</p>
          <button type="button" className="secondaryAction" disabled={busy} onClick={load}>Retry</button>
        </div>
      )}

      {bundle && (
        <>
          {originsError ? (
            <div className="analyticsSectionError" role="alert">
              <strong>Campaign origins unavailable</strong>
              <p>{originsError}</p>
              <button type="button" className="secondaryAction" disabled={busy} onClick={load}>Retry</button>
            </div>
          ) : (
            <CampaignSourceAnalyticsPanel rows={bundle.campaignSources || []} />
          )}
          <JourneyReportPanel api={api} />
          <details className="techDetails saasAdvancedBlock">
            <summary>Go-live and production tools</summary>
            <div className="wa-module-controls">
              <label className="checkboxLabel">
                <input type="checkbox" checked={deepProbe} disabled={busy} onChange={(event) => setDeepProbe(event.target.checked)} />
                Live Meta probe on refresh
              </label>
            </div>
            {sectionErrors.hub && <p className="wa-module-error" role="status">Production hub: {sectionErrors.hub.message}</p>}
            {bundle.hub && <WorkspaceProductionHub api={api} hub={bundle.hub} />}
            {sectionErrors.operations && <p className="wa-module-error" role="status">Operations: {sectionErrors.operations.message}</p>}
            {bundle.operations && <WorkspaceOperationsPanel api={api} report={bundle.operations} />}
            {sectionErrors.failures && <p className="wa-module-error" role="status">Failed recipients: {sectionErrors.failures.message}</p>}
            {bundle.failures && <CampaignFailedWorkbench api={api} data={bundle.failures} postJson={postJson} onReload={load} />}
            {sectionErrors.certification && <p className="wa-module-error" role="status">Certification: {sectionErrors.certification.message}</p>}
            {bundle.certification && <WorkspaceProductionCertPanel api={api} certification={bundle.certification} />}
            {sectionErrors.parity && <p className="wa-module-error" role="status">Parity: {sectionErrors.parity.message}</p>}
            {bundle.parity && (
              <ParityReportPanel
                api={api}
                report={bundle.parity}
                title="Capability parity"
                subtitle="Go-live readiness checklist."
              />
            )}
          </details>
        </>
      )}
    </div>
  );
}
