import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function dbInitWaves() {
  const init = await fs.readFile(path.join(root, 'scripts/db-init.mjs'), 'utf8');
  return [...init.matchAll(/readFile\(new URL\('\.\.\/db\/([^']+)'/g)].map((match) => match[1]);
}

test('db-init runs flow_screen_events DDL before any ALTER on that table', async () => {
  const waves = await dbInitWaves();
  const createWave = 'production-parity-extensions.sql';
  const createIndex = waves.indexOf(createWave);
  assert.ok(createIndex >= 0, `${createWave} must be listed in db-init.mjs`);
  const productSql = await fs.readFile(path.join(root, 'db', 'product-completion-wave.sql'), 'utf8');
  assert.equal(productSql.includes('flow_screen_events'), false, 'product-completion-wave should not ALTER flow_screen_events');
});

test('db-init ALTERs crm_connections only after crm-connectors CREATE', async () => {
  const waves = await dbInitWaves();
  const connectors = waves.indexOf('crm-connectors.sql');
  const product = waves.indexOf('product-completion-wave.sql');
  assert.ok(connectors >= 0, 'crm-connectors.sql must be listed');
  assert.ok(product >= 0, 'product-completion-wave.sql must be listed');
  assert.ok(product > connectors, 'product-completion-wave must run after crm-connectors');
  const productSql = await fs.readFile(path.join(root, 'db', 'product-completion-wave.sql'), 'utf8');
  assert.match(productSql, /crm_connections/, 'product-completion-wave should ALTER crm_connections');
});

test('tracked_link_tokens exposes (id,business_id) for click event FKs', async () => {
  const schema = await fs.readFile(path.join(root, 'db', 'click-tracking.sql'), 'utf8');
  assert.match(schema, /UNIQUE\(id,business_id\)/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS tracked_link_tokens_id_business/);
  assert.match(schema, /FOREIGN KEY\(token_id,business_id\) REFERENCES tracked_link_tokens\(id,business_id\)/);
});

test('db-init loads core CRM consent after click-tracking', async () => {
  const waves = await dbInitWaves();
  const click = waves.indexOf('click-tracking.sql');
  const consent = waves.indexOf('core-crm-consent.sql');
  assert.ok(click >= 0, 'click-tracking.sql must be listed');
  assert.ok(consent >= 0, 'core-crm-consent.sql must be listed');
  assert.ok(consent > click, 'core-crm-consent must run after click-tracking');
});

test('db-init loads automation-flows-production after advanced automation nodes', async () => {
  const waves = await dbInitWaves();
  const advanced = waves.indexOf('automation-advanced-nodes.sql');
  const production = waves.indexOf('automation-flows-production.sql');
  assert.ok(advanced >= 0, 'automation-advanced-nodes.sql must be listed');
  assert.ok(production >= 0, 'automation-flows-production.sql must be listed');
  assert.ok(production > advanced, 'automation-flows-production must run after advanced nodes');
  const sql = await fs.readFile(path.join(root, 'db', 'automation-flows-production.sql'), 'utf8');
  assert.match(sql, /trigger_mode IN \('keywords', 'regex', 'any_inbound', 'manual'\)/);
  assert.match(sql, /whatsapp_webview_submissions/);
});
