import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptSecret,listWhatsAppTemplates} from '../lib/meta.js';

test('template sync follows Meta pages without forwarding a URL token', async () => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'test-template-pagination-key';
  try {
    const setup = {waba_id:'123',access_token_encrypted:encryptSecret('header-token')};
    const calls=[];
    const fetcher=async (url,options)=>{
      calls.push(url.href);
      assert.equal(options.headers.Authorization,'Bearer header-token');
      return Response.json(calls.length===1
        ? {data:[{id:'one'}],paging:{next:`${url.origin}${url.pathname}?after=cursor&access_token=unsafe-url-token`}}
        : {data:[{id:'two'}]});
    };
    assert.deepEqual((await listWhatsAppTemplates({setup,fetcher})).map(item=>item.id),['one','two']);
    assert.equal(calls.length,2);
    assert.ok(!calls[1].includes('access_token'));
  } finally {
    if(previous===undefined)delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY=previous;
  }
});

test('template sync rejects a cross-origin paging link', async () => {
  const previous = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'test-template-pagination-key';
  try {
    const setup = {waba_id:'123',access_token_encrypted:encryptSecret('header-token')};
    await assert.rejects(listWhatsAppTemplates({setup,fetcher:async()=>Response.json({data:[],paging:{next:'https://invalid.example/templates'}})}),
      {code:'META_TEMPLATE_PAGING_INVALID'});
  } finally {
    if(previous===undefined)delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY=previous;
  }
});
