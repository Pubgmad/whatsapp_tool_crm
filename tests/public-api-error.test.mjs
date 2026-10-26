import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError, errorJson } from '../lib/db.js';

async function bodyOf(error) {
  const response = errorJson(error);
  return response.json();
}

test('product Meta ads errors are not masked by GRANT/ALS false positives', async () => {
  const mismatch = await bodyOf(
    new AppError(
      'Meta must grant access to an active ad account and a Page linked to this exact WhatsApp number.',
      403,
      'ADS_ASSET_MISMATCH'
    )
  );
  assert.match(mismatch.error, /grant access/i);
  assert.equal(mismatch.code, 'ADS_ASSET_MISMATCH');

  const scope = await bodyOf(
    new AppError('Meta did not grant Click-to-WhatsApp permissions: ads_management.', 403, 'META_SCOPE_MISSING')
  );
  assert.match(scope.error, /did not grant/i);
  assert.equal(scope.code, 'META_SCOPE_MISSING');

  const also = await bodyOf(new AppError('Also reconnect WhatsApp before finishing.', 400, 'TEST'));
  assert.match(also.error, /Also reconnect/i);
});

test('real Postgres privilege text stays masked', async () => {
  const masked = await bodyOf(
    new AppError('permission denied for table ads_oauth_pending', 503, 'DB_PERMISSION_DENIED')
  );
  // PUBLIC_ERROR_BY_CODE maps DB_PERMISSION_DENIED first
  assert.match(masked.error, /could not save|could not complete/i);
});
