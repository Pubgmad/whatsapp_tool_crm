'use client';

import { useCallback, useRef, useState } from 'react';
import { classifyFeedbackMessage, pendingLabelForMessage } from '../lib/feedback-messages.js';
import { toastOptionsFromError } from '../lib/error-presentation.js';

let toastSeq = 0;

/**
 * Shared presentation feedback for CRM / Super Admin.
 * Tracks concurrent pending ops; typed toasts; no API changes.
 */
export function useFeedback() {
  const [toasts, setToasts] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingHint, setPendingHint] = useState('');
  const timers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback((message, options = {}) => {
    // Accept Error objects for accurate classification; strings remain supported.
    if (message && typeof message === 'object' && (message.message || message.code)) {
      const fromError = toastOptionsFromError(message, options.context || {});
      options = {
        ...fromError,
        ...options,
        kind: options.kind || fromError.kind,
        title: options.title ?? fromError.title,
        body: options.body || fromError.body
      };
      message = options.body;
    }
    if (!message && !options.body) return;
    const classified = classifyFeedbackMessage(options.body || message);
    const kind = options.kind || classified.kind;
    const id = options.id || `toast_${Date.now()}_${++toastSeq}`;
    const item = {
      id,
      kind,
      title: options.title ?? classified.title,
      body: options.body || message,
      sticky: options.sticky === true || kind === 'error' || kind === 'warning'
    };
    setToasts((current) => {
      const next = [...current.filter((toast) => toast.body !== item.body || toast.kind !== item.kind), item];
      return next.slice(-4);
    });
    return id;
  }, []);

  const beginPending = useCallback((hint = '') => {
    setPendingCount((count) => count + 1);
    if (hint) setPendingHint(hint);
    else setPendingHint((current) => current || 'Working…');
  }, []);

  const endPending = useCallback(() => {
    setPendingCount((count) => {
      const next = Math.max(0, count - 1);
      if (next === 0) setPendingHint('');
      return next;
    });
  }, []);

  const runAction = useCallback(
    async (promise, successMessage = '', options = {}) => {
      const hint = options.pendingLabel || pendingLabelForMessage(successMessage);
      beginPending(hint);
      try {
        const result = await promise;
        if (successMessage) notify(successMessage, { kind: 'success' });
        return { ok: true, result };
      } catch (error) {
        notify(error, { context: options.context || {} });
        return { ok: false, error };
      } finally {
        endPending();
      }
    },
    [beginPending, endPending, notify]
  );

  return {
    toasts,
    pendingCount,
    pendingHint,
    isPending: pendingCount > 0,
    notify,
    dismissToast,
    beginPending,
    endPending,
    runAction
  };
}
