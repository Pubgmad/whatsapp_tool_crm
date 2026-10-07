'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';

export default function AutomationSimulatorPanel({ postJson, definition }) {
  const [text, setText] = useState('hello');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError('');
    try {
      const response = await postJson('/api/automation/simulate', { definition, input: { text } });
      setResult(response);
    } catch (cause) {
      setError(cause.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wa-module">
      <h3>Flow simulator</h3>
      <p className="wa-module-note">Dry-run the current automation graph against sample inbound text (manager only).</p>
      <label>
        Sample customer message
        <input value={text} onChange={(event) => setText(event.target.value)} maxLength={500} />
      </label>
      <button type="button" className="secondaryAction" disabled={busy || !definition?.nodes?.length} onClick={run}>
        <Play size={16} /> Run simulation
      </button>
      {error && <p role="alert">{error}</p>}
      {result?.steps && (
        <ol>
          {result.steps.map((step, index) => (
            <li key={index}>{step.type} — {step.detail || step.nodeId}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
