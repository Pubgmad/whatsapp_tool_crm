import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingDestination,trackingMarker} from '../lib/click-tracking.js';
import {audienceContactQuery} from '../lib/audience-rules.js';
test('tracked destinations reject active schemes, local addresses and credentials',()=>{
 for(const value of ['javascript:alert(1)','http://shop.example.test','https://admin:secret@shop.example.test','https://127.0.0.1/','https://localhost/','https://service.internal/'])assert.throws(()=>trackingDestination(value));
 assert.equal(trackingDestination('https://shop.example.test/product?id=1'),'https://shop.example.test/product?id=1');
});
test('tracking references are typed and never accepted as mixed partial text',()=>{
 assert.deepEqual(trackingMarker('{{tracked_link:link_123}}'),{kind:'link',id:'link_123'});
 assert.deepEqual(trackingMarker('{{tracked_token:link_123}}'),{kind:'token',id:'link_123'});
 assert.equal(trackingMarker('ordinary parameter'),null);
 assert.throws(()=>trackingMarker('prefix {{tracked_link:link_123}}'));
 const statement=audienceContactQuery('tenant',{engagement:[{campaignId:'campaign',event:'clicked',match:'matched',withinDays:7}]});
 assert.match(statement.text,/tk.business_id=ct.business_id/);
 assert.match(statement.text,/tk.campaign_recipient_id=cr.id/);
 assert.match(statement.text,/tk.confirmed_at IS NOT NULL/);
});
