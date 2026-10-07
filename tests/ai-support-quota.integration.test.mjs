import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {enterSystemContext,query} from '../lib/db.js';
import {aiDailyUsage,reserveAiDailyRequest} from '../lib/ai-support.js';

test('AI quota is atomic under concurrent requests and isolated by tenant',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const businesses=['aiq_a_'+suffix,'aiq_b_'+suffix];
  const prior=(await query("SELECT value FROM platform_settings WHERE key='ai_daily_request_limit'")).rows[0]?.value;
  try{
    for(const business of businesses)await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1)',[business]);
    await query("UPDATE platform_settings SET value='2'::jsonb WHERE key='ai_daily_request_limit'");
    const results=await Promise.allSettled(Array.from({length:4},()=>reserveAiDailyRequest(businesses[0])));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,2);
    assert.ok(results.filter(result=>result.status==='rejected').every(result=>result.reason.code==='AI_LIMIT_REACHED'));
    assert.deepEqual(await aiDailyUsage(businesses[0]),{limit:2,requests:2});
    assert.deepEqual(await aiDailyUsage(businesses[1]),{limit:2,requests:0});
    assert.deepEqual(await reserveAiDailyRequest(businesses[1]),{limit:2,requests:1});
  }finally{
    await query('UPDATE platform_settings SET value=$1 WHERE key=$2',[JSON.stringify(prior),'ai_daily_request_limit']);
    for(const business of businesses)await query('DELETE FROM businesses WHERE id=$1',[business]);
  }
});
