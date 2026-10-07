import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePublicFooterLinks } from '../lib/public-site.js';
import { PRODUCT_CAPABILITIES } from '../lib/product-capability-registry-data.js';
import { registrySummary } from '../lib/product-capability-registry.js';

test('product capability registry has unique ids and valid statuses', () => {
  const ids = new Set();
  for (const item of PRODUCT_CAPABILITIES) {
    assert.ok(item.id);
    assert.ok(!ids.has(item.id));
    ids.add(item.id);
    assert.ok(['strong', 'partial', 'gap'].includes(item.codeStatus));
  }
  const summary = registrySummary();
  assert.equal(summary.total, PRODUCT_CAPABILITIES.length);
  assert.equal(summary.byStatus.strong + summary.byStatus.partial + summary.byStatus.gap, summary.total);
});

test('mergePublicFooterLinks prefers CMS order and dedupes hrefs', () => {
  const merged = mergePublicFooterLinks(
    [{ label: 'Custom', href: '/signup' }],
    [{ label: 'About', href: '/about' }, { label: 'Dup', href: '/signup' }]
  );
  assert.deepEqual(merged, [
    { label: 'Custom', href: '/signup' },
    { label: 'About', href: '/about' }
  ]);
});

