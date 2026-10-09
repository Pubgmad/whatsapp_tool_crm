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
