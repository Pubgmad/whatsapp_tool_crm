'use client';

import { campaignSourceLabel } from '../lib/campaign-source-labels.js';
import './whatsapp-modules.css';

export default function CampaignSourceAnalyticsPanel({ rows = [] }) {
  if (!rows.length) {
    return (
      <section className="wa-module" aria-labelledby="campaign-source-title">
        <header className="wa-module-heading">
          <h3 id="campaign-source-title">Campaign origins</h3>
        </header>
        <div className="campaignOriginsEmpty">
          <strong>No campaign send history yet</strong>
          <p>Origins appear after broadcasts, public API sends, drip sequences, recurring children, or retarget campaigns run in this workspace.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="wa-module" aria-labelledby="campaign-source-title">
      <header className="wa-module-heading">
        <h3 id="campaign-source-title">Campaign origins</h3>
      </header>
      <div className="wa-module-table campaignOriginsTable">
        <table>
          <thead>
            <tr>
              <th scope="col">Origin</th>
              <th scope="col">Reference</th>
              <th scope="col">Campaigns</th>
              <th scope="col">Recipients</th>
              <th scope="col">Delivered</th>
              <th scope="col">Read</th>
              <th scope="col">Failed</th>
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
