'use client';

import ParityReportPanel from './parity-report-panel';
import WorkspaceProductionCertPanel from './workspace-production-cert-panel';

export default function WorkspaceQualityPanel({ api }) {
  return (
    <div className="workspaceQualityStack">
      <WorkspaceProductionCertPanel api={api} />
      <ParityReportPanel
        api={api}
        parityPath="/api/workspace/parity"
        title="Workspace capability parity"
        subtitle="Live registry for this tenant (code vs live verification). Super Admin owns platform attestation; owners and managers use this checklist before go-live."
      />
    </div>
  );
}
