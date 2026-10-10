import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCoexistenceContacts, parseCoexistenceEchoes, parseCoexistenceHistory } from '../lib/coexistence-payload.js';

test('Business App contacts do not turn unknown or delete actions into imported contacts', () => {
  const contacts = parseCoexistenceContacts({ state_sync: [
    { type: 'contact', action: 'add', contact: { full_name: 'Asha', phone_number: '919876543210' } },
    { type: 'contact', action: 'delete', contact: { phone_number: '919876543211' } },
    { type: 'label', contact: { phone_number: '919876543212' } }
  ] });
  assert.deepEqual(contacts, [{ phone: '+919876543210', name: 'Asha' }]);
});

test('history preserves message direction, date and identity without inventing contacts', () => {
  const result = parseCoexistenceHistory({ history: [{ threads: [{ id: '919876543210', messages: [
    { id: 'in-1', from: '919876543210', timestamp: '1700000000', type: 'text', text: { body: 'Hello' } },
    { id: 'out-1', from: '919888888888', to: '919876543210', timestamp: '1700000010', type: 'text', text: { body: 'Hi' } },
    { id: 'unknown', from: '919777777777', timestamp: '1700000020', type: 'text', text: { body: 'No direction' } }
  ] }] }] });
  assert.equal(result.declined, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.messages.map((item) => [item.metaMessageId, item.direction]), [['in-1', 'incoming'], ['out-1', 'outgoing']]);
  assert.equal(result.messages[0].at.toISOString(), '2023-11-14T22:13:20.000Z');
  assert.equal(parseCoexistenceHistory({ history: [{ errors: [{ code: 1 }] }] }).declined, true);
  assert.equal(parseCoexistenceHistory({ history: [{ metadata: { progress: 100 }, threads: [] }] }).complete, true);
});

test('Business App echoes use the recipient, not the business number', () => {
  const echoes = parseCoexistenceEchoes({ message_echoes: [
    { id: 'echo-1', from: '919888888888', to: '919876543210', timestamp: '1700000000', type: 'text', text: { body: 'Reply' } }
  ] });
  assert.equal(echoes[0].phone, '+919876543210');
  assert.equal(echoes[0].body, 'Reply');
});
