import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
test('repeat click storage is append-only, tenant scoped and retention linked',()=>{
 const schema=fs.readFileSync('./db/click-tracking.sql','utf8');
 assert.match(schema,/CREATE TABLE IF NOT EXISTS tracked_link_click_events/);
 assert.match(schema,/FOREIGN KEY\(token_id,business_id\).*ON DELETE CASCADE/);
 assert.match(schema,/tracked_link_click_events ENABLE ROW LEVEL SECURITY/);
 assert.match(schema,/tracked_link_click_events FORCE ROW LEVEL SECURITY/);
 assert.match(schema,/FOR INSERT WITH CHECK/);
 assert.doesNotMatch(schema,/tracked_link_click_events FOR UPDATE/);
});
test('confirmed POSTs append events after rate and origin checks',()=>{
 const source=fs.readFileSync('./lib/click-tracking.js','utf8');
 const rateCheck=source.indexOf("enforceRequestRateLimit(request,hash(token),'api')");
 const originCheck=source.indexOf("request.headers.get('origin')!==origin");
 const eventInsert=source.indexOf('INSERT INTO tracked_link_click_events');
 assert.ok(rateCheck>=0&&originCheck>rateCheck&&eventInsert>originCheck);
 assert.match(source,/COUNT\(DISTINCT e\.contact_id\)::int AS unique_clickers/);
 assert.match(source,/MIN\(e\.clicked_at\) AS first_clicked_at,MAX\(e\.clicked_at\) AS last_clicked_at/);
});
