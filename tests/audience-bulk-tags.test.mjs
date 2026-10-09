import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkTagUpdateStatement } from '../lib/audience-bulk-tags.js';

test('bulk tag SQL is parameterized and constrained by tenant and frozen snapshot',()=>{
  const malicious="vip' WHERE TRUE --";
  const statement=bulkTagUpdateStatement('tenant_a','job_1','add',[malicious]);
  assert.deepEqual(statement.params,['tenant_a','job_1',[malicious]]);
  assert.equal(statement.text.includes(malicious),false);
  assert.match(statement.text,/ct\.business_id=\$1/);
  assert.match(statement.text,/snap\.job_id=\$2 AND snap\.business_id=\$1 AND snap\.contact_id=ct\.id/);
  assert.match(statement.text,/jsonb_agg\(DISTINCT value\)/);
});

test('bulk tag removal uses a bound array and preserves unrelated tags',()=>{
  const statement=bulkTagUpdateStatement('tenant_a','job_1','remove',['cold']);
  assert.match(statement.text,/value <> ALL\(\$3::text\[\]\)/);
  assert.deepEqual(statement.params[2],['cold']);
});
