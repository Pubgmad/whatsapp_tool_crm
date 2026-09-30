import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,enterSystemContext} from '../lib/db.js';
import {serveWidget} from '../lib/whatsapp-widget.js';
test('public widgets disappear when disabled, suspended, disconnected or moved across tenants',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex'),b='widget_b_'+suffix,o='widget_o_'+suffix,a='widget_a_'+suffix,p='widget_p_'+suffix,w='widget_'+suffix;
  const response=()=>serveWidget(new Request('https://crm.example.test/api/public/whatsapp-widget/'+w,{headers:{'x-real-ip':'203.0.113.4'}}),{params:Promise.resolve({id:w})});
  try {
    await query('INSERT INTO businesses(id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[b,o]);
    await query("INSERT INTO whatsapp_accounts(id,business_id,waba_id,status) VALUES ($1,$2,$1,'connected')",[a,b]);
    await query("INSERT INTO whatsapp_phone_numbers(id,business_id,whatsapp_account_id,phone_number_id,display_phone_number,registration_state) VALUES ($1,$2,$3,$1,'15550001111','registered')",[p,b,a]);
    await query("INSERT INTO whatsapp_website_widgets(id,business_id,phone_id,label,allowed_origins,color,position,enabled) VALUES ($1,$2,$3,'Sales','[\"https://shop.example.test\"]','#ffffff','left',TRUE)",[w,b,p]);
    assert.equal((await response()).status,404);
    await query("UPDATE businesses SET account_status='active' WHERE id=$1",[b]);
    assert.equal((await response()).status,200);
    await query('UPDATE whatsapp_website_widgets SET enabled=FALSE WHERE id=$1',[w]);assert.equal((await response()).status,404);
    await query('UPDATE whatsapp_website_widgets SET enabled=TRUE WHERE id=$1',[w]);
    await query("UPDATE businesses SET account_status='suspended' WHERE id=$1",[b]);assert.equal((await response()).status,404);
    await query("UPDATE businesses SET account_status='active' WHERE id=$1",[b]);
    await query("UPDATE whatsapp_accounts SET status='disconnected' WHERE id=$1",[a]);assert.equal((await response()).status,404);
    await assert.rejects(query('UPDATE whatsapp_website_widgets SET business_id=$1 WHERE id=$2',[o,w]),{code:'23503'});
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[b,o]);}
});
