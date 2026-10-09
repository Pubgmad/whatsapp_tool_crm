import assert from 'node:assert/strict';
import test from 'node:test';
import { managedFlowRuntimeUrl } from '../lib/flow-runtime-url.js';
import { callingHoursOpen, validateCallingHours } from '../lib/calling-business-hours.js';
import { requireStringField, requireObject } from '../lib/api-body.js';

test('managedFlowRuntimeUrl requires HTTPS APP_URL', () => {
  const prev = process.env.APP_URL;
  delete process.env.APP_URL;
  assert.equal(managedFlowRuntimeUrl().ok, false);
  process.env.APP_URL = prev;
});

test('validateCallingHours accepts support policy fallback', () => {
  const hours = validateCallingHours({ useSupportPolicy: true });
  assert.equal(hours.useSupportPolicy, true);
});

test('calling hours validate dedicated schedules and evaluate their timezone', async () => {
  const hours = validateCallingHours({
    useSupportPolicy: false,
    alwaysOpen: false,
    timezone: 'Asia/Kolkata',
    windows: [{ day: 'fri', startMinute: 600, endMinute: 660 }]
  });
  assert.equal(await callingHoursOpen('business', null, hours, new Date('2026-10-09T04:45:00.000Z')), true);
  assert.equal(await callingHoursOpen('business', null, hours, new Date('2026-10-09T06:00:00.000Z')), false);
  assert.throws(() => validateCallingHours({ useSupportPolicy: false, timezone: 'Not/A_Timezone', windows: [] }));
  assert.throws(() => validateCallingHours({ useSupportPolicy: false, timezone: 'Asia/Kolkata', windows: [] }));
  assert.throws(() => validateCallingHours({ useSupportPolicy: false, timezone: 'Asia/Kolkata', windows: [
    { day: 'fri', startMinute: 600, endMinute: 660 },
    { day: 'fri', startMinute: 700, endMinute: 760 }
  ] }));
});

test('calling hours evaluate support-policy hours at the requested instant', async () => {
  const supportPolicy = {
    enabled: true, mode: 'manual', scope: 'handoff', timezone: 'America/New_York',
    alwaysOpen: false, agentIds: [], maxOpen: 10, slaMinutes: 30, escalationUserId: null,
    hours: [{ day: 5, start: '09:00', end: '17:00' }]
  };
  assert.equal(await callingHoursOpen('business', supportPolicy, { useSupportPolicy: true }, new Date('2026-10-09T14:00:00.000Z')), true);
  assert.equal(await callingHoursOpen('business', supportPolicy, { useSupportPolicy: true }, new Date('2026-10-09T22:00:00.000Z')), false);
});

test('api-body validators reject invalid payloads', () => {
  assert.throws(() => requireObject(null), /JSON object/);
  assert.throws(() => requireStringField({ name: '' }, 'name'), /name/);
});
