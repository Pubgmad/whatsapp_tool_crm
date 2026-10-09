export const DESIGN_HTML_MESSAGE_SOURCE = 'wcrm-site-html';

export function designMarkupSrcDoc(markup) {
  const safe = String(markup || '');
  const resizeHelper = `<script>(function(){function notify(){try{var height=Math.max(document.documentElement?document.documentElement.scrollHeight:0,document.body?document.body.scrollHeight:0);parent.postMessage({source:${JSON.stringify(DESIGN_HTML_MESSAGE_SOURCE)},height:height},'*');}catch(error){}}if(typeof ResizeObserver!=='undefined'&&document.documentElement){new ResizeObserver(notify).observe(document.documentElement);}window.addEventListener('load',notify);notify();})();</script>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank" rel="noopener noreferrer"><style>html,body{margin:0;padding:0;width:100%;background:transparent;}</style></head><body>${safe}${resizeHelper}</body></html>`;
}

export function isDesignHtmlMessage(data) {
  return Boolean(data && data.source === DESIGN_HTML_MESSAGE_SOURCE && Number.isFinite(Number(data.height)));
}
