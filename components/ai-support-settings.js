'use client';

import { useEffect, useState } from 'react';
import { Bot, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import './whatsapp-modules.css';
import './ai-support-settings.css';

export default function AiSupportSettings({ api, postJson, role }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [instructions, setInstructions] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [editing, setEditing] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canEdit = role === 'Owner';
  const load = async nextPage => {
    const result = await api(`/api/ai-agent?page=${nextPage}`);
    setData(result);
    setPage(nextPage);
    setInstructions(result.settings.instructions || '');
    setEnabled(Boolean(result.settings.enabled));
  };
  useEffect(() => { let activeView = true; api('/api/ai-agent?page=1').then(result => {
    if (!activeView) return;
    setData(result); setInstructions(result.settings.instructions || ''); setEnabled(Boolean(result.settings.enabled));
  }).catch(cause => { if (activeView) setError(cause.message); }); return () => { activeView = false; }; }, [api]);
  const run = async (work, message, nextPage = page) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await load(nextPage); setNotice(message); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  const edit = item => { setEditing(item.id); setTitle(item.title); setContent(item.content); setActive(item.is_active); };
  const clear = () => { setEditing(null); setTitle(''); setContent(''); setActive(true); };
  return <section className="wa-module aiSupportSettings">
    <header className="wa-module-heading"><h2><Bot size={19} /> Support assistant</h2><button type="button" title="Refresh assistant" aria-label="Refresh assistant" onClick={() => run(() => Promise.resolve(), 'Updated')} disabled={busy}><RefreshCcw size={18} /></button></header>
    {error && <p className="wa-module-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading assistant...</p>}
    {data && <>
      <form className="aiSupportForm" onSubmit={event => { event.preventDefault(); run(() => postJson('/api/ai-agent', { action: 'configure', enabled, instructions }), 'Assistant settings saved'); }}>
        <label>Instructions<textarea rows="4" maxLength={4000} value={instructions} onChange={event => setInstructions(event.target.value)} disabled={!canEdit} /></label>
        <label className="aiSupportToggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={!canEdit || !data.available} />Enable suggestions</label>
        {!data.available && <p>OpenAI is not configured by the platform administrator.</p>}
        {canEdit && <button type="submit" disabled={busy}>Save settings</button>}
      </form>
      <h3>Knowledge</h3>
      {canEdit && <form className="aiSupportForm" onSubmit={event => { event.preventDefault(); run(async () => { await postJson('/api/ai-agent', { action: 'save_knowledge', id: editing || undefined, title, content, isActive: active }); clear(); }, 'Knowledge saved', 1); }}>
        <label>Title<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Content<textarea required rows="6" maxLength={12000} value={content} onChange={event => setContent(event.target.value)} /></label>
        <label className="aiSupportToggle"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Active</label>
        <div className="aiSupportActions"><button type="submit" disabled={busy}><Plus size={16} />{editing ? 'Update knowledge' : 'Add knowledge'}</button>{editing && <button type="button" onClick={clear}>Cancel</button>}</div>
      </form>}
      <div className="aiSupportDocuments">{data.knowledge.map(item => <article key={item.id}><div><strong>{item.title}</strong><small>{item.is_active ? 'Active' : 'Inactive'}</small></div><p>{item.content}</p>{canEdit && <div className="aiSupportActions"><button type="button" onClick={() => edit(item)} disabled={busy}>Edit</button><button type="button" title="Remove knowledge" aria-label={`Remove ${item.title}`} onClick={() => { if (window.confirm(`Remove ${item.title}?`)) run(() => postJson('/api/ai-agent', { action: 'remove_knowledge', id: item.id }), 'Knowledge removed'); }} disabled={busy}><Trash2 size={16} /></button></div>}</article>)}</div>
      {!data.knowledge.length && <p>No knowledge added.</p>}
      <div className="aiSupportActions"><button type="button" onClick={() => run(() => Promise.resolve(), 'Updated', page - 1)} disabled={busy || page <= 1}>Previous</button><span>Page {page}</span><button type="button" onClick={() => run(() => Promise.resolve(), 'Updated', page + 1)} disabled={busy || !data.hasMore}>Next</button></div>
    </>}
  </section>;
}
