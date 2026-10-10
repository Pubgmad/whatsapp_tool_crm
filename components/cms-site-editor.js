'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Plus, Save, Trash2, Upload } from 'lucide-react';
import PublicHtmlBlock from './public-html-block';
import styles from './cms-site-editor.module.css';

function publicPathForPage(page) {
  if (!page) return '/';
  if (page.kind === 'home') return '/';
  if (page.kind === 'feature') return `/features/${page.slug}`;
  return `/${page.slug}`;
}

const pageKinds = ['home', 'page', 'feature', 'product', 'about', 'contact', 'faq', 'pricing', 'legal', 'integrations', 'security'];
const presets = ['plain', 'split-media', 'feature-grid', 'cards', 'cta-band', 'faq', 'stats', 'rich', 'columns'];
const backgrounds = ['default', 'muted', 'brand', 'dark', 'accent-soft'];
const blockTypes = ['heading', 'paragraph', 'list', 'quote', 'button', 'link', 'image', 'card', 'feature-item', 'faq-item', 'stat', 'video', 'html'];
const iconOptions = ['', 'message', 'phone', 'megaphone', 'bot', 'spark', 'workflow', 'form', 'grid', 'shield', 'integrations', 'products', 'automation'];

function syncProductsMegaNav(products = []) {
  const visible = products.filter((product) => product.visible !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  return {
    id: 'nav-products',
    label: 'Products',
    href: '/features',
    type: 'internal',
    menuStyle: 'mega',
    description: 'Explore products and capabilities',
    icon: 'products',
    visible: true,
    openInNewTab: false,
    children: visible.map((product) => ({
      id: `nav-product-${product.id}`,
      label: product.title,
      href: product.href || '/features',
      type: 'internal',
      menuStyle: 'dropdown',
      description: product.summary || '',
      icon: product.icon || 'grid',
      visible: true,
      openInNewTab: false,
      children: (product.features || []).filter((feature) => feature.visible !== false).map((feature) => ({
        id: `nav-feature-${feature.id}`,
        label: feature.title,
        href: feature.href || '/features',
        type: 'internal',
        menuStyle: 'link',
        description: feature.summary || '',
        icon: feature.icon || '',
        visible: true,
        openInNewTab: false,
        children: []
      }))
    }))
  };
}

const emptyProduct = () => ({
  id: newId('product'),
  title: 'New product',
  slug: 'new-product',
  summary: 'Short product description for the mega menu',
  href: '/features',
  icon: 'products',
  visible: true,
  order: 100,
  features: []
});
const emptyFeature = () => ({
  id: newId('feat'),
  title: 'New feature',
  summary: '',
  href: '/features/new-feature',
  icon: '',
  visible: true,
  order: 100
});
const emptyNav = () => ({
  id: newId('nav'),
  label: 'Link',
  href: '/',
  type: 'internal',
  menuStyle: 'link',
  description: '',
  icon: '',
  visible: true,
  openInNewTab: false,
  children: []
});

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const emptyBlock = (type = 'paragraph') => {
  if (type === 'button' || type === 'link') return { type, label: 'Learn more', text: 'Learn more', href: '/signup', linkType: 'internal', style: type === 'button' ? 'primary' : 'text', openInNewTab: false, emphasis: 'none' };
  if (type === 'image') return { type, asset: 'hero', href: '', alt: 'Image', text: 'Image', width: 'wide' };
  if (type === 'card' || type === 'feature-item') return { type, title: 'Capability', text: 'Describe the benefit.', href: '/features', icon: '', imageUrl: '' };
  if (type === 'faq-item') return { type, title: 'Question?', text: 'Answer.', emphasis: 'none' };
  if (type === 'stat') return { type, title: '99%', text: 'Metric label', emphasis: 'none' };
  if (type === 'html') return { type, text: '<section style="padding:32px"><h2>Custom HTML</h2><p>Scoped design import.</p></section>', emphasis: 'none' };
  if (type === 'video') return { type, href: 'https://www.youtube.com/embed/dQw4w9WgXcQ', title: 'Product video', text: 'Product video', emphasis: 'none' };
  return { type, text: 'Add content…', emphasis: 'none' };
};
const emptySection = () => ({
  id: newId('section'),
  title: 'New section',
  eyebrow: '',
  visible: true,
  preset: 'plain',
  align: 'left',
  background: 'default',
  padding: 'normal',
  mediaSide: 'right',
  blocks: [emptyBlock('paragraph')],
  ctaLabel: '',
  ctaHref: ''
});
const emptyPage = (kind = 'feature') => ({
  id: newId('page'),
  slug: kind === 'feature' ? 'new-feature' : 'new-page',
  title: kind === 'feature' ? 'New feature' : 'New page',
  kind,
  published: true,
  showInNav: kind !== 'feature' && kind !== 'home',
  navOrder: 50,
  seoTitle: '',
  seoDescription: '',
  eyebrow: kind === 'feature' ? 'Feature' : 'Page',
  summary: '',
  layout: kind === 'feature' ? 'feature' : 'default',
  hero: { enabled: true, title: 'New page', subtitle: '', ctaLabel: 'Create workspace', ctaHref: '/signup', image: 'none', imageUrl: '' },
  sections: [emptySection()]
});

function PreviewBlocks({ blocks, assets }) {
  return (
    <div className={styles.previewBlocks}>
      {blocks.map((block, index) => {
        if (block.type === 'html') return <PublicHtmlBlock key={index} markup={block.text} minHeight={160} className={styles.htmlPreview} />;
        if (block.type === 'feature-item' || block.type === 'card') return <article key={index}><strong>{block.title}</strong><p>{block.text}</p></article>;
        if (block.type === 'faq-item') return <details key={index} open><summary>{block.title}</summary><p>{block.text}</p></details>;
        if (block.type === 'stat') return <div key={index}><strong>{block.title}</strong><span>{block.text}</span></div>;
        if (block.type === 'image') {
          const src = block.asset === 'logo' ? assets?.logo?.url : block.asset === 'hero' ? assets?.hero?.url : block.href;
          return src ? <img key={index} src={src} alt={block.alt || ''} /> : <em key={index}>Image</em>;
        }
        if (block.type === 'list') return <ul key={index}>{String(block.text || '').split('\n').map((line, i) => <li key={i}>{line}</li>)}</ul>;
        return <p key={index}>{block.label || block.text}</p>;
      })}
    </div>
  );
}

export default function CmsSiteEditor({ api, notify }) {
  const [snapshot, setSnapshot] = useState(null);
  const [document, setDocument] = useState(null);
  const [assets, setAssets] = useState({});
  const [pageIndex, setPageIndex] = useState(0);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [tab, setTab] = useState('pages');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const result = await api('/api/super-admin/site');
    const doc = result.site.document;
    if (!doc?.pages?.length) throw new Error('Website CMS document is empty. Save once to seed default pages.');
    if (!Array.isArray(doc.products)) doc.products = [];
    setSnapshot(result.site);
    setDocument(doc);
    setAssets(result.assets || {});
    setDirty(false);
    setPageIndex(0);
    setSectionIndex(0);
  };

  useEffect(() => { load().catch((reason) => setError(reason.message)); }, []);

  const page = document?.pages?.[pageIndex];
  const section = page?.sections?.[sectionIndex];
  const publicPath = useMemo(() => (page ? publicPathForPage(page) : '/'), [page]);

  const change = (patch) => {
    setDocument((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const updatePage = (patch) => {
    change({ pages: document.pages.map((item, index) => (index === pageIndex ? { ...item, ...patch } : item)) });
  };
  const updateSection = (patch) => {
    updatePage({ sections: page.sections.map((item, index) => (index === sectionIndex ? { ...item, ...patch } : item)) });
  };
  const updateBlock = (blockIndex, patch) => {
    updateSection({ blocks: section.blocks.map((item, index) => (index === blockIndex ? { ...item, ...patch } : item)) });
  };

  const persist = async (publish) => {
    if (!snapshot || !document) return;
    setBusy(true); setError('');
    try {
      let next = snapshot;
      if (dirty || publish) {
        next = (await api('/api/super-admin/site', { method: 'POST', body: JSON.stringify({ action: 'save', revision: next.revision, document }) })).site;
        setSnapshot(next);
        setDocument(next.document);
        setDirty(false);
      }
      if (publish) {
        next = (await api('/api/super-admin/site', { method: 'POST', body: JSON.stringify({ action: 'publish', revision: next.revision }) })).site;
        setSnapshot(next);
        setDocument(next.document);
      }
      notify(publish ? 'Website published' : 'Draft saved');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event, kind) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const tokenResult = await api('/api/security/csrf');
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      const response = await fetch('/api/super-admin/site/asset', { method: 'POST', body: form, headers: { 'x-csrf-token': tokenResult.csrfToken }, credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Image upload failed');
      setAssets(result.assets);
      notify('Brand image updated');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  if (!document || !snapshot) {
    return <section className={styles.editor}><h2>Website CMS</h2><p>{error || 'Loading…'}</p><button type="button" onClick={() => load().catch((reason) => setError(reason.message))}>Retry</button></section>;
  }

  return (
    <section className={styles.editor}>
      <div className={styles.top}>
        <div>
          <h2>Website & product CMS</h2>
          <p>Draft r{snapshot.revision} · Published r{snapshot.publishedRevision || 'none'} · Products, mega menus, feature pages, and branding — publish to update the live site</p>
        </div>
        <div className={styles.actions}>
          <a href={publicPath} target="_blank" rel="noreferrer"><Eye size={16} /> Preview path</a>
          <button type="button" disabled={busy || !dirty} onClick={() => persist(false)}><Save size={16} /> Save draft</button>
          <button type="button" className={styles.publish} disabled={busy} onClick={() => persist(true)}><Upload size={16} /> Publish</button>
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.tabs}>
        {['pages', 'products', 'navigation', 'theme', 'branding'].map((id) => (
          <button type="button" key={id} className={tab === id ? styles.activeTab : ''} onClick={() => setTab(id)}>{id}</button>
        ))}
      </div>

      {tab === 'theme' && (
        <div className={styles.panel}>
          <h3>Design tokens</h3>
          <div className={styles.row}>
            {['primary', 'accent', 'surface', 'ink'].map((key) => (
              <label key={key}>{key}
                <input type="color" value={document.theme?.[key] || '#0f766e'} onChange={(event) => change({ theme: { ...document.theme, [key]: event.target.value } })} />
              </label>
            ))}
          </div>
          <p className={styles.help}>Theme colors apply across the published marketing site. Typography uses Fraunces + Source Sans 3 (sampleui-inspired hierarchy, CRM teal/orange identity).</p>
        </div>
      )}

      {tab === 'products' && (
        <div className={styles.panel}>
          <div className={styles.row}>
            <h3 style={{ margin: 0, flex: 1 }}>Products & features catalog</h3>
            <button type="button" onClick={() => {
              const mega = syncProductsMegaNav(document.products || []);
              const rest = (document.navigation || []).filter((item) => item.id !== 'nav-products');
              const home = rest.find((item) => item.id === 'nav-home') || { id: 'nav-home', label: 'Home', href: '/', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] };
              const others = rest.filter((item) => item.id !== 'nav-home');
              change({ navigation: [home, mega, ...others] });
              notify('Products mega menu synced into Navigation');
            }}>Sync to Products mega menu</button>
            <button type="button" onClick={() => change({ products: [...(document.products || []), emptyProduct()] })}><Plus size={15} /> Add product</button>
          </div>
          <p className={styles.help}>Create products, nest features under each one, then sync into the header mega menu. Feature hrefs should match published page URLs like <code>/features/whatsapp-calling</code>.</p>
          {(document.products || []).map((product, productIndex) => (
            <div className={styles.card} key={product.id}>
              <div className={styles.row}>
                <label>Product title<input value={product.title} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, title: event.target.value } : item) })} /></label>
                <label>Slug<input value={product.slug} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, slug: event.target.value } : item) })} /></label>
                <label>Href<input value={product.href || ''} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, href: event.target.value } : item) })} /></label>
                <label>Icon
                  <select value={product.icon || ''} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, icon: event.target.value } : item) })}>
                    {iconOptions.map((icon) => <option key={icon || 'none'} value={icon}>{icon || 'none'}</option>)}
                  </select>
                </label>
                <label className={styles.check}><input type="checkbox" checked={product.visible !== false} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, visible: event.target.checked } : item) })} /> Visible</label>
                <button type="button" onClick={() => change({ products: document.products.filter((_, i) => i !== productIndex) })}><Trash2 size={15} /></button>
              </div>
              <label>Summary<textarea rows={2} value={product.summary || ''} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, summary: event.target.value } : item) })} /></label>
              <div className={styles.blocksHead}>
                <h4>Features under {product.title}</h4>
                <button type="button" onClick={() => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, features: [...(item.features || []), emptyFeature()] } : item) })}><Plus size={14} /> Feature</button>
              </div>
              {(product.features || []).map((feature, featureIndex) => (
                <div className={styles.block} key={feature.id}>
                  <div className={styles.row}>
                    <label>Feature<input value={feature.title} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, features: item.features.map((feat, fi) => fi === featureIndex ? { ...feat, title: event.target.value } : feat) } : item) })} /></label>
                    <label>Page URL<input value={feature.href || ''} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, features: item.features.map((feat, fi) => fi === featureIndex ? { ...feat, href: event.target.value } : feat) } : item) })} /></label>
                    <label>Icon
                      <select value={feature.icon || ''} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, features: item.features.map((feat, fi) => fi === featureIndex ? { ...feat, icon: event.target.value } : feat) } : item) })}>
                        {iconOptions.map((icon) => <option key={icon || 'none'} value={icon}>{icon || 'none'}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, features: item.features.filter((_, fi) => fi !== featureIndex) } : item) })}><Trash2 size={14} /></button>
                  </div>
                  <label>Description<input value={feature.summary || ''} onChange={(event) => change({ products: document.products.map((item, i) => i === productIndex ? { ...item, features: item.features.map((feat, fi) => fi === featureIndex ? { ...feat, summary: event.target.value } : feat) } : item) })} /></label>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'navigation' && (
        <div className={styles.panel}>
          <div className={styles.row}>
            <h3 style={{ margin: 0, flex: 1 }}>Header navigation / mega menu</h3>
            <button type="button" onClick={() => change({ navigation: [...(document.navigation || []), emptyNav()] })}><Plus size={15} /> Top-level item</button>
          </div>
          <p className={styles.help}>Use menu style <strong>mega</strong> for Products (product groups + feature links). Use <strong>dropdown</strong> for simpler menus. Reorder with the arrows. Publish to update the live header.</p>
          {(document.navigation || []).map((item, index) => (
            <div className={styles.card} key={item.id}>
              <div className={styles.row}>
                <label>Label<input value={item.label} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, label: event.target.value } : nav) })} /></label>
                <label>Href<input value={item.href || ''} placeholder={item.menuStyle === 'mega' ? '/features (optional overview)' : '/about'} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, href: event.target.value } : nav) })} /></label>
                <label>Menu style
                  <select value={item.menuStyle || 'link'} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, menuStyle: event.target.value } : nav) })}>
                    <option value="link">link</option>
                    <option value="dropdown">dropdown</option>
                    <option value="mega">mega</option>
                  </select>
                </label>
                <label>Type
                  <select value={item.type || 'internal'} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, type: event.target.value } : nav) })}>
                    <option value="internal">internal</option>
                    <option value="external">external</option>
                    <option value="hash">hash</option>
                    <option value="menu">menu only</option>
                  </select>
                </label>
                <label className={styles.check}><input type="checkbox" checked={item.visible !== false} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, visible: event.target.checked } : nav) })} /> Visible</label>
                <button type="button" disabled={index === 0} onClick={() => {
                  const next = [...document.navigation];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  change({ navigation: next });
                }}><ArrowUp size={15} /></button>
                <button type="button" disabled={index >= document.navigation.length - 1} onClick={() => {
                  const next = [...document.navigation];
                  [next[index + 1], next[index]] = [next[index], next[index + 1]];
                  change({ navigation: next });
                }}><ArrowDown size={15} /></button>
                <button type="button" onClick={() => change({ navigation: document.navigation.filter((_, i) => i !== index) })}><Trash2 size={15} /></button>
              </div>
              {(item.menuStyle === 'mega' || item.menuStyle === 'dropdown') && (
                <>
                  <div className={styles.blocksHead}>
                    <h4>Child groups / links</h4>
                    <button type="button" onClick={() => change({
                      navigation: document.navigation.map((nav, i) => i === index ? {
                        ...nav,
                        children: [...(nav.children || []), { id: newId('nav-child'), label: 'Group', href: '/features', type: 'internal', menuStyle: 'dropdown', description: '', icon: 'grid', visible: true, openInNewTab: false, children: [] }]
                      } : nav)
                    }}><Plus size={14} /> Group</button>
                  </div>
                  {(item.children || []).map((child, childIndex) => (
                    <div className={styles.block} key={child.id}>
                      <div className={styles.row}>
                        <label>Group label<input value={child.label} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.map((c, ci) => ci === childIndex ? { ...c, label: event.target.value } : c) } : nav) })} /></label>
                        <label>Href<input value={child.href || ''} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.map((c, ci) => ci === childIndex ? { ...c, href: event.target.value } : c) } : nav) })} /></label>
                        <label>Description<input value={child.description || ''} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.map((c, ci) => ci === childIndex ? { ...c, description: event.target.value } : c) } : nav) })} /></label>
                        <button type="button" onClick={() => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.filter((_, ci) => ci !== childIndex) } : nav) })}><Trash2 size={14} /></button>
                      </div>
                      <div className={styles.blocksHead}>
                        <h4>Nested links</h4>
                        <button type="button" onClick={() => change({
                          navigation: document.navigation.map((nav, i) => i === index ? {
                            ...nav,
                            children: nav.children.map((c, ci) => ci === childIndex ? {
                              ...c,
                              children: [...(c.children || []), { id: newId('nav-leaf'), label: 'Feature link', href: '/features/whatsapp-calling', type: 'internal', menuStyle: 'link', description: '', icon: '', visible: true, openInNewTab: false, children: [] }]
                            } : c)
                          } : nav)
                        }}><Plus size={14} /> Nested link</button>
                      </div>
                      {(child.children || []).map((leaf, leafIndex) => (
                        <div className={styles.row} key={leaf.id}>
                          <label>Label<input value={leaf.label} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.map((c, ci) => ci === childIndex ? { ...c, children: c.children.map((l, li) => li === leafIndex ? { ...l, label: event.target.value } : l) } : c) } : nav) })} /></label>
                          <label>Href<input value={leaf.href || ''} onChange={(event) => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.map((c, ci) => ci === childIndex ? { ...c, children: c.children.map((l, li) => li === leafIndex ? { ...l, href: event.target.value } : l) } : c) } : nav) })} /></label>
                          <button type="button" onClick={() => change({ navigation: document.navigation.map((nav, i) => i === index ? { ...nav, children: nav.children.map((c, ci) => ci === childIndex ? { ...c, children: c.children.filter((_, li) => li !== leafIndex) } : c) } : nav) })}><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
          <h3>Footer</h3>
          <label>Blurb<textarea rows={3} value={document.footer?.blurb || ''} onChange={(event) => change({ footer: { ...document.footer, blurb: event.target.value } })} /></label>
          {(document.footer?.links || []).map((link, index) => (
            <div className={styles.row} key={`${link.href}-${index}`}>
              <label>Label<input value={link.label} onChange={(event) => change({ footer: { ...document.footer, links: document.footer.links.map((item, i) => i === index ? { ...item, label: event.target.value } : item) } })} /></label>
              <label>Path<input value={link.href} onChange={(event) => change({ footer: { ...document.footer, links: document.footer.links.map((item, i) => i === index ? { ...item, href: event.target.value } : item) } })} /></label>
              <button type="button" onClick={() => change({ footer: { ...document.footer, links: document.footer.links.filter((_, i) => i !== index) } })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" onClick={() => change({ footer: { ...document.footer, links: [...(document.footer.links || []), { label: 'Link', href: '/about' }] } })}><Plus size={15} /> Footer link</button>
        </div>
      )}

      {tab === 'branding' && (
        <div className={styles.panel}>
          <h3>Brand assets</h3>
          <div className={styles.assets}>
            {['logo', 'favicon', 'hero'].map((kind) => (
              <div className={styles.asset} key={kind}>
                <strong>{kind}</strong>
                {assets[kind] ? <img src={assets[kind].url} alt={kind} /> : <span>Not uploaded</span>}
                <label className={styles.file}><Upload size={15} /> Replace<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(event, kind)} disabled={busy} /></label>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'pages' && (
        <div className={styles.workspace}>
          <aside className={styles.pageList}>
            <h3>Pages</h3>
            {document.pages.map((item, index) => (
              <button type="button" key={item.id} className={pageIndex === index ? styles.active : ''} onClick={() => { setPageIndex(index); setSectionIndex(0); }}>
                <strong>{item.title}</strong>
                <small>{item.kind} · {publicPathForPage(item)} · {item.published ? 'published' : 'hidden'}</small>
              </button>
            ))}
            <button type="button" className={styles.add} onClick={() => { change({ pages: [...document.pages, emptyPage('feature')] }); setPageIndex(document.pages.length); }}><Plus size={15} /> Feature page</button>
            <button type="button" className={styles.add} onClick={() => { change({ pages: [...document.pages, emptyPage('page')] }); setPageIndex(document.pages.length); }}><Plus size={15} /> Generic page</button>
          </aside>

          {page ? (
            <div className={styles.pageEditor}>
              <div className={styles.row}>
                <label>Title<input value={page.title} onChange={(event) => updatePage({ title: event.target.value, hero: { ...page.hero, title: page.hero?.title || event.target.value } })} /></label>
                <label>Kind
                  <select value={page.kind} onChange={(event) => updatePage({ kind: event.target.value })} disabled={page.kind === 'home'}>
                    {pageKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                </label>
                <label>Slug<input value={page.slug} disabled={page.kind === 'home'} onChange={(event) => updatePage({ slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') })} /></label>
              </div>
              <p className={styles.help}>Public URL: <code>{publicPath}</code></p>
              <div className={styles.row}>
                <label>SEO title<input value={page.seoTitle || ''} onChange={(event) => updatePage({ seoTitle: event.target.value })} /></label>
                <label>Eyebrow<input value={page.eyebrow || ''} onChange={(event) => updatePage({ eyebrow: event.target.value })} /></label>
                <label className={styles.check}><input type="checkbox" checked={page.published !== false} onChange={(event) => updatePage({ published: event.target.checked })} /> Published</label>
                <label className={styles.check}><input type="checkbox" checked={Boolean(page.showInNav)} onChange={(event) => updatePage({ showInNav: event.target.checked })} /> Suggest in nav</label>
              </div>
              <label>Summary<textarea rows={2} value={page.summary || ''} onChange={(event) => updatePage({ summary: event.target.value })} /></label>

              <div className={styles.card}>
                <h3>Hero</h3>
                <label className={styles.check}><input type="checkbox" checked={Boolean(page.hero?.enabled)} onChange={(event) => updatePage({ hero: { ...page.hero, enabled: event.target.checked } })} /> Enabled</label>
                <div className={styles.row}>
                  <label>Hero title<input value={page.hero?.title || ''} onChange={(event) => updatePage({ hero: { ...page.hero, title: event.target.value } })} /></label>
                  <label>CTA label<input value={page.hero?.ctaLabel || ''} onChange={(event) => updatePage({ hero: { ...page.hero, ctaLabel: event.target.value } })} /></label>
                  <label>CTA href<input value={page.hero?.ctaHref || ''} onChange={(event) => updatePage({ hero: { ...page.hero, ctaHref: event.target.value } })} /></label>
                </div>
                <label>Subtitle<textarea rows={2} value={page.hero?.subtitle || ''} onChange={(event) => updatePage({ hero: { ...page.hero, subtitle: event.target.value } })} /></label>
                <div className={styles.row}>
                  <label>Image
                    <select value={page.hero?.image || 'none'} onChange={(event) => updatePage({ hero: { ...page.hero, image: event.target.value } })}>
                      <option value="none">none</option>
                      <option value="hero">brand hero</option>
                      <option value="custom">custom https</option>
                    </select>
                  </label>
                  {page.hero?.image === 'custom' && <label>Image URL<input value={page.hero?.imageUrl || ''} onChange={(event) => updatePage({ hero: { ...page.hero, imageUrl: event.target.value } })} /></label>}
                </div>
              </div>

              <div className={styles.sectionBar}>
                <h3>Sections</h3>
                <div className={styles.sectionTabs}>
                  {page.sections.map((item, index) => (
                    <button type="button" key={item.id} className={sectionIndex === index ? styles.active : ''} onClick={() => setSectionIndex(index)}>{item.title || item.id}</button>
                  ))}
                  <button type="button" onClick={() => { updatePage({ sections: [...page.sections, emptySection()] }); setSectionIndex(page.sections.length); }}><Plus size={14} /></button>
                </div>
              </div>

              {section ? (
                <div className={styles.card}>
                  <div className={styles.row}>
                    <label>Section title<input value={section.title} onChange={(event) => updateSection({ title: event.target.value })} /></label>
                    <label>Anchor id<input value={section.id} onChange={(event) => updateSection({ id: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} /></label>
                    <label>Preset
                      <select value={section.preset} onChange={(event) => updateSection({ preset: event.target.value })}>
                        {presets.map((preset) => <option key={preset}>{preset}</option>)}
                      </select>
                    </label>
                    <label>Background
                      <select value={section.background} onChange={(event) => updateSection({ background: event.target.value })}>
                        {backgrounds.map((value) => <option key={value}>{value}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className={styles.row}>
                    <label>Align
                      <select value={section.align} onChange={(event) => updateSection({ align: event.target.value })}>
                        <option>left</option><option>center</option>
                      </select>
                    </label>
                    <label>Padding
                      <select value={section.padding} onChange={(event) => updateSection({ padding: event.target.value })}>
                        <option>compact</option><option>normal</option><option>spacious</option>
                      </select>
                    </label>
                    <label>Media side
                      <select value={section.mediaSide} onChange={(event) => updateSection({ mediaSide: event.target.value })}>
                        <option>none</option><option>left</option><option>right</option>
                      </select>
                    </label>
                    <label className={styles.check}><input type="checkbox" checked={section.visible !== false} onChange={(event) => updateSection({ visible: event.target.checked })} /> Visible</label>
                  </div>
                  <div className={styles.row}>
                    <label>Section CTA<input value={section.ctaLabel} placeholder="Optional" onChange={(event) => updateSection({ ctaLabel: event.target.value })} /></label>
                    <label>CTA href<input value={section.ctaHref} onChange={(event) => updateSection({ ctaHref: event.target.value })} /></label>
                    <button type="button" onClick={() => { const next = page.sections.filter((_, i) => i !== sectionIndex); updatePage({ sections: next }); setSectionIndex(Math.max(0, sectionIndex - 1)); }}><Trash2 size={15} /> Remove section</button>
                    <button type="button" disabled={sectionIndex === 0} onClick={() => {
                      const next = [...page.sections];
                      [next[sectionIndex - 1], next[sectionIndex]] = [next[sectionIndex], next[sectionIndex - 1]];
                      updatePage({ sections: next }); setSectionIndex(sectionIndex - 1);
                    }}><ArrowUp size={15} /></button>
                    <button type="button" disabled={sectionIndex >= page.sections.length - 1} onClick={() => {
                      const next = [...page.sections];
                      [next[sectionIndex + 1], next[sectionIndex]] = [next[sectionIndex], next[sectionIndex + 1]];
                      updatePage({ sections: next }); setSectionIndex(sectionIndex + 1);
                    }}><ArrowDown size={15} /></button>
                  </div>

                  <div className={styles.blocksHead}>
                    <h4>Blocks</h4>
                    <button type="button" onClick={() => updateSection({ blocks: [...section.blocks, emptyBlock('feature-item')] })}><Plus size={14} /> Feature card</button>
                    <button type="button" onClick={() => updateSection({ blocks: [...section.blocks, emptyBlock('paragraph')] })}><Plus size={14} /> Text</button>
                    <button type="button" onClick={() => updateSection({ blocks: [...section.blocks, emptyBlock('html')] })}><Plus size={14} /> HTML import</button>
                  </div>

                  {section.blocks.map((block, index) => (
                    <div className={styles.block} key={`${section.id}-${index}`}>
                      <div className={styles.row}>
                        <label>Type
                          <select value={block.type} onChange={(event) => updateSection({ blocks: section.blocks.map((item, i) => i === index ? emptyBlock(event.target.value) : item) })}>
                            {blockTypes.map((type) => <option key={type}>{type}</option>)}
                          </select>
                        </label>
                        <button type="button" onClick={() => updateSection({ blocks: section.blocks.filter((_, i) => i !== index) })}><Trash2 size={14} /></button>
                      </div>
                      {['card', 'feature-item', 'faq-item', 'stat'].includes(block.type) && (
                        <>
                          <label>Title<input value={block.title || ''} onChange={(event) => updateBlock(index, { title: event.target.value })} /></label>
                          <label>Body<textarea rows={3} value={block.text || ''} onChange={(event) => updateBlock(index, { text: event.target.value })} /></label>
                          {(block.type === 'card' || block.type === 'feature-item') && <label>Link<input value={block.href || ''} onChange={(event) => updateBlock(index, { href: event.target.value })} /></label>}
                        </>
                      )}
                      {['heading', 'paragraph', 'list', 'quote', 'html'].includes(block.type) && (
                        <textarea className={block.type === 'html' ? styles.code : ''} rows={block.type === 'html' ? 12 : 4} value={block.text || ''} onChange={(event) => updateBlock(index, { text: event.target.value })} />
                      )}
                      {(block.type === 'button' || block.type === 'link') && (
                        <div className={styles.row}>
                          <label>Label<input value={block.label || ''} onChange={(event) => updateBlock(index, { label: event.target.value, text: event.target.value })} /></label>
                          <label>Href<input value={block.href || ''} onChange={(event) => updateBlock(index, { href: event.target.value })} /></label>
                          <label>Style
                            <select value={block.style || 'primary'} onChange={(event) => updateBlock(index, { style: event.target.value })}>
                              <option>primary</option><option>secondary</option><option>text</option>
                            </select>
                          </label>
                        </div>
                      )}
                      {block.type === 'image' && (
                        <div className={styles.row}>
                          <label>Asset
                            <select value={block.asset || 'hero'} onChange={(event) => updateBlock(index, { asset: event.target.value })}>
                              <option value="logo">logo</option><option value="hero">hero</option><option value="custom">custom</option>
                            </select>
                          </label>
                          {block.asset === 'custom' && <label>URL<input value={block.href || ''} onChange={(event) => updateBlock(index, { href: event.target.value })} /></label>}
                          <label>Alt<input value={block.alt || ''} onChange={(event) => updateBlock(index, { alt: event.target.value, text: event.target.value })} /></label>
                        </div>
                      )}
                      {block.type === 'video' && (
                        <div className={styles.row}>
                          <label>YouTube/Vimeo embed URL<input value={block.href || ''} onChange={(event) => updateBlock(index, { href: event.target.value })} placeholder="https://www.youtube.com/embed/..." /></label>
                          <label>Title<input value={block.title || ''} onChange={(event) => updateBlock(index, { title: event.target.value, text: event.target.value })} /></label>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className={styles.preview}>
                    <small>Section preview · {section.preset}</small>
                    <h3>{section.title}</h3>
                    <PreviewBlocks blocks={section.blocks} assets={assets} />
                  </div>
                </div>
              ) : null}

              {page.kind !== 'home' && (
                <button type="button" className={styles.danger} onClick={() => {
                  if (!window.confirm('Delete this page from the draft?')) return;
                  const next = document.pages.filter((_, index) => index !== pageIndex);
                  change({ pages: next });
                  setPageIndex(Math.max(0, pageIndex - 1));
                }}><Trash2 size={15} /> Delete page</button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
