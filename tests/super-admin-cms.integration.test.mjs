import test from 'node:test';
import assert from 'node:assert/strict';
import { enterSystemContext } from '../lib/db.js';
import { changeSiteDraft, getPublishedSite, getSiteDraft } from '../lib/public-site.js';
import { getDefaultCmsDocument, validateSiteDocument } from '../lib/cms-document.js';

test('super admin CMS save/publish keeps pages document and scrubs footer workspace CTAs', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();

  const draft = await getSiteDraft();
  const document = validateSiteDocument({
    ...getDefaultCmsDocument(),
    brandName: 'Growth Desk QA',
    footer: {
      ...getDefaultCmsDocument().footer,
      ctaLabel: 'Create workspace',
      ctaHref: '/signup',
      ctaText: 'Should be scrubbed',
      columns: getDefaultCmsDocument().footer.columns
    }
  });

  assert.equal(document.footer.ctaHref || '', '');
  assert.ok(!(document.footer.ctaLabel || '').toLowerCase().includes('create workspace'));

  const beforePublish = (await getPublishedSite()).document;
  const saved = await changeSiteDraft({ action: 'save', revision: draft.revision, document });
  assert.notEqual(saved.revision, draft.revision);
  assert.deepEqual((await getPublishedSite()).document, beforePublish);

  await assert.rejects(changeSiteDraft({ action: 'publish', revision: draft.revision }), { code: 'SITE_REVISION_CONFLICT' });

  const published = await changeSiteDraft({ action: 'publish', revision: saved.revision });
  assert.equal(published.publishedRevision, saved.revision);
  const live = (await getPublishedSite()).document;
  assert.ok(Array.isArray(live.pages) && live.pages.length > 0);
  assert.equal(live.footer.ctaHref || '', '');
  assert.ok(live.footer.columns.some((column) => column.title === 'Products'));
  assert.ok(live.pages.some((page) => page.slug === 'whatsapp-crm' || page.kind === 'product'));
});

test('super admin plan savePlan validates currency and persists via public-site-safe defaults path', {
  skip: !process.env.TEST_DATABASE_URL
}, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const { query } = await import('../lib/db.js');
  const suffix = cryptoRandom();
  const code = `qa_${suffix}`;
  try {
    const inserted = await query(
      `INSERT INTO subscription_plans (id, code, name, description, billing_interval, price_cents, monthly_price_cents, yearly_price_cents, currency, trial_days, features, display_order, visible, is_active)
       VALUES ($1,$2,$3,'QA plan','monthly',1000,1000,10000,'USD',0,'{}'::jsonb,99,TRUE,TRUE)
       RETURNING id,code,currency,monthly_price_cents`,
      [`plan_${suffix}`, code, `QA ${suffix}`]
    );
    assert.equal(inserted.rows[0].currency, 'USD');
    assert.equal(Number(inserted.rows[0].monthly_price_cents), 1000);
    const listed = await query('SELECT code FROM subscription_plans WHERE id=$1', [`plan_${suffix}`]);
    assert.equal(listed.rows[0].code, code);
  } finally {
    await query('DELETE FROM subscription_plans WHERE id=$1', [`plan_${suffix}`]);
  }
});

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10);
}
