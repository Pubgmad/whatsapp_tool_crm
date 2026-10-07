import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {enterSystemContext} from '../lib/db.js';
import {brandAssets,changeSiteDraft,getPublishedSite,getSiteDraft,loadBrandAsset,removeBrandAsset,saveBrandAsset} from '../lib/public-site.js';

test('public site requires explicit publish and rejects stale writes',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const initial=await getSiteDraft();
  const document={sections:[{id:'overview',kind:'overview',title:'WhatsApp operations',eyebrow:'Product',visible:true,layout:'plain',align:'left',blocks:[{type:'paragraph',text:'Customer conversations in one workspace.',emphasis:'none'}],ctaLabel:'',ctaHref:''}]};
  const saved=await changeSiteDraft({action:'save',revision:initial.revision,document});
  assert.notDeepEqual((await getPublishedSite()).document,document);
  await assert.rejects(changeSiteDraft({action:'publish',revision:initial.revision}),{code:'SITE_REVISION_CONFLICT'});
  const published=await changeSiteDraft({action:'publish',revision:saved.revision});
  assert.equal(published.publishedRevision,saved.revision);
  assert.deepEqual((await getPublishedSite()).document,document);
});

test('brand images are decoded, re-encoded and versioned',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const image=await sharp({create:{width:48,height:32,channels:3,background:'#126067'}}).png().toBuffer();
  try{
    const asset=await saveBrandAsset('logo',image);
    assert.match(asset.url,/^\/api\/platform\/asset\/logo\?v=[a-f0-9]+$/);
    assert.equal((await brandAssets()).logo.width,48);
    assert.equal((await loadBrandAsset('logo')).media_type,'image/webp');
  }finally{await removeBrandAsset('logo');}
});
