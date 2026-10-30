'use client';

import { CircleAlert, RefreshCcw, X } from 'lucide-react';
import { classifyError } from '../../lib/error-presentation.js';
import './feedback.css';

/**
 * Section-scoped failure. Does not block unrelated page regions.
 * Pass `error` (Error|string) or explicit title/body.
 */
export default function SectionError({
  error,
  title,
  body,
  operation = '',
  onRetry,
  onDismiss,
  retryLabel = 'Retry',
  showDiagnostics = false
}) {
  const classified = error != null
    ? classifyError(error, { operation, placement: 'section' })
    : null;
  const heading = title || classified?.title || 'Something went wrong';
  const explanation = body || classified?.body || '';
  if (!heading && !explanation) return null;
  const retryable = onRetry && (classified?.retryable !== false || Boolean(onRetry));
  const diagnostics = classified?.diagnostics;

  return (
    <div className="msSectionError" role="alert">
      <span className="msSectionErrorIcon" aria-hidden="true">
        <CircleAlert size={18} />
      </span>
      <div className="msSectionErrorBody">
        <strong>{heading}</strong>
        {explanation ? <p>{explanation}</p> : null}
        {showDiagnostics && diagnostics?.code ? (
          <p className="msErrorDiagnostics">
            Reference: {diagnostics.code}
            {diagnostics.status ? ` · ${diagnostics.status}` : ''}
          </p>
        ) : null}
        {(retryable || onDismiss) ? (
          <div className="msSectionErrorActions">
            {retryable ? (
              <button className="secondaryAction" type="button" onClick={onRetry}>
                <RefreshCcw size={15} aria-hidden="true" />
                <span>{retryLabel}</span>
              </button>
            ) : null}
            {onDismiss ? (
              <button className="msSectionErrorDismiss" type="button" onClick={onDismiss} aria-label="Dismiss">
                <X size={15} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
