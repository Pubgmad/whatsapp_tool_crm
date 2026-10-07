import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeSalesforceContact,normalizeSalesforceLead,salesforceInstance} from '../lib/salesforce-contacts.js';

test('Salesforce instance URLs reject untrusted redirects and embedded credentials',()=>{
  assert.equal(salesforceInstance('https://tenant.my.salesforce.com'),'https://tenant.my.salesforce.com');
  for(const value of ['http://tenant.my.salesforce.com','https://tenant.salesforce.com.evil.test','https://user:pass@tenant.my.salesforce.com','https://tenant.my.salesforce.com/other','https://127.0.0.1'])assert.throws(()=>salesforceInstance(value),{code:'CRM_AUTH_FAILED'});
});

test('Salesforce contact import requires E.164 phone, valid ID and modification time',()=>{
  const raw={Id:'003000000000000AAA',FirstName:'Ada',LastName:'Lovelace',MobilePhone:'+15551234567',LastModifiedDate:'2026-10-01T12:00:00.000Z'};
  assert.deepEqual(normalizeSalesforceContact(raw),{externalId:raw.Id,phone:'15551234567',name:'Ada Lovelace',updatedAt:raw.LastModifiedDate});
  assert.equal(normalizeSalesforceContact({...raw,MobilePhone:'555-123-4567'}),null);
  assert.equal(normalizeSalesforceContact({...raw,Id:'bad'}),null);
  assert.equal(normalizeSalesforceContact({...raw,LastModifiedDate:'bad'}),null);
});

test('Salesforce Lead import excludes converted and invalid records',()=>{
  const lead={Id:'00Q000000000000AAA',FirstName:'Grace',LastName:'Hopper',MobilePhone:'+15557654321',LastModifiedDate:'2026-10-01T12:00:00.000Z',IsConverted:false};
  assert.deepEqual(normalizeSalesforceLead(lead),{externalId:lead.Id,phone:'15557654321',name:'Grace Hopper',updatedAt:lead.LastModifiedDate,objectType:'Lead'});
  assert.equal(normalizeSalesforceLead({...lead,IsConverted:true}),null);
  assert.equal(normalizeSalesforceLead({...lead,Id:'003000000000000AAA'}),null);
});
