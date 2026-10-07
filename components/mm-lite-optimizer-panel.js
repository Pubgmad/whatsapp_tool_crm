'use client';

import { useEffect, useState } from 'react';
import HonestLimitsCallout from './honest-limits-callout';

export default function MmLiteOptimizerPanel({ api }) {
  const [report, setReport] = useState(null);
  useEffect(() => {
    let active = true;
    api('/api/workspace/operations')
      .then((value) => {
        if (active) setReport(value.marketingMessages);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  if (!report) return null;
  return (
    <div className="mmLitePanel">
      <HonestLimitsCallout limitId="mm_lite_optimizer" compact />
      <h4>Marketing Messages (MM Lite) send path</h4>
      <p role="status">
        Status: <strong>{report.marketingMessagesStatus}</strong> · send path: <strong>{report.sendPath}</strong>
      </p>
      {report.operatorNote && <p className="wa-module-note">{report.operatorNote}</p>}
      <ul>
        {(report.optimizerFeatures || []).map((feature) => (
          <li key={feature.id}>
            {feature.label} — controlled in {feature.controlSurface === 'meta' ? 'Meta' : 'CRM'}
          </li>
        ))}
      </ul>
    </div>
  );
}
