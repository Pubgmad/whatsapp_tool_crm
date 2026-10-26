import assert from 'node:assert/strict';
import test from 'node:test';
import { isMetaReviewerEmail, reviewerEnv, reviewerSubscriptionBypassAllowed } from '../lib/reviewer-access.js';

test('reviewerEnv defaults', () => {
  const prev = process.env.REVIEWER_EMAIL;
  delete process.env.REVIEWER_EMAIL;
  assert.equal(reviewerEnv().email, 'metareview@gmail.com');
  if (prev !== undefined) process.env.REVIEWER_EMAIL = prev;
});

test('reviewerSubscriptionBypassAllowed uses membership query', async () => {
  const prev = process.env.REVIEWER_EMAIL;
  process.env.REVIEWER_EMAIL = 'metareview@gmail.com';
  const calls = [];
  const run = async (sql, params) => {
    calls.push(params);
    return { rows: [{ ok: 1 }] };
  };
  assert.equal(await reviewerSubscriptionBypassAllowed('b_test', run), true);
  assert.equal(calls[0][1], 'metareview@gmail.com');
  if (prev === undefined) delete process.env.REVIEWER_EMAIL;
  else process.env.REVIEWER_EMAIL = prev;
});

test('isMetaReviewerEmail matches env', () => {
  const prev = process.env.REVIEWER_EMAIL;
  process.env.REVIEWER_EMAIL = 'metareview@gmail.com';
  assert.equal(isMetaReviewerEmail('MetaReview@Gmail.com'), true);
  assert.equal(isMetaReviewerEmail('other@example.com'), false);
  if (prev === undefined) delete process.env.REVIEWER_EMAIL;
  else process.env.REVIEWER_EMAIL = prev;
});
