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
      setError(cause.message || 'Could not load manager results');
    } finally {
      setBusy(false);
    }
  }, [api, deepProbe]);

  useEffect(() => {
    load();
  }, [load]);

  if (!bundle && !error) {
    return <section className="parityPanel"><p>Loading production results…</p></section>;
  }

  return (
    <div className="workspaceQualityStack">
      <header className="wa-module-heading">
        <h2>Production results</h2>
        <div className="wa-module-controls">
          <label className="checkboxLabel">
            <input type="checkbox" checked={deepProbe} disabled={busy} onChange={(event) => setDeepProbe(event.target.checked)} />
            Live Meta probe on refresh
          </label>
          <button type="button" title="Refresh" aria-label="Refresh production results" disabled={busy} onClick={load}>
            <RefreshCcw size={18} />
          </button>
        </div>
      </header>
      {error && <p role="alert" className="wa-module-error">{error}</p>}
      {bundle && (
        <>
          <CampaignSourceAnalyticsPanel rows={bundle.campaignSources || []} />
          <JourneyReportPanel api={api} />
          <WorkspaceProductionHub api={api} hub={bundle.hub} />
          <WorkspaceOperationsPanel api={api} report={bundle.operations} />
          <CampaignFailedWorkbench api={api} data={bundle.failures} postJson={postJson} onReload={load} />
          <WorkspaceProductionCertPanel api={api} certification={bundle.certification} />
          <ParityReportPanel
            api={api}
            report={bundle.parity}
            title="Workspace capability parity"
            subtitle="Filtered registry for go-live review."
          />
        </>
      )}
    </div>
  );
}
