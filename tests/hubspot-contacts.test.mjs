import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyHubSpotFailure,classifyHubSpotOAuthFailure,normalizeHubSpotContact,hubspotName} from '../lib/hubspot-contacts.js';

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

test('HubSpot failures distinguish authorization, permissions, plan and rate limits',()=>{
  assert.equal(classifyHubSpotFailure(401,{category:'EXPIRED_AUTHENTICATION'}).code,'CRM_REAUTHORIZE');
  assert.equal(classifyHubSpotFailure(403,{category:'MISSING_SCOPES'}).code,'CRM_SCOPE_MISSING');
  assert.equal(classifyHubSpotFailure(403,{message:'This user needs Super Admin permission'}).code,'CRM_ACCOUNT_PERMISSION_REQUIRED');
  assert.equal(classifyHubSpotFailure(403,{message:'This feature is not available on your subscription tier'}).code,'CRM_PLAN_FEATURE_UNAVAILABLE');
  assert.equal(classifyHubSpotFailure(403,{message:'Forbidden'}).code,'CRM_ACCOUNT_ACCESS_DENIED');
  const limited=classifyHubSpotFailure(429,{category:'RATE_LIMITS'},'120');
  assert.equal(limited.code,'CRM_RATE_LIMIT');
  assert.equal(limited.retryAfter,120);
  assert.equal(classifyHubSpotFailure(503,{message:'Unavailable'}).code,'CRM_UNREACHABLE');
});

test('HubSpot OAuth failures have safe actionable categories',()=>{
  assert.equal(classifyHubSpotOAuthFailure('access_denied','The user declined').code,'CRM_AUTH_CANCELLED');
  assert.equal(classifyHubSpotOAuthFailure('invalid_scope','Missing scope').code,'CRM_SCOPE_MISSING');
  assert.equal(classifyHubSpotOAuthFailure('unauthorized_client','').code,'CRM_APP_CONFIGURATION');
  assert.equal(classifyHubSpotOAuthFailure('other','Super Admin permission required').code,'CRM_ACCOUNT_PERMISSION_REQUIRED');
  assert.equal(classifyHubSpotOAuthFailure('other','Feature unavailable on this plan').code,'CRM_PLAN_FEATURE_UNAVAILABLE');
});
