'use client';

import { campaignSourceLabel } from '../lib/campaign-source-labels.js';

export default function CampaignSourceAnalyticsPanel({ rows = [] }) {
  if (!rows.length) {
    return (
      <section className="wa-module" aria-labelledby="campaign-source-title">
        <h3 id="campaign-source-title">Campaign origins</h3>
        <p>No campaign send history yet. Origins distinguish workspace broadcasts, public API sends, drip sequences, recurring children, and retargets.</p>
      </section>
    );
  }
  return (
    <section className="wa-module" aria-labelledby="campaign-source-title">
      <header className="wa-module-heading">
        <h3 id="campaign-source-title">Campaign origins</h3>
      </header>
      <div className="wa-module-table">
        <table>
          <thead>
            <tr>
              <th>Origin</th>
              <th>Reference</th>
              <th>Campaigns</th>
              <th>Recipients</th>
              <th>Delivered</th>
              <th>Read</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sourceKind}:${row.sourceId || ''}`}>
                <td>{campaignSourceLabel(row.sourceKind)}</td>
                <td>{row.sourceId || '—'}</td>
                <td>{row.campaigns}</td>
                <td>{row.recipients}</td>
                <td>{row.delivered}</td>
                <td>{row.read}</td>
                <td>{row.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
