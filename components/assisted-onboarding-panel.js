'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, HelpCircle, Sparkles } from 'lucide-react';
import './whatsapp-modules.css';

export default function AssistedOnboardingPanel({ api, postJson, role, setActiveView, experienceMode }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [businessNotes, setBusinessNotes] = useState('');
  const [helpType, setHelpType] = useState('meta_connection');
  const [helpText, setHelpText] = useState('');

  const load = async () => {
    setError('');
    try {
      const result = await api('/api/onboarding/assisted');
      setData(result);
      const steps = result.steps || [];
      const current = result.state?.currentStep;
      const idx = Math.max(0, steps.findIndex((step) => step.id === current));
      setStepIndex(idx >= 0 ? idx : 0);
      setBusinessNotes(result.state?.businessNotes || '');
      const topics = result.conciergeTopics || [];
      if (topics.length && !topics.some((topic) => topic.id === helpType)) {
        setHelpType(topics[0].id);
      }
    } catch (cause) {
      setError(cause.message);
    }
  };

  useEffect(() => { load(); }, [api]);

  if (error && !data) return <p className="formError" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading guided setup…</p>;

  const steps = data.steps?.length ? data.steps : [{ id: 'goal', label: 'Choose your goal', help: '' }];
  const step = steps[stepIndex] || steps[0];
  const canEdit = role === 'Owner' || role === 'Manager';

  const save = async (patch, nextStep) => {
    if (!canEdit) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await postJson('/api/onboarding/assisted', {
        action: 'saveProgress',
        currentStep: nextStep || step.id,
        state: { ...patch, currentStep: nextStep || step.id }
      });
      setNotice('Progress saved');
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screenGrid">
      <section className="actionBand">
        <div>
          <strong>Get started</strong>
          <span>Plain-language setup for WhatsApp — no WABA jargon required.</span>
        </div>
        <div className="actionCluster wa-module-wrap">
          {canEdit && (
            <button
              type="button"
              className="secondaryAction"
              disabled={busy}
              onClick={async () => {
                await save({ businessNotes, resumedAt: new Date().toISOString() }, step.id);
                setActiveView?.('overview');
              }}
            >
              Resume later
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="secondaryAction"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const next = (experienceMode || data.experienceMode) === 'simple' ? 'advanced' : 'simple';
                  await postJson('/api/onboarding/assisted', { action: 'setExperienceMode', mode: next });
                  setNotice(`Switched to ${next} mode`);
                  await load();
                  window.location.reload();
                } catch (cause) {
                  setError(cause.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {(experienceMode || data.experienceMode) === 'simple' ? 'Switch to Advanced' : 'Switch to Simple Mode'}
            </button>
          )}
        </div>
      </section>
      {error && <p className="formError" role="alert">{error}</p>}
      {notice && <p className="formSuccess" role="status">{notice}</p>}

      <section className="wa-module">
        <header className="wa-module-heading">
          <h2>Step {stepIndex + 1} of {steps.length}: {step.label}</h2>
        </header>
        {step.help && <p className="wa-module-note">{step.help}</p>}

        {step.id === 'business' && (
          <form className="formGrid" onSubmit={(event) => {
            event.preventDefault();
            save({ businessNotes }, steps[Math.min(stepIndex + 1, steps.length - 1)]?.id);
            setStepIndex((i) => Math.min(i + 1, steps.length - 1));
          }}>
            <label>About your business<textarea rows={3} value={businessNotes} onChange={(e) => setBusinessNotes(e.target.value)} placeholder="Retail shop, clinic, online store…" /></label>
            <button className="primaryAction" type="submit" disabled={busy || !canEdit}>Continue</button>
          </form>
        )}

        {(step.id === 'connect' || step.id === 'verify') && (
          <div className="actionCluster">
            <p className="wa-module-note">
              WhatsApp: {data.whatsappConnected ? `Connected${data.phoneDisplay ? ` (${data.phoneDisplay})` : ''}` : 'Not connected yet'}
            </p>
            <button type="button" className="primaryAction" onClick={() => setActiveView?.('setup')}>Open WhatsApp connection</button>
            <button type="button" className="secondaryAction" disabled={busy || !canEdit} onClick={() => {
              save({ [`${step.id}Seen`]: true });
              setStepIndex((i) => Math.min(i + 1, steps.length - 1));
            }}>Continue</button>
          </div>
        )}

        {step.id === 'goal' && (
          <div className="capabilityGrid smbCapabilityGrid">
            {(data.goals || []).map((goal) => (
              <article key={goal.id} className={data.state?.goalId === goal.id ? 'is-selected' : ''}>
                <strong>{goal.label}</strong>
                <button type="button" className="secondaryAction" disabled={busy || !canEdit} onClick={async () => {
                  await save({ goalId: goal.id });
                  setActiveView?.(goal.next === 'bots' ? 'bots' : goal.next === 'commerce' ? 'commerce' : goal.next);
                }}>Choose</button>
              </article>
            ))}
          </div>
        )}

        {step.id === 'setup' && (
          <div className="actionCluster">
            <button type="button" className="primaryAction" onClick={() => setActiveView?.('bots')}><Sparkles size={16} /> Set up a bot</button>
            <button type="button" className="secondaryAction" onClick={() => setActiveView?.('campaigns')}>Draft a campaign</button>
            <button type="button" className="secondaryAction" onClick={() => setActiveView?.('integrations')}>Connect integrations</button>
            <button type="button" className="secondaryAction" disabled={busy || !canEdit} onClick={() => {
              save({ setupVisited: true });
              setStepIndex((i) => Math.min(i + 1, steps.length - 1));
            }}>Continue</button>
          </div>
        )}

        {(step.id === 'test' || step.id === 'live') && (
          <div>
            <p className="wa-module-note">Completion is based on verified checklist items below — not on clicking Next.</p>
            <button type="button" className="secondaryAction" disabled={busy || !canEdit} onClick={() => save({ [step.id]: true })}>Mark step reviewed</button>
          </div>
        )}

        <div className="actionCluster wa-module-wrap">
          <button type="button" className="secondaryAction" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>Back</button>
          <button type="button" className="secondaryAction" disabled={stepIndex >= steps.length - 1} onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}>Next</button>
        </div>
      </section>

      <section className="wa-module">
        <header className="wa-module-heading"><h2>Checklist</h2></header>
        <ul className="wa-module-checklist wa-module-note">
          {(data.checklist || []).map((item) => (
            <li key={item.id}>
              {item.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              <button type="button" className="linkish" onClick={() => {
                if (item.href?.includes('/bots')) setActiveView?.('bots');
                else if (item.href?.includes('integrations')) setActiveView?.('integrations');
                else if (item.href?.includes('contacts')) setActiveView?.('contacts');
                else if (item.href?.includes('campaigns')) setActiveView?.('campaigns');
                else setActiveView?.('setup');
              }}>{item.label}</button>
            </li>
          ))}
        </ul>
      </section>

      {data.conciergeEnabled && canEdit && (
        <section className="wa-module">
          <header className="wa-module-heading"><h2><HelpCircle size={18} /> Request assistance</h2></header>
          <p className="wa-module-note">Creates a support case for the platform team. Do not include passwords or API secrets.</p>
          <form className="formGrid" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await postJson('/api/onboarding/assisted', {
                action: 'requestHelp',
                requestType: helpType,
                description: helpText,
                whatsappConnected: data.whatsappConnected,
                experienceMode: data.experienceMode
              });
              setHelpText('');
              setNotice('Assistance request submitted');
            } catch (cause) {
              setError(cause.message);
            } finally {
              setBusy(false);
            }
          }}>
            <label>Topic
              <select value={helpType} onChange={(e) => setHelpType(e.target.value)}>
                {(data.conciergeTopics || []).map((topic) => (
                  <option key={topic.id} value={topic.id}>{topic.label}</option>
                ))}
              </select>
            </label>
            <label>Describe what you need<textarea rows={4} value={helpText} onChange={(e) => setHelpText(e.target.value)} required minLength={10} /></label>
            <button className="primaryAction" type="submit" disabled={busy}>Submit request</button>
          </form>
        </section>
      )}
    </div>
  );
}
