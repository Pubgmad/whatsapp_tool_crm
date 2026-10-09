'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCcw } from 'lucide-react';
import { campaignSourceLabel, campaignSourceOptions } from '../lib/campaign-source-labels.js';
import './whatsapp-modules.css';

export default function JourneyReportPanel({ api }) {
  const [sourceKind, setSourceKind] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (sourceKind) params.set('sourceKind', sourceKind);
      const result = await api(`/api/workspace/journey-report?${params}`);
      setRows(result.rows || []);
    } catch (cause) {
      setError(cause.message);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }, [api, sourceKind]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="wa-module" aria-labelledby="journey-report-title">
      <header className="wa-module-heading">
        <h3 id="journey-report-title"><Activity size={18} /> Journey attribution report</h3>
        <button type="button" title="Refresh journey report" aria-label="Refresh journey report" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>
      <p className="wa-module-note">Evidence-qualified journeys filtered by campaign origin (workspace broadcast, API, drip, retarget, and more).</p>
      <div className="wa-module-controls">
        <label>
          Campaign origin
          <select value={sourceKind} disabled={busy} onChange={(event) => setSourceKind(event.target.value)}>
            <option value="">All origins</option>
            {campaignSourceOptions().map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="wa-module-error">{error}</p>}
      {rows.length > 0 && (
        <div className="wa-module-table">
          <table>
            <thead>
              <tr>
                <th>Contact</th>
                <th>Confidence</th>
                <th>Orders</th>
                <th>Campaign delivered</th>
                <th>Referral</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.contactId}>
                  <td>{row.name || row.phone}<small>{row.phone}</small></td>
                  <td>{row.attributionConfidence.replaceAll('_', ' ')}</td>
                  <td>{row.orders}</td>
                  <td>{row.campaignDelivered}{Object.keys(row.campaignSources || {}).length > 0 && (
                    <small>{Object.entries(row.campaignSources).map(([kind, count]) => `${campaignSourceLabel(kind)}: ${count}`).join(' · ')}</small>
                  )}</td>
                  <td>{row.referral || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!busy && !error && !rows.length && <p role="status">No journey rows match this filter yet.</p>}
    </section>
  );
}
