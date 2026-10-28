/**
 * Presentation-only helpers for action feedback copy.
 * Does not alter API outcomes — only maps known phrases to tone + short labels.
 */

export function classifyFeedbackMessage(message = '') {
  const text = String(message || '').trim();
  if (!text) return { kind: 'info', title: '', body: '' };
  const lower = text.toLowerCase();
  if (
    /\bcouldn'?t\b|\bfailed\b|\berror\b|\binvalid\b|\bdenied\b|\bforbidden\b|\btry again\b|\bunavailable\b|\bnot found\b|\bexpired\b/.test(
      lower
    )
  ) {
    return { kind: 'error', title: 'Action failed', body: text };
  }
  if (/\bprocessing\b|\bin progress\b|\bawaiting\b|\bwill update\b|\bafter (its|the) confirmation\b/.test(lower)) {
    return { kind: 'info', title: 'In progress', body: text };
  }
  if (/\bwarning\b|\breconnect\b|\baction required\b|\breview required\b/.test(lower)) {
    return { kind: 'warning', title: 'Needs attention', body: text };
  }
  // "Queued" / "saved" confirm the request completed — not that a background job finished.
  return { kind: 'success', title: '', body: text };
}

export function pendingLabelForMessage(message = '') {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return 'Working…';
  if (text.includes('campaign')) return 'Working on campaign…';
  if (text.includes('template')) return 'Saving template…';
  if (text.includes('invit')) return 'Sending invite…';
  if (text.includes('catalog') || text.includes('commerce')) return 'Syncing…';
  if (text.includes('publish')) return 'Publishing…';
  if (text.includes('connect') || text.includes('meta') || text.includes('whatsapp')) return 'Connecting…';
  if (text.includes('upload') || text.includes('media')) return 'Uploading…';
  if (text.includes('refresh') || text.includes('sync') || text.includes('entitlement')) return 'Refreshing…';
  if (text.includes('billing') || text.includes('plan') || text.includes('subscription')) return 'Saving…';
  if (text.includes('profile')) return 'Updating profile…';
  if (text.includes('agent')) return 'Updating…';
  if (text.includes('flow') || text.includes('workflow') || text.includes('automation')) return 'Saving workflow…';
  return 'Working…';
}
