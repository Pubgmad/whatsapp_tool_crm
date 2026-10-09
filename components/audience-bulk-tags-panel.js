'use client';
import { useState } from 'react';
import { Loader2, Tag, X } from 'lucide-react';
import './audience-bulk-tags-panel.css';

function parseTags(text) {
  return [...new Set(String(text || '').split(/[,;\n]/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export default function AudienceBulkTagsPanel({ segment, api, onApplied }) {
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState('add');
  const [tagsText, setTagsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setError('');
    setJob(null);
    setTagsText('');
    setOperation('add');
  }

  async function submit(event) {
    event.preventDefault();
    const tags = parseTags(tagsText);
    if (!tags.length) {
      setError('Enter at least one tag (comma or line separated).');
      return;
    }
    if (tags.length > 20) {
      setError('Use at most 20 tags per job.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const idempotencyKey = `seg-${segment.id}-${crypto.randomUUID()}`;
      const result = await api(`/api/segments/${encodeURIComponent(segment.id)}/bulk-tags`, {
        method: 'POST',
        body: JSON.stringify({ operation, tags }),
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      setJob(result.job);
      if (result.job?.status === 'completed') onApplied?.();
    } catch (cause) {
      setError(cause.message || 'Bulk tag job failed.');
    } finally {
      setBusy(false);
    }
  }

  async function retryJob() {
    if (!job?.id || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(`/api/audience-tag-jobs/${encodeURIComponent(job.id)}/retry`, { method: 'POST' });
      setJob(result.job);
      if (result.job?.status === 'completed') onApplied?.();
    } catch (cause) {
      setError(cause.message || 'Retry failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!segment?.isActive) return null;

  return (
    <>
      <button className="secondaryAction compactAction" type="button" title="Add or remove tags for everyone in this segment" onClick={() => setOpen(true)}>
        <Tag size={15} /> Bulk tags
      </button>
      {open && (
        <div className="modalBackdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
          <div className="editModal audienceBulkTagsModal" role="dialog" aria-labelledby={`bulk-tags-${segment.id}`}>
            <header className="audienceBulkTagsHeader">
              <div>
                <h3 id={`bulk-tags-${segment.id}`}>Bulk tags</h3>
                <p>Apply to <strong>{segment.contactCount}</strong> contacts in <strong>{segment.name}</strong>. Changes are audited and use a frozen snapshot of the segment at run time.</p>
              </div>
              <button type="button" className="iconButton" aria-label="Close" disabled={busy} onClick={close}><X size={18} /></button>
            </header>
            <form className="audienceBulkTagsForm" onSubmit={submit}>
              <label>Action<select value={operation} disabled={busy} onChange={(event) => setOperation(event.target.value)}><option value="add">Add tags</option><option value="remove">Remove tags</option></select></label>
              <label className="wideField">Tags<textarea rows={3} maxLength={1200} required disabled={busy} placeholder="vip, newsletter, purchased" value={tagsText} onChange={(event) => setTagsText(event.target.value)} /></label>
              {error && <p className="formError" role="alert">{error}</p>}
              {job && (
                <div className="audienceBulkTagsStatus" aria-live="polite">
                  <Badge kind={job.status === 'completed' ? 'good' : job.status === 'failed' ? 'bad' : 'warn'}>{job.status}</Badge>
                  <span>{job.processedContacts} / {job.totalContacts} contacts</span>
                  {job.error && <small className="errorLine">{job.error}</small>}
                </div>
              )}
              <div className="formActions">
                {job?.status === 'failed' && <button type="button" className="secondaryAction" disabled={busy} onClick={retryJob}>Retry job</button>}
                <button type="button" className="secondaryAction" disabled={busy} onClick={close}>Cancel</button>
                <button className="primaryAction" type="submit" disabled={busy}>{busy ? <><Loader2 size={16} className="spin" /> Running…</> : 'Run on segment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Badge({ kind, children }) {
  const className = kind === 'good' ? 'badge good' : kind === 'bad' ? 'badge bad' : 'badge warn';
  return <span className={className}>{children}</span>;
}
