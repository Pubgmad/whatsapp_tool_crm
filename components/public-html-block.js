'use client';

import { useEffect, useMemo, useState } from 'react';
import { designMarkupSrcDoc, isDesignHtmlMessage } from '../lib/public-site-html-shared';

export default function PublicHtmlBlock({ markup, className = '', minHeight = 240, title = 'Designed content' }) {
  const [height, setHeight] = useState(minHeight);
  const srcDoc = useMemo(() => designMarkupSrcDoc(markup), [markup]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source == null) return;
      if (!isDesignHtmlMessage(event.data)) return;
      const next = Math.ceil(Number(event.data.height));
      if (next >= 80 && next <= 20000) setHeight(Math.max(minHeight, next));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [minHeight]);

  if (!markup) return null;

  return (
    <iframe
      title={title}
      className={className}
      sandbox="allow-scripts allow-forms allow-popups"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={{ width: '100%', border: 0, height: `${height}px`, display: 'block', background: 'transparent' }}
    />
  );
}
