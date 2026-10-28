'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';

export default function AutomationAiGenerator({ postJson, onGenerated, disabled = false }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const generate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const result = await postJson('/api/automation/generate', { prompt });
      onGenerated?.(result.flow);
      setNote(
        result.flow?.source === 'ai'
          ? 'AI generated a draft workflow. Review nodes, then save.'
          : result.providerAvailable === false
            ? 'OpenAI is not configured — loaded a starter preset. Review and edit before saving.'
            : 'Loaded a starter preset. Review and edit before saving.'
      );
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="automationAiGenerator formGrid" onSubmit={generate} aria-label="AI chatbot flow generator">
      <label>
        Describe the chatbot
        <textarea
          rows={3}
          maxLength={2000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="e.g. Qualify leads for a demo, ask company size, then hand off to sales"
          required
          disabled={disabled || busy}
        />
      </label>
      {error && <p role="alert" className="formError">{error}</p>}
      {note && <p role="status" className="fieldHint">{note}</p>}
      <button className="primaryAction" type="submit" disabled={disabled || busy || prompt.trim().length < 8}>
        <Sparkles size={16} /> Generate workflow
      </button>
    </form>
  );
}
