'use client';

import { useEffect, useState } from 'react';
import { Library, RefreshCcw, Sparkles } from 'lucide-react';
import './whatsapp-modules.css';

export default function TemplateLibraryBrowser({ api, postJson, accounts = [], onUsed }) {
  const [items, setItems] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [category, setCategory] = useState('all');
  const [industry, setIndustry] = useState('all');
  const [q, setQ] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (category !== 'all') params.set('category', category);
      if (industry !== 'all') params.set('industry', industry);
      if (q.trim()) params.set('q', q.trim());
      const result = await api(`/api/templates/library?${params.toString()}`);
      setItems(result.items || []);
      setIndustries(result.industries || []);
      if (!accountId && accounts[0]?.id) setAccountId(accounts[0].id);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, industry, q, api]);

  const useItem = (item, submitToMeta) => async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const result = await postJson('/api/templates/library', {
        libraryItemId: item.id,
        accountId: submitToMeta ? accountId : '',
        submitToMeta
      });
      setNote(
        submitToMeta
          ? `Submitted “${result.template?.name || item.name}” to Meta for approval.`
          : `Saved “${result.template?.name || item.name}” as a workspace draft.`
      );
      onUsed?.(result);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wa-module templateLibraryBrowser" aria-label="Template library">
      <header className="wa-module-heading saasPageHeadToolbar">
        <div>
          <strong className="wa-module-toolbarLabel"><Library size={16} /> Template library</strong>
          <span className="wa-module-subhead">Browse curated templates, save as drafts, or submit to Meta</span>
        </div>
        <button type="button" title="Refresh library" aria-label="Refresh library" disabled={busy} onClick={load}>
          <RefreshCcw size={18} />
        </button>
      </header>
      {error && <p role="alert" className="wa-module-error">{error}</p>}
      {note && <p role="status" className="wa-module-success">{note}</p>}
      <div className="wa-module-controls dataToolbar contactToolbar">
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
            <option value="all">All</option>
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utility</option>
            <option value="AUTHENTICATION">Authentication</option>
          </select>
        </label>
        <label>
          Industry
          <select value={industry} onChange={(event) => setIndustry(event.target.value)} aria-label="Filter by industry">
            <option value="all">All</option>
            {industries.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find a template" maxLength={120} />
        </label>
        <label>
          WhatsApp account (for Meta submit)
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="WhatsApp account">
            <option value="">Select account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name ? `${account.name} (${account.wabaId || account.waba_id || ''})` : account.wabaId || account.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flowCardGrid templateLibraryGrid" aria-label="Library templates">
        {items.map((item) => (
          <article className="templateCard" key={item.id}>
            <div className="cardHead">
              <div>
                <h3>{item.name}</h3>
                <p>{item.description}</p>
              </div>
              <span className="chipRow"><span>{item.category}</span><span>{item.industry}</span></span>
            </div>
            <pre className="templateLibraryPreview">{item.body}</pre>
            <div className="chipRow">{(item.tags || []).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="flowActions">
              <button className="secondaryAction" type="button" disabled={busy} onClick={useItem(item, false)}>
                Save draft
              </button>
              <button className="primaryAction" type="button" disabled={busy || !accountId} onClick={useItem(item, true)}>
                <Sparkles size={15} /> Submit to Meta
              </button>
            </div>
          </article>
        ))}
        {!items.length && !busy && (
          <div className="wa-module-empty" role="status">
            <strong>No library templates match</strong>
            <p>Try another category, industry, or search term.</p>
          </div>
        )}
      </div>
    </section>
  );
}
