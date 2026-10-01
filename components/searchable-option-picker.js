'use client';

import { useEffect, useState } from 'react';

export default function SearchableOptionPicker({ api, endpoint, initialOptions = [], itemsKey, value, onChange, label, placeholder, noneLabel, formatOption }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [options, setOptions] = useState(initialOptions);
  const [selected, setSelected] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const separator = endpoint.includes('?') ? '&' : '?';

  useEffect(() => {
    if (!value) { setSelected(null); return; }
    const known = options.find(item => item.id === value) || initialOptions.find(item => item.id === value);
    if (known) { setSelected(known); return; }
    let active = true;
    api(`${endpoint}${separator}id=${encodeURIComponent(value)}`).then(result => {
      if (active) setSelected(result[itemsKey]?.[0] || null);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, endpoint, initialOptions, itemsKey, options, separator, value]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api(`${endpoint}${separator}q=${encodeURIComponent(search)}&page=${page}`).then(result => {
        if (!active) return;
        setOptions(current => page === 1 ? result[itemsKey] : [...current, ...result[itemsKey].filter(item => !current.some(existing => existing.id === item.id))]);
        setHasMore(result.hasMore);
        setError('');
      }).catch(reason => { if (active) setError(reason.message); });
    }, search ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [api, endpoint, itemsKey, page, search, separator]);

  const choices = selected && !options.some(item => item.id === selected.id) ? [selected, ...options] : options;
  return <div className="templatePicker">
    <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={placeholder} aria-label={`Find ${label.toLowerCase()}`} maxLength={120} />
    <select value={value || ''} onChange={event => onChange(event.target.value, choices.find(item => item.id === event.target.value) || null)} aria-label={label}>
      <option value="">{noneLabel}</option>
      {choices.map(item => <option key={item.id} value={item.id}>{formatOption(item)}</option>)}
    </select>
    {hasMore && <button className="secondaryAction" type="button" onClick={() => setPage(current => current + 1)}>More</button>}
    {error && <small className="errorLine" role="alert">{error}</small>}
  </div>;
}
