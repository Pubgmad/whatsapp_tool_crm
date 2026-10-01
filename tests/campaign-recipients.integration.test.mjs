import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,enterSystemContext} from '../lib/db.js';
import {createSessionToken} from '../lib/auth.js';
import {getCampaignRecipients} from '../lib/campaign-recipients.js';

test('campaign recipients paginate without crossing workspace boundaries',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  const previous=process.env.AUTH_SECRET;
  process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const business='rec_b_'+suffix,other='rec_o_'+suffix,user='rec_u_'+suffix;
  const template='rec_t_'+suffix,campaign='rec_k_'+suffix;
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1),($2,$2,$2)',[business,other]);
    await query("INSERT INTO users(id,name,email,password_hash) VALUES($1,$1,$2,'unused')",[user,user+'@example.test']);
    await query("INSERT INTO memberships(id,user_id,business_id,role) VALUES($1,$2,$3,'Owner'),($4,$2,$5,'Owner')",['mem_'+suffix,user,business,'mem2_'+suffix,other]);
    await query("INSERT INTO templates(id,business_id,name,body,status,category) VALUES($1,$2,'Test','Hello','Approved','UTILITY')",[template,business]);
    await query("INSERT INTO campaigns(id,business_id,name,template_id) VALUES($1,$2,'Test',$3)",[campaign,business,template]);
    for(let index=0;index<55;index++){
      const contact='rec_c_'+index+'_'+suffix;
      await query('INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,$3,$4)',[contact,business,'Contact '+index,'1555'+String(index).padStart(7,'0')]);
      await query("INSERT INTO campaign_recipients(id,campaign_id,contact_id,message) VALUES($1,$2,$3,'Hello')",['rec_r_'+index+'_'+suffix,campaign,contact]);
    }
    const token=createSessionToken({userId:user,businessId:business,role:'Owner',sessionVersion:0});
    const request=page=>new Request('https://crm.example.test/api/campaigns/'+campaign+'/recipients?page='+page,{headers:{cookie:'wcrm_session='+encodeURIComponent(token)}});
    const first=await getCampaignRecipients(request(1),{params:Promise.resolve({id:campaign})});
    assert.equal(first.status,200);
    const a=await first.json();assert.equal(a.pagination.total,55);assert.equal(a.recipients.length,50);
    const second=await getCampaignRecipients(request(2),{params:Promise.resolve({id:campaign})});
    const b=await second.json();assert.equal(b.recipients.length,5);
    assert.equal(new Set([...a.recipients,...b.recipients].map(row=>row.id)).size,55);
    const otherToken=createSessionToken({userId:user,businessId:other,role:'Owner',sessionVersion:0});
    const denied=await getCampaignRecipients(new Request('https://crm.example.test/api/campaigns/'+campaign+'/recipients',{headers:{cookie:'wcrm_session='+encodeURIComponent(otherToken)}}),{params:Promise.resolve({id:campaign})});
    assert.equal(denied.status,404);
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);
    await query('DELETE FROM users WHERE id=$1',[user]);
    if(previous===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=previous;
  }
});
