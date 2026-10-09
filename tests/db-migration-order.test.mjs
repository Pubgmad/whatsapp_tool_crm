import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('db-init runs flow_screen_events DDL before any ALTER on that table', async () => {
  const init = await fs.readFile(path.join(root, 'scripts/db-init.mjs'), 'utf8');
  const waves = [...init.matchAll(/readFile\(new URL\('\.\.\/db\/([^']+)'/g)].map((match) => match[1]);
  const createWave = 'production-parity-extensions.sql';
  const alterOnlyWaves = ['product-completion-wave.sql'];
  const createIndex = waves.indexOf(createWave);
  assert.ok(createIndex >= 0, `${createWave} must be listed in db-init.mjs`);
  for (const wave of alterOnlyWaves) {
    const alterIndex = waves.indexOf(wave);
    assert.ok(alterIndex >= 0, `${wave} must be listed in db-init.mjs`);
    const sql = await fs.readFile(path.join(root, 'db', wave), 'utf8');
    if (!/flow_screen_events/i.test(sql)) continue;
    assert.ok(
      alterIndex > createIndex,
      `${wave} must run after ${createWave} when it touches flow_screen_events`
    );
  }
  const productSql = await fs.readFile(path.join(root, 'db', 'product-completion-wave.sql'), 'utf8');
  assert.equal(productSql.includes('flow_screen_events'), false, 'product-completion-wave should not ALTER flow_screen_events');
});
