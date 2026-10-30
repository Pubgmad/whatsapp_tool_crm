'use client';

import { CircleAlert, RefreshCcw } from 'lucide-react';
import { classifyError } from '../../lib/error-presentation.js';
import './feedback.css';

/** Full-page recovery when the entire view cannot load. */
export default function PageError({ error, title, body, onRetry, retryLabel = 'Retry' }) {
  const classified = error != null ? classifyError(error, { placement: 'page' }) : null;
  const heading = title || classified?.title || 'Page unavailable';
  const explanation = body || classified?.body || 'This page could not be loaded.';

  return (
    <main className="msPageError" role="alert" aria-live="assertive">
      <span className="msPageErrorIcon" aria-hidden="true">
        <CircleAlert size={28} />
      </span>
      <h1>{heading}</h1>
      <p>{explanation}</p>
      {onRetry ? (
        <button className="primaryAction" type="button" onClick={onRetry}>
          <RefreshCcw size={17} aria-hidden="true" />
          <span>{retryLabel}</span>
        </button>
      ) : null}
    </main>
  );
}
