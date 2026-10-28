'use client';

import { WalletCards, RefreshCcw } from 'lucide-react';

export default function MetaBillingVisibility({ capability, onRefresh, busy = false }) {
  if (!capability) {
    return (
      <section className="wa-module metaBillingPanel" aria-label="Meta billing visibility">
        <header className="wa-module-heading">
          <strong><WalletCards size={16} /> Meta billing visibility</strong>
        </header>
        <p className="wa-module-note">Refresh entitlements after configuring platform billing credentials.</p>
      </section>
    );
  }

  const state = capability.state || (capability.status === 'available' ? 'active' : capability.status === 'setup' ? 'eligible' : 'unavailable');
  const diagnostics = capability.diagnostics || {};
  const kind = state === 'active' ? 'good' : state === 'eligible' ? 'warn' : state === 'error' ? 'bad' : 'neutral';

  return (
    <section className="wa-module metaBillingPanel" aria-label="Meta billing visibility">
      <header className="wa-module-heading saasPageHeadToolbar">
        <div>
          <strong className="wa-module-toolbarLabel"><WalletCards size={16} /> Meta billing / credit line</strong>
          <span className="wa-module-subhead">{capability.detail || capability.prerequisite}</span>
        </div>
        {onRefresh && (
          <button type="button" title="Refresh billing visibility" aria-label="Refresh billing visibility" disabled={busy} onClick={onRefresh}>
            <RefreshCcw size={18} />
          </button>
        )}
      </header>
      <div className="readinessList">
        <div className={state === 'active' ? 'ready' : ''}>
          <span>Billing state</span>
          <span className={`badgeTone ${kind}`}>{state}</span>
          <small>{diagnostics.reasonCode || '—'}</small>
        </div>
        <div>
          <span>Credit lines seen</span>
          <strong>{Number(diagnostics.creditLineCount || 0)}</strong>
          <small>Allocation verified: {diagnostics.allocationVerified ? 'yes' : 'no'}</small>
        </div>
        {Array.isArray(diagnostics.missingScopes) && diagnostics.missingScopes.length > 0 && (
          <div>
            <span>Missing scopes</span>
            <small>{diagnostics.missingScopes.join(', ')}</small>
          </div>
        )}
        {diagnostics.checkedAt && (
          <div>
            <span>Last checked</span>
            <small>{new Date(diagnostics.checkedAt).toLocaleString()}</small>
          </div>
        )}
      </div>
      <p className="wa-module-note">
        Credit-line sharing and prepaid Meta wallets are managed by Meta / Solution Partners.
        This panel shows live visibility when the platform system user has eligible billing access.
      </p>
    </section>
  );
}
