export function managedFlowRuntimeUrl(flowId = '') {
  const base = String(process.env.APP_URL || '').trim();
  let url;
  try {
    url = new URL(base);
  } catch {
    return { ok: false, url: '', reason: 'APP_URL is not configured.' };
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, url: '', reason: 'APP_URL must be a public HTTPS origin without path.' };
  }
  const path = flowId
    ? `/api/whatsapp/flows/runtime/data/${encodeURIComponent(flowId.slice(0, 80))}`
    : '/api/whatsapp/flows/runtime/data/{flowId}';
  return { ok: true, url: `${url.origin}${path}`, reason: '' };
}
