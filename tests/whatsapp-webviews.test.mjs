import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWebview} from '../lib/whatsapp-webviews.js';

const valid={title:'Order help',description:'Get help with your order.',buttonLabel:'Chat with our team',prefilledMessage:'I need help with my order',phoneId:'wap_1234567890abcdef',enabled:false};

test('hosted page accepts owner-authored plain text and registered phone ID shape',()=>{
  assert.deepEqual(validateWebview(valid),{
    ...valid,
    pageMode:'cta',
    formSchema:[],
    successMessage:'Thanks — we received your details.',
    automationFlowId:null
  });
  assert.equal(validateWebview({...valid,description:'Line one\nLine two'}).description,'Line one\nLine two');
});

test('hosted page rejects malformed content and asset IDs',()=>{
  assert.throws(()=>validateWebview({...valid,phoneId:'1234567890'}),{code:'WEBVIEW_INVALID'});
  assert.throws(()=>validateWebview({...valid,buttonLabel:' '}),{code:'WEBVIEW_INVALID'});
  assert.throws(()=>validateWebview({...valid,enabled:'yes'}),{code:'WEBVIEW_INVALID'});
  assert.throws(()=>validateWebview({...valid,description:'X'.repeat(2001)}),{code:'WEBVIEW_INVALID'});
});

test('transactional page requires a published Flow identity, short CTA and bounded expiry',()=>{
  const transactional={...valid,flowId:'waf_1234567890abcdef',expiresHours:2,buttonLabel:'Order now'};
  assert.equal(validateWebview(transactional).flowId,transactional.flowId);
  assert.throws(()=>validateWebview({...transactional,flowId:'other'}),{code:'WEBVIEW_INVALID'});
  assert.throws(()=>validateWebview({...transactional,expiresHours:25}),{code:'WEBVIEW_INVALID'});
  assert.throws(()=>validateWebview({...transactional,buttonLabel:'A'.repeat(21)}),{code:'WEBVIEW_INVALID'});
});
