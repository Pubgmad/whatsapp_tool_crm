import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {saveBrandAsset,validateSiteDocument} from '../lib/public-site.js';

const section={id:'about',kind:'about',title:'About the product',eyebrow:'Our team',visible:true,layout:'plain',align:'left',blocks:[{type:'paragraph',text:'Customer support with WhatsApp.',emphasis:'none'}],ctaLabel:'Learn more',ctaHref:'/signup'};

test('public site footer and social links validate',()=>{
  const doc=validateSiteDocument({sections:[section],footerLinks:[{label:'About',href:'/about'}],socialLinks:[{label:'LinkedIn',href:'https://linkedin.com/company/example'}]});
  assert.equal(doc.footerLinks[0].href,'/about');
  assert.equal(doc.socialLinks[0].label,'LinkedIn');
});

test('public site link and image blocks validate',()=>{
  const doc=validateSiteDocument({sections:[{...section,blocks:[{type:'link',label:'Sign up',href:'/signup'},{type:'image',asset:'hero',alt:'Product screenshot'}]}]});
  assert.equal(doc.sections[0].blocks[0].href,'/signup');
  assert.equal(doc.sections[0].blocks[1].asset,'hero');
});

test('public sections remain structured text and reject active links',()=>{
  assert.deepEqual(validateSiteDocument({sections:[section]}).sections[0],section);
  assert.throws(()=>validateSiteDocument({sections:[{...section,ctaHref:'javascript:alert(1)'}]}),{code:'SITE_INVALID'});
  assert.throws(()=>validateSiteDocument({sections:[{...section,ctaHref:'//evil.example'}]}),{code:'SITE_INVALID'});
  assert.throws(()=>validateSiteDocument({sections:[section,{...section}]}),{code:'SITE_INVALID'});
  assert.throws(()=>validateSiteDocument({sections:[{...section,blocks:[{type:'html',text:'<script>bad()</script>'}]}]}),{code:'SITE_INVALID'});
  assert.throws(()=>validateSiteDocument({sections:[{...section,unexpected:'unsafe'}]}),{code:'SITE_INVALID'});
});

test('brand assets reject unsupported and oversized input before storage',async()=>{
  await assert.rejects(saveBrandAsset('logo',Buffer.from('not an image')), {code:'ASSET_INVALID'});
  const rectangle=await sharp({create:{width:32,height:24,channels:3,background:'#ffffff'}}).png().toBuffer();
  await assert.rejects(saveBrandAsset('favicon',rectangle), {code:'ASSET_INVALID'});
  await assert.rejects(saveBrandAsset('logo',Buffer.alloc(5_000_001)), {code:'ASSET_INVALID'});
});
