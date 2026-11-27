import assert from 'node:assert/strict';
import {
  filterNavGroups,
  filterPlanFeatureList,
  isReleaseApiPathBlocked,
  isReleaseAppPathBlocked,
  isReleaseFeatureAllowed,
  isReleaseFeatureExcluded,
  isReleaseFeatureSlugAllowed,
  isReleaseViewAllowed,
  sanitizeCmsDocumentForRelease
} from '../lib/release-feature-allowlist.js';

assert.equal(isReleaseFeatureAllowed('automation'), true);
assert.equal(isReleaseFeatureAllowed('ads'), false);
assert.equal(isReleaseFeatureExcluded('commerce'), true);
assert.equal(isReleaseViewAllowed('inbox'), true);
assert.equal(isReleaseViewAllowed('ads'), false);
assert.equal(isReleaseAppPathBlocked('/app/ads'), true);
assert.equal(isReleaseAppPathBlocked('/app/ads/foo'), true);
assert.equal(isReleaseAppPathBlocked('/app/inbox'), false);
assert.equal(isReleaseApiPathBlocked('/api/whatsapp/ads'), true);
assert.equal(isReleaseApiPathBlocked('/api/whatsapp/ads/credits'), true);
assert.equal(isReleaseApiPathBlocked('/api/workspace/state'), false);
assert.equal(isReleaseFeatureSlugAllowed('whatsapp-automation'), true);
assert.equal(isReleaseFeatureSlugAllowed('whatsapp-ads'), false);

const plans = filterPlanFeatureList(['inbox', 'ads', 'calling', 'automation', 'Scheduled broadcasts']);
assert.deepEqual(plans, ['inbox', 'automation', 'Scheduled broadcasts']);

const nav = filterNavGroups([
  { id: 'a', items: [{ id: 'inbox' }, { id: 'ads' }] },
  { id: 'b', items: [{ id: 'calling' }] }
]);
assert.equal(nav.length, 1);
assert.deepEqual(nav[0].items.map((i) => i.id), ['inbox']);

const sanitized = sanitizeCmsDocumentForRelease({
  products: [{ slug: 'ads-commerce' }, { slug: 'broadcasting', features: [{ href: '/features/whatsapp-ads' }, { href: '/features/whatsapp-inbox' }] }],
  pages: [
    { kind: 'feature', slug: 'whatsapp-ads' },
    { kind: 'feature', slug: 'whatsapp-inbox', sections: [{ blocks: [{ href: '/features/whatsapp-commerce' }, { href: '/features/whatsapp-flows' }] }] }
  ]
});
assert.equal(sanitized.products.length, 1);
assert.equal(sanitized.products[0].features.length, 1);
assert.equal(sanitized.pages.length, 1);
assert.equal(sanitized.pages[0].sections[0].blocks.length, 1);

console.log('release-feature-allowlist.test.mjs: ok');
