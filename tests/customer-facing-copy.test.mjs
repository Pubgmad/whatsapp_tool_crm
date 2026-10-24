import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_HERO_SUBTITLE,
  sanitizeCustomerFacingDocument,
  sanitizeCustomerFacingPage
} from '../lib/customer-facing-copy.js';

test('replaces legacy Super Admin hero subtitle', () => {
  const page = sanitizeCustomerFacingPage({
    hero: {
      subtitle:
        'A production WhatsApp CRM for shared inbox, template campaigns, automation, CTWA ads, commerce, and analytics — with Super Admin controlled product pages.'
    }
  });
  assert.equal(page.hero.subtitle, HOME_HERO_SUBTITLE);
  assert.ok(!/Super Admin/i.test(page.hero.subtitle));
});

test('scrubs Super Admin phrases nested in documents', () => {
  const doc = sanitizeCustomerFacingDocument({
    pages: [
      {
        sections: [
          {
            blocks: [{ type: 'paragraph', text: 'Managed in Super Admin for your team.' }]
          }
        ]
      }
    ]
  });
  assert.match(doc.pages[0].sections[0].blocks[0].text, /platform settings/i);
  assert.ok(!/Super Admin/i.test(JSON.stringify(doc)));
});
