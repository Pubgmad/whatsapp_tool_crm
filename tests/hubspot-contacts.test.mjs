import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHubSpotContact,hubspotName} from '../lib/hubspot-contacts.js';

test('HubSpot import accepts only explicit international phone numbers',()=>{
  const input={id:'123',updatedAt:'2026-09-30T10:00:00Z',properties:{phone:'+15551234567',firstname:'Ana',lastname:'Lee'}};
  assert.deepEqual(normalizeHubSpotContact(input),{externalId:'123',phone:'15551234567',name:'Ana Lee',updatedAt:'2026-09-30T10:00:00.000Z'});
  assert.equal(normalizeHubSpotContact({...input,properties:{...input.properties,phone:'5551234567'}}),null);
  assert.equal(normalizeHubSpotContact({...input,archived:true}),null);
  assert.equal(normalizeHubSpotContact({...input,updatedAt:'invalid'}),null);
});

test('HubSpot outbound name mapping is bounded',()=>{
  assert.deepEqual(hubspotName('Ana Lee'),{firstname:'Ana',lastname:'Lee'});
  assert.equal(hubspotName('x'.repeat(200)).firstname.length,100);
});
