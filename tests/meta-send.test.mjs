import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, sendInteractiveMessage, sendTemplateMessage, sendTextMessage } from '../lib/meta.js';

const previousKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = 'test-only-meta-send-encryption-key';
const setup = {
  waba_id: '123',
  phone_number_id: '456',
  access_token_encrypted: encryptSecret('test-only-token')
};
if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
else process.env.ENCRYPTION_KEY = previousKey;

test('Meta sends require a real message ID', async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'test-only-meta-send-encryption-key';
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  const sends = [
    () => sendTextMessage({ setup, to: '15551234567', body: 'Hello' }),
    () => sendInteractiveMessage({ setup, to: '15551234567', body: 'Choose', options: [{ id: 'yes', label: 'Yes' }] }),
    () => sendTemplateMessage({ setup, to: '15551234567', templateName: 'welcome' })
  ];
  for (const send of sends) {
    globalThis.fetch = async () => Response.json({ messages: [{ id: 'wamid.real' }] });
    assert.equal((await send()).metaMessageId, 'wamid.real');
    globalThis.fetch = async () => Response.json({ messages: [] });
    await assert.rejects(send(), (error) => error.code === 'META_SEND_UNCONFIRMED' && error.status === 409);
    globalThis.fetch = async () => { throw new TypeError('network failed'); };
    await assert.rejects(send(), (error) => error.code === 'META_SEND_UNCONFIRMED' && error.status === 409);
  }
});
