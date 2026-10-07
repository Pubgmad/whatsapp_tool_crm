'use client';

import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';

export default function ImprovementBacklogPanel({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/super-admin/improvement-backlog')
      .then(setData)
      .catch((cause) => setError(cause.message));
  }, [api]);

  if (error) return <section className="parityPanel"><p role="alert">{error}</p></section>;
  if (!data) return <section className="parityPanel"><p>Loading improvement backlog…</p></section>;

  return (
    <section className="parityPanel">
      <h2><ListChecks size={20} /> Improvement backlog</h2>
      <p>
        <strong>{data.total}</strong> capabilities need live verification or further product work (
        <strong>{data.byStatus?.partial || 0}</strong> partial).
      </p>
      <details open>
        <summary>Top partial capabilities</summary>
        <table>
          <thead>
            <tr>
              <th>Capability</th>
              <th>Group</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {data.topPartial?.map((item) => (
              <tr key={item.id}>
                <td>{item.label}</td>
                <td>{item.groupLabel}</td>
                <td>{item.operatorNote || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
