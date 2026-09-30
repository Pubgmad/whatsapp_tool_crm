import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {callSession,callingIceServers} from '../lib/whatsapp-calling.js';
import {whatsappAdPayload} from '../lib/whatsapp-ads.js';
import {nativeOrderPayload,verifiedNativePayment} from '../lib/whatsapp-native-payments.js';

test('calling accepts audio-only SDP and mints short-lived user-bound relay credentials',()=>{
  const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 00:11\r\n';
  assert.equal(callSession({sdp_type:'offer',sdp},'offer').sdp,sdp);
  assert.throws(()=>callSession({sdp_type:'answer',sdp},'offer'));
  assert.throws(()=>callSession({sdp_type:'offer',sdp:sdp+'m=video 9 UDP/TLS/RTP/SAVPF 96\r\n'},'offer'));
  const before={url:process.env.WHATSAPP_CALL_TURN_URLS,secret:process.env.WHATSAPP_CALL_TURN_SECRET};
  try{
    process.env.WHATSAPP_CALL_TURN_URLS='turns:relay.example.com:5349?transport=tcp';process.env.WHATSAPP_CALL_TURN_SECRET='test-only-turn-secret';
    const [first]=callingIceServers('tenant:user',0),[second]=callingIceServers('other:user',0);
    assert.match(first.username,/^3600:/);assert.notEqual(first.username,second.username);
    assert.equal(first.credential,crypto.createHmac('sha1','test-only-turn-secret').update(first.username).digest('base64'));
    process.env.WHATSAPP_CALL_TURN_URLS='https://untrusted.example.com';assert.throws(()=>callingIceServers('user'));
  }finally{if(before.url===undefined)delete process.env.WHATSAPP_CALL_TURN_URLS;else process.env.WHATSAPP_CALL_TURN_URLS=before.url;if(before.secret===undefined)delete process.env.WHATSAPP_CALL_TURN_SECRET;else process.env.WHATSAPP_CALL_TURN_SECRET=before.secret;}
});
test('ad creation remains paused and bound to WhatsApp assets and owner currency',()=>{
  const input={name:'Owner supplied name',headline:'Owner supplied headline',text:'Owner supplied text',dailyBudget:'500.25',countries:['IN'],ageMin:18,ageMax:65,imageHash:'a'.repeat(32),customAudiences:['123']};
  const result=whatsappAdPayload(input,{currency:'INR',page_id:'777'},'919999999999');
  assert.equal(result.campaign.status,'PAUSED');assert.equal(result.ad.status,'PAUSED');assert.equal(result.adset.destination_type,'WHATSAPP');assert.equal(result.adset.daily_budget,50025);
  assert.equal(result.creative.object_story_spec.link_data.call_to_action.value.whatsapp_number,'919999999999');
  assert.throws(()=>whatsappAdPayload({...input,ageMin:15},{currency:'INR',page_id:'777'},'919999999999'));
  assert.throws(()=>whatsappAdPayload({...input,dailyBudget:'-5'},{currency:'INR',page_id:'777'},'919999999999'));
});
const order={id:'order_local',catalog_id:'123',currency:'INR',customer_phone:'919999999999',total_amount:'50.000000',items:[{retailerId:'sku',quantity:2,price:'25.00'}]};
test('native Razorpay checkout uses saved exact item amounts and linked configuration',()=>{
  const wire=nativeOrderPayload(order,'merchant-config','Your requested invoice',{sku:'Actual product'},'digital-goods',undefined,'np_reference');
  const action=JSON.parse(wire.interactive.action.parameters);
  assert.equal(wire.interactive.type,'order_details');assert.equal(action.payment_settings[0].payment_gateway.type,'razorpay');assert.equal(action.total_amount.value,5000);assert.equal(action.order.subtotal.value,5000);assert.equal(action.payment_settings[0].payment_gateway.razorpay.notes.orderId,order.id);
  assert.throws(()=>nativeOrderPayload({...order,total_amount:'49.99'},'config','Invoice',{sku:'Product'},'digital-goods',undefined,'ref'));
  assert.throws(()=>nativeOrderPayload({...order,currency:'USD'},'config','Invoice',{sku:'Product'},'digital-goods',undefined,'ref'));
});
test('native capture requires matching Meta and Razorpay order identity, amount and receipt',()=>{
  const checkout={id:'np_reference',order_id:order.id,amount_minor:'5000'};
  const payment={reference_id:checkout.id,currency:'INR',amount:{offset:100,value:5000},status:'captured',transactions:[{id:'order_pg',pg_transaction_id:'pay_pg',type:'razorpay',status:'success'}]};
  const providerPayment={id:'pay_pg',order_id:'order_pg',status:'captured',currency:'INR',amount:5000,amount_refunded:0};
  const providerOrder={id:'order_pg',currency:'INR',amount:5000,receipt:checkout.id,notes:{nativeCheckoutId:checkout.id,orderId:order.id}};
  assert.equal(verifiedNativePayment(payment,checkout,providerPayment,providerOrder),'captured');
  for(const value of [{...providerPayment,status:'authorized'},{...providerPayment,amount:4999},{...providerPayment,order_id:'other'}])assert.throws(()=>verifiedNativePayment(payment,checkout,value,providerOrder));
  assert.throws(()=>verifiedNativePayment(payment,checkout,providerPayment,{...providerOrder,receipt:'other'}));
  assert.throws(()=>verifiedNativePayment({...payment,amount:{offset:1,value:5000}},checkout,providerPayment,providerOrder));
  assert.equal(verifiedNativePayment(payment,checkout,{...providerPayment,amount_refunded:100},providerOrder),'refunded');
});
