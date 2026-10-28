'use client';

import { Loader2 } from 'lucide-react';

/**
 * Presentation wrapper — same props as a button, adds pending spinner + label.
 * Does not call APIs; parent owns the async lifecycle.
 */
export default function ActionButton({
  pending = false,
  pendingLabel = 'Working…',
  children,
  className = 'primaryAction',
  type = 'button',
  disabled = false,
  ...rest
}) {
  const isBusy = Boolean(pending);
  return (
    <button
      type={type}
      className={`${className}${isBusy ? ' isPending' : ''}`}
      disabled={disabled || isBusy}
      aria-busy={isBusy ? 'true' : undefined}
      {...rest}
    >
      {isBusy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
      <span>{isBusy ? pendingLabel : children}</span>
    </button>
  );
}
