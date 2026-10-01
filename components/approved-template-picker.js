'use client';

import { useEffect, useRef, useState } from 'react';

export default function ApprovedTemplatePicker({ api, initialTemplates = [], value, onChange, onTemplate, className = '' }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState(initialTemplates);
  const [selected, setSelected] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const onTemplateRef = useRef(onTemplate);
  onTemplateRef.current = onTemplate;

  useEffect(() => {
    if (!value) { setSelected(null); return; }
    const known = options.find(item => item.id === value) || initialTemplates.find(item => item.id === value);
    if (known) { setSelected(known); onTemplateRef.current?.(known); return; }
    let active = true;
    api(`/api/templates/options?id=${encodeURIComponent(value)}`).then(result => {
      if (!active) return;
      setSelected(result.template);
      onTemplateRef.current?.(result.template);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [value, initialTemplates, api]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api(`/api/templates/options?q=${encodeURIComponent(search)}&page=${page}`).then(result => {
        if (!active) return;
        setOptions(current => page === 1 ? result.templates : [...current, ...result.templates.filter(item => !current.some(existing => existing.id === item.id))]);
        setHasMore(result.hasMore);
        setError('');
      }).catch(reason => { if (active) setError(reason.message); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [api, search, page]);

  const choices = selected && !options.some(item => item.id === selected.id) ? [selected, ...options] : options;
  return <div className={`templatePicker ${className}`}>
    <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Find an approved template" aria-label="Find an approved template" maxLength={100} />
    <select value={value || ''} onChange={event => {
      const template = choices.find(item => item.id === event.target.value) || null;
      setSelected(template);
      onChange(event.target.value);
      onTemplateRef.current?.(template);
    }} aria-label="Approved template">
      <option value="">Select approved template</option>
      {choices.map(item => <option key={item.id} value={item.id}>{item.name} ({item.language})</option>)}
    </select>
    {hasMore && <button className="secondaryAction" type="button" onClick={() => setPage(current => current + 1)}>More templates</button>}
    {error && <small className="errorLine" role="alert">{error}</small>}
  </div>;
}
