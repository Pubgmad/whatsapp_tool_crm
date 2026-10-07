import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { WORKSPACE_API_ROUTE_POLICY } from '../lib/workspace-api-policy-data.js';

const root = process.cwd();

test('documented workspace API routes include required role guards', () => {
  const failures = [];
  for (const entry of WORKSPACE_API_ROUTE_POLICY) {
    const filePath = path.join(root, entry.path);
    if (!fs.existsSync(filePath)) {
      failures.push(`${entry.path} missing`);
      continue;
    }
    const source = fs.readFileSync(filePath, 'utf8');
    if (!source.includes(entry.guard)) {
      failures.push(`${entry.path} missing guard ${entry.guard}`);
    }
  }
  assert.equal(failures.length, 0, failures.join('\n'));
});
