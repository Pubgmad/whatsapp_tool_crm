'use client';

import { useEffect } from 'react';
import { CheckCircle2, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import './feedback.css';

const ICONS = {
  success: CheckCircle2,
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info
};

/**
 * Premium toast stack. Controlled by parent — no business logic.
 * items: [{ id, kind, title, body, sticky? }]
 */
export default function ToastStack({ items = [], onDismiss }) {
  useEffect(() => {
    if (!items.length) return undefined;
    const timers = items
      .filter((item) => !item.sticky && item.kind !== 'error')
      .map((item) => {
        const ms = item.kind === 'warning' ? 5200 : 3200;
        return window.setTimeout(() => onDismiss?.(item.id), ms);
      });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [items, onDismiss]);

  if (!items.length) return null;

  return (
    <div className="msToastStack" aria-live="polite" aria-relevant="additions text" role="region" aria-label="Notifications">
      {items.map((item) => {
        const Icon = ICONS[item.kind] || Info;
        return (
          <div key={item.id} className={`msToast msToast--${item.kind || 'info'}`} role={item.kind === 'error' ? 'alert' : 'status'}>
            <span className="msToastIcon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <div className="msToastBody">
              {item.title ? <strong>{item.title}</strong> : null}
              <p>{item.body || item.message}</p>
            </div>
            <button
              type="button"
              className="msToastDismiss"
              aria-label="Dismiss notification"
              onClick={() => onDismiss?.(item.id)}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
