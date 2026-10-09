'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, CirclePause, CirclePlay, Pencil, Plus, Save, Trash2, UserPlus, X } from 'lucide-react';
import ApprovedTemplatePicker from './approved-template-picker';
import './campaign-drip-manager.css';

const endpoint = '/api/workspace/campaign-drip';
const blankStep = () => ({ templateId: '', offsetMinutes: 0, variablesText: '{}' });
const browserTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
};

export default function CampaignDripManager({
  api,
  postJson,
  role,
  businessId,
  segments = [],
  approvedTemplates = []
}) {
  const canManage = ['Owner', 'Manager'].includes(role);
  const [sequences, setSequences] = useState([]);
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeSegments = useMemo(() => segments.filter((segment) => segment.isActive !== false), [segments]);

  const load = useCallback(async () => {
    if (!canManage) return;
    setError('');
    try {
      const result = await api(endpoint);
      setSequences(result.sequences || []);
    } catch (failure) {
      setError(failure.message);
    }
  }, [api, canManage]);

  useEffect(() => { load(); }, [businessId, load]);

  if (!canManage) return null;

  const execute = async (action, values, success) => {
    if (busy) return;
    setBusy(`${values.id || values.sequenceId || 'new'}:${action}`);
    setError('');
    setNotice('');
    try {
      const result = await postJson(endpoint, { action, ...values });
      setNotice(typeof success === 'function' ? success(result) : success);
      setEditor(null);
      await load();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  };

  const startCreate = () => setEditor({
    id: '', name: '', timezone: browserTimezone(), segmentId: '', steps: [blankStep()]
  });
  const startEdit = (sequence) => setEditor({
    id: sequence.id,
    name: sequence.name,
    timezone: sequence.timezone,
    segmentId: sequence.segmentId || '',
    steps: sequence.steps.map((step) => ({
      templateId: step.templateId,
      offsetMinutes: step.offsetMinutes,
      variablesText: JSON.stringify(step.variables || {}, null, 2)
    }))
  });

  return <section className="dripManager" aria-labelledby="campaign-drip-title">
    <header className="dripManagerHeader">
      <div>
        <h2 id="campaign-drip-title">Campaign drip sequences</h2>
        <p>Enroll opted-in contacts into ordered, approved-template journeys.</p>
      </div>
      {!editor && <button type="button" className="primaryAction" onClick={startCreate}><Plus size={16} />New sequence</button>}
    </header>

    {editor && <SequenceEditor
      value={editor}
      setValue={setEditor}
      segments={activeSegments}
      approvedTemplates={approvedTemplates}
      api={api}
      busy={Boolean(busy)}
      onCancel={() => setEditor(null)}
      onSave={(definition) => execute(editor.id ? 'edit' : 'create', definition, editor.id ? 'Sequence updated.' : 'Sequence created.')}
    />}

    {error && <p className="errorLine" role="alert">{error}</p>}
    {notice && <p className="dripManagerNotice" role="status">{notice}</p>}

    <div className="dripSequenceList">
      {sequences.map((sequence) => <SequenceCard
        key={sequence.id}
        sequence={sequence}
        busy={busy.startsWith(`${sequence.id}:`)}
        onEdit={() => startEdit(sequence)}
        onAction={(action, extra = {}) => execute(action, { id: sequence.id, ...extra }, actionMessage(action))}
      />)}
      {!sequences.length && !editor && <p className="dripEmpty">No drip sequences yet.</p>}
    </div>
  </section>;
}

function SequenceEditor({ value, setValue, segments, approvedTemplates, api, busy, onCancel, onSave }) {
  const [localError, setLocalError] = useState('');
  const updateStep = (index, field, next) => setValue((current) => ({
    ...current,
    steps: current.steps.map((step, at) => at === index ? { ...step, [field]: next } : step)
  }));
  const move = (index, direction) => setValue((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.steps.length) return current;
    const steps = [...current.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    return { ...current, steps };
  });
  const submit = (event) => {
    event.preventDefault();
    try {
      const steps = value.steps.map((step, index) => {
        let variables;
        try { variables = JSON.parse(step.variablesText || '{}'); }
        catch { throw new Error(`Step ${index + 1} variables must be valid JSON.`); }
        if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error(`Step ${index + 1} variables must be a JSON object.`);
        return { templateId: step.templateId, offsetMinutes: Number(step.offsetMinutes), variables };
      });
      setLocalError('');
      onSave({ id: value.id, name: value.name, timezone: value.timezone, segmentId: value.segmentId || null, steps });
    } catch (failure) {
      setLocalError(failure.message);
    }
  };
  return <form className="dripEditor" onSubmit={submit}>
    <div className="dripEditorGrid">
      <label>Sequence name<input required maxLength="120" value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} /></label>
      <label>Time zone<input required value={value.timezone} onChange={(event) => setValue({ ...value, timezone: event.target.value })} /></label>
      <label>Enrollment segment<select value={value.segmentId} onChange={(event) => setValue({ ...value, segmentId: event.target.value })}>
        <option value="">No default segment</option>
        {segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}{Number.isFinite(segment.contactCount) ? ` (${segment.contactCount})` : ''}</option>)}
      </select></label>
    </div>
    <div className="dripSteps">
      {value.steps.map((step, index) => <fieldset key={index} className="dripStep">
        <legend>Step {index + 1}</legend>
        <div className="dripStepOrder">
          <button type="button" className="iconButton" aria-label={`Move step ${index + 1} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ChevronUp size={16} /></button>
          <button type="button" className="iconButton" aria-label={`Move step ${index + 1} down`} disabled={busy || index === value.steps.length - 1} onClick={() => move(index, 1)}><ChevronDown size={16} /></button>
          <button type="button" className="iconButton dangerSoft" aria-label={`Remove step ${index + 1}`} disabled={busy || value.steps.length === 1} onClick={() => setValue({ ...value, steps: value.steps.filter((_, at) => at !== index) })}><Trash2 size={16} /></button>
        </div>
        <label>Approved template<ApprovedTemplatePicker api={api} initialTemplates={approvedTemplates} value={step.templateId} onChange={(next) => updateStep(index, 'templateId', next)} /></label>
        <label>Delay after previous step (minutes)<input type="number" min="0" step="1" required value={step.offsetMinutes} onChange={(event) => updateStep(index, 'offsetMinutes', event.target.value)} /></label>
        <label>Template variables (JSON object)<textarea spellCheck="false" value={step.variablesText} onChange={(event) => updateStep(index, 'variablesText', event.target.value)} /></label>
      </fieldset>)}
    </div>
    <div className="dripEditorActions">
      <button type="button" className="secondaryAction" disabled={busy} onClick={() => setValue({ ...value, steps: [...value.steps, blankStep()] })}><Plus size={16} />Add step</button>
      <span />
      <button type="submit" className="primaryAction" disabled={busy}><Save size={16} />{value.id ? 'Save changes' : 'Create draft'}</button>
      <button type="button" className="secondaryAction" disabled={busy} onClick={onCancel}><X size={16} />Cancel</button>
    </div>
    {localError && <p className="errorLine" role="alert">{localError}</p>}
  </form>;
}

function SequenceCard({ sequence, busy, onEdit, onAction }) {
  const canEdit = ['draft', 'paused'].includes(sequence.status);
  return <article className="dripSequence">
    <header>
      <div><h3>{sequence.name}</h3><p>{sequence.timezone}{sequence.segmentId ? ' · Default segment attached' : ''}</p></div>
      <span className={`dripStatus dripStatus-${sequence.status}`}>{sequence.status}</span>
    </header>
    <ol className="dripStepSummary">
      {sequence.steps.map((step) => <li key={step.stepOrder}>
        <strong>{step.templateName}</strong>
        <span>{step.offsetMinutes ? `${step.offsetMinutes} min after previous` : 'Immediately'} · {step.templateStatus}</span>
      </li>)}
    </ol>
    <dl className="dripCounts">
      <div><dt>Active</dt><dd>{sequence.counts.active}</dd></div>
      <div><dt>Completed</dt><dd>{sequence.counts.completed}</dd></div>
      <div><dt>Cancelled</dt><dd>{sequence.counts.cancelled}</dd></div>
      <div><dt>Failed</dt><dd>{sequence.counts.failed}</dd></div>
    </dl>
    <div className="dripActions">
      {canEdit && <button type="button" className="secondaryAction compactAction" disabled={busy} onClick={onEdit}><Pencil size={15} />Edit</button>}
      {sequence.status === 'draft' && <button type="button" className="primaryAction compactAction" disabled={busy} onClick={() => onAction('activate')}><CirclePlay size={15} />Activate</button>}
      {sequence.status === 'active' && <>
        <button type="button" className="secondaryAction compactAction" disabled={busy} onClick={() => onAction('pause')}><CirclePause size={15} />Pause</button>
        {sequence.segmentId && <button type="button" className="secondaryAction compactAction" disabled={busy} onClick={() => onAction('enroll', { sequenceId: sequence.id, useSegment: true })}><UserPlus size={15} />Enroll segment</button>}
        {sequence.counts.active > 0 && <button type="button" className="secondaryAction compactAction dangerSoft" disabled={busy} onClick={() => onAction('cancel', { sequenceId: sequence.id, all: true })}><X size={15} />Cancel active</button>}
      </>}
      {sequence.status === 'paused' && <button type="button" className="primaryAction compactAction" disabled={busy} onClick={() => onAction('resume')}><CirclePlay size={15} />Resume</button>}
      {sequence.status !== 'archived' && <button type="button" className="secondaryAction compactAction dangerSoft" disabled={busy} onClick={() => onAction('archive')}><Archive size={15} />Archive</button>}
    </div>
  </article>;
}

function actionMessage(action) {
  return ({
    activate: 'Sequence activated.',
    pause: 'Sequence paused.',
    resume: 'Sequence resumed.',
    archive: 'Sequence archived.',
    enroll: 'Eligible segment contacts enrolled.',
    cancel: 'Active enrollments cancelled.'
  })[action] || 'Sequence updated.';
}
