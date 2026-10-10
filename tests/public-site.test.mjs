import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { getDefaultCmsDocument, migrateSiteDocument, validateSiteDocument } from '../lib/cms-document.js';
import { mergePublicFooterLinks, saveBrandAsset } from '../lib/public-site.js';

test('mergePublicFooterLinks dedupes CMS and platform defaults', () => {
  assert.deepEqual(
    mergePublicFooterLinks([{ label: 'Pricing', href: '/signup' }], [{ label: 'About', href: '/about' }, { label: 'Dup', href: '/signup' }]),
    [{ label: 'Pricing', href: '/signup' }, { label: 'About', href: '/about' }]
  );
});

test('default CMS document validates with feature routes', () => {
  const doc = getDefaultCmsDocument();
  assert.equal(doc.version, 3);
  assert.ok(doc.pages.some((page) => page.kind === 'home'));
  assert.ok(doc.pages.some((page) => page.kind === 'feature' && page.slug === 'whatsapp-calling'));
  assert.ok(doc.products.some((product) => product.title === 'WhatsApp CRM'));
  const productsNav = doc.navigation.find((item) => item.menuStyle === 'mega');
  assert.ok(productsNav);
  assert.ok(productsNav.children.length >= 1);
  assert.ok(productsNav.children[0].children.some((feature) => feature.href.includes('whatsapp-calling')));
});

test('legacy section documents migrate into pages', () => {
  const legacy = {
    sections: [{
      id: 'about',
      kind: 'about',
      title: 'About the product',
      eyebrow: 'Our team',
      visible: true,
      layout: 'plain',
      align: 'left',
      blocks: [{ type: 'paragraph', text: 'Customer support with WhatsApp.', emphasis: 'none' }],
      ctaLabel: 'Learn more',
      ctaHref: '/signup'
    }],
    footerLinks: [{ label: 'About', href: '/about' }],
    socialLinks: [{ label: 'LinkedIn', href: 'https://linkedin.com/company/example' }]
  };
  const doc = validateSiteDocument(migrateSiteDocument(legacy));
  assert.equal(doc.footer.socialLinks[0].label, 'LinkedIn');
  const about = doc.pages.find((page) => page.kind === 'about');
  assert.equal(about.sections[0].blocks[0].text, 'Customer support with WhatsApp.');
});

test('html import blocks sanitize breakout hosts', () => {
  const base = getDefaultCmsDocument();
  base.pages[0].sections[0].blocks = [{
    type: 'html',
    text: '<style>.hero{color:#125c63}</style><div class="hero">Designed<a href="javascript:alert(1)">x</a><iframe src="https://evil.example"></iframe></div><script>window.__ok=1</script>'
  }];
  const doc = validateSiteDocument(base);
  const html = doc.pages[0].sections[0].blocks[0];
  assert.equal(html.type, 'html');
  assert.match(html.text, /class="hero"/);
  assert.match(html.text, /window\.__ok=1/);
  assert.doesNotMatch(html.text, /<iframe/i);
});

test('rejects unsafe external navigation targets', () => {
  const base = getDefaultCmsDocument();
  assert.throws(() => validateSiteDocument({
    ...base,
    navigation: [{ id: 'bad', label: 'Bad', href: 'javascript:alert(1)', type: 'external', visible: true, children: [] }]
  }), { code: 'SITE_INVALID' });
});

test('brand assets reject unsupported and oversized input before storage', async () => {
  await assert.rejects(saveBrandAsset('logo', Buffer.from('not an image')), { code: 'ASSET_INVALID' });
  const rectangle = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(saveBrandAsset('favicon', rectangle), { code: 'ASSET_INVALID' });
  await assert.rejects(saveBrandAsset('logo', Buffer.alloc(5_000_001)), { code: 'ASSET_INVALID' });
});
