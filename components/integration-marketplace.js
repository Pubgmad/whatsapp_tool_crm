'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plug, Search } from 'lucide-react';
import './whatsapp-modules.css';
import HonestLimitsCallout from './honest-limits-callout';

export default function IntegrationMarketplace({ api }) {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/integrations/marketplace')
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!data || !term) return data;
    const match = (item) => `${item.label} ${item.id} ${item.summary || ''}`.toLowerCase().includes(term);
    return {
      ...data,
      connectors: data.connectors.filter(match),
      recipes: data.recipes.filter(match)
    };
  }, [data, query]);

  return (
    <section className="wa-module">
      <header className="wa-module-heading">
        <h2><Plug size={19} /> Integration marketplace</h2>
      </header>
      {error && <p className="wa-module-error" role="alert">{error}</p>}
      <HonestLimitsCallout limitId="integration_marketplace" />
      {filtered?.operatorNote && <p className="wa-module-note">{filtered.operatorNote}</p>}
      <label className="searchBox">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search connectors and recipes" />
      </label>
      <h3>Connectors</h3>
      <div className="capabilityGrid">
        {(filtered?.connectors || []).map((item) => (
          <article key={item.id}>
            <strong>{item.label}</strong>
            <small>{item.kind} · {item.status}</small>
          </article>
        ))}
      </div>
      <h3>Automation recipes</h3>
      {(filtered?.recipes || []).map((recipe) => (
        <details key={recipe.id}>
          <summary>{recipe.label}</summary>
          <p>{recipe.summary}</p>
          <ol>
            {recipe.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  );
}
