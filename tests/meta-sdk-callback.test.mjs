import test from 'node:test';
import assert from 'node:assert/strict';
import { metaSdkCallback } from '../lib/meta-sdk-callback.js';

test('Meta signup callback is a plain function and completes async work', async () => {
  let resolve;
  const done = new Promise((next) => { resolve = next; });
  const callback = metaSdkCallback(async (response) => {
    assert.equal(response.authResponse.code, 'test-code');
    resolve();
  }, (error) => { throw error; });
  assert.equal(callback.constructor.name, 'Function');
  assert.equal(callback({ authResponse: { code: 'test-code' } }), undefined);
  await done;
});

test('Meta signup callback forwards async failures', async () => {
  let resolve;
  const failed = new Promise((next) => { resolve = next; });
  const callback = metaSdkCallback(async () => { throw new Error('Meta callback failed'); }, resolve);
  callback({});
  assert.match((await failed).message, /Meta callback failed/);
});
