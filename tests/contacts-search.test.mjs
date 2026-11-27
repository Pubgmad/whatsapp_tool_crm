import assert from 'node:assert/strict';
import test from 'node:test';
import { contactSearchPredicate } from '../lib/contact-search.js';

test('contact search predicate uses JSONB-safe tag matching', () => {
  const sql = contactSearchPredicate('$2');
  assert.match(sql, /jsonb_array_elements_text/);
  assert.doesNotMatch(sql, /unnest\s*\(\s*tags\s*\)/i);
  assert.match(sql, /name ILIKE \$2/);
  assert.match(sql, /phone ILIKE \$2/);
  assert.match(sql, /COALESCE\(opt_in_source,\s*''\) ILIKE \$2/);
  assert.match(sql, /jsonb_typeof\(COALESCE\(tags,/);
});

test('contact search predicate substitutes parameter placeholders', () => {
  const sql = contactSearchPredicate('$4');
  assert.equal((sql.match(/\$4/g) || []).length, 4);
  assert.doesNotMatch(sql, /\$2/);
});

test('contact search predicate guards null, empty, and non-array tags', () => {
  const sql = contactSearchPredicate('$2');
  // Null tags become [] before typeof check.
  assert.match(sql, /COALESCE\(tags,\s*'\[\]'::jsonb\)/);
  // Non-array JSONB (object/string/number/legacy) falls back to empty array.
  assert.match(sql, /WHEN jsonb_typeof\(COALESCE\(tags,\s*'\[\]'::jsonb\)\) = 'array'/);
  assert.match(sql, /ELSE '\[\]'::jsonb/);
});

test('contact search predicate keeps tenant-safe caller responsible for business_id', () => {
  // Predicate itself is field-only; callers must AND business_id = $1 (verified in workspace-state).
  const sql = contactSearchPredicate('$2');
  assert.doesNotMatch(sql, /business_id/);
});
