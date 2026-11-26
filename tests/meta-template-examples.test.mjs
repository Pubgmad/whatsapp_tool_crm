import test from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppTemplate, encryptSecret } from '../lib/meta.js';

test('variable templates include positional body examples for Meta', async (context) => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ENCRYPTION_KEY = 'test-only-template-examples-key';
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  const setup = {
    waba_id: '123',
    access_token_encrypted: encryptSecret('test-only-token')
  };
  let submitted;
  globalThis.fetch = async (_url, options) => {
    submitted = JSON.parse(options.body);
    return Response.json({ id: 'template-id', status: 'PENDING' });
  };

  await createWhatsAppTemplate({
    setup,
    name: 'appointment confirmation',
    body: 'Hi {{1}}, thank you for booking with us. Your appointment is confirmed for {{2}}. Please arrive a few minutes early at {{3}}. If you need to reschedule or cancel, reply to this chat and our team will help you.',
    category: 'UTILITY',
    headerText: 'Appointment confirmed',
    componentSchema: {
      headerFormat: 'TEXT',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Reschedule' },
        { type: 'QUICK_REPLY', text: 'Cancel' }
      ]
    }
  });

  assert.equal(submitted.parameter_format, 'POSITIONAL');
  assert.equal(submitted.allow_category_change, true);
  const body = submitted.components.find((item) => item.type === 'BODY');
  assert.deepEqual(body.example.body_text, [['Sample 1', 'Sample 2', 'Sample 3']]);
});
