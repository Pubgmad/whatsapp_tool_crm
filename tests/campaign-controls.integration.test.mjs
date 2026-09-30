import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,transaction,enterSystemContext} from '../lib/db.js';
import {campaignControlAction,campaignPolicyEndpoint,campaignPolicyForBusiness,reserveCampaignDelivery,releaseCampaignDelivery} from '../lib/campaign-controls.js';
import {createSessionToken} from '../lib/auth.js';
import {createCsrfToken} from '../lib/security.js';
import {campaignDispatchState,updateCampaignCompletion} from '../lib/campaign-queue-safety.js';

test('duplicated campaigns stay unsent until owner approval and recheck current consent',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='controls_b_'+suffix,other='controls_o_'+suffix,user='controls_u_'+suffix,template='controls_t_'+suffix,campaign='controls_k_'+suffix,contact='controls_c_'+suffix,blocked='controls_x_'+suffix;
  const session={businessId:business,userId:user,role:'Manager'};
  try {
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE),($2,$2,$2,TRUE)',[business,other]);
    await query("INSERT INTO users (id,name,email,password_hash) VALUES ($1,$1,$2,'test-unused')",[user,user+'@example.test']);
    await query("INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed) VALUES ($1,$2,'Allowed','15550001111',TRUE,FALSE),($3,$2,'Blocked','15550002222',FALSE,TRUE)",[contact,business,blocked]);
    await query("INSERT INTO templates (id,business_id,name,body,status,category) VALUES ($1,$2,'Controls','Hello','Approved','MARKETING')",[template,business]);
    await query("INSERT INTO campaigns (id,business_id,name,template_id,status) VALUES ($1,$2,'Original',$3,'completed')",[campaign,business,template]);
    await query("INSERT INTO campaign_recipients (id,campaign_id,contact_id,message) VALUES ($1,$2,$3,'Hello'),($4,$2,$5,'Hello')",['r_'+suffix,campaign,contact,'rx_'+suffix,blocked]);
    await assert.rejects(campaignControlAction({...session,businessId:other},campaign,{action:'duplicate',name:'Copy'}),{code:'CAMPAIGN_NOT_FOUND'});
    await assert.rejects(campaignControlAction({...session,role:'Agent'},campaign,{action:'duplicate',name:'Copy'}),{code:'CAMPAIGN_MANAGEMENT_FORBIDDEN'});
    const copy=(await campaignControlAction(session,campaign,{action:'duplicate',name:'Reviewed campaign'})).campaignId;
    assert.equal((await query('SELECT status FROM campaigns WHERE id=$1',[copy])).rows[0].status,'draft');
    assert.equal((await query('SELECT 1 FROM campaign_recipients WHERE campaign_id=$1',[copy])).rowCount,1);
    assert.equal((await query('SELECT 1 FROM campaign_jobs j JOIN campaign_recipients r ON r.id=j.campaign_recipient_id WHERE r.campaign_id=$1',[copy])).rowCount,0);
    await campaignControlAction(session,copy,{action:'submit',frequencyHours:48});
    await updateCampaignCompletion({query},copy,business);
    assert.equal((await query('SELECT status FROM campaigns WHERE id=$1',[copy])).rows[0].status,'pending_approval');
    await assert.rejects(campaignControlAction(session,copy,{action:'approve'}),{code:'CAMPAIGN_REVIEW_FORBIDDEN'});
    await query('UPDATE contacts SET unsubscribed=TRUE WHERE id=$1',[contact]);
    await assert.rejects(campaignControlAction({...session,role:'Owner'},copy,{action:'approve'}),{code:'CAMPAIGN_AUDIENCE_EMPTY'});
    await query('UPDATE contacts SET unsubscribed=FALSE WHERE id=$1',[contact]);
    await campaignControlAction({...session,role:'Owner'},copy,{action:'approve'});
    assert.equal((await query('SELECT approval_status,frequency_hours FROM campaigns WHERE id=$1',[copy])).rows[0].approval_status,'approved');
    assert.equal((await query('SELECT 1 FROM campaign_jobs j JOIN campaign_recipients r ON r.id=j.campaign_recipient_id WHERE r.campaign_id=$1',[copy])).rowCount,1);
    assert.equal(await campaignDispatchState({campaignId:copy,businessId:business,contactId:contact}),'ready');
    await assert.rejects(campaignControlAction({...session,role:'Owner'},copy,{action:'approve'}),{code:'CAMPAIGN_NOT_PENDING'});
  } finally {enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);await query('DELETE FROM users WHERE id=$1',[user]);}
});

test('marketing reservations serialize workers, preserve frequency windows and enforce tenant ownership',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='freq_b_'+suffix,other='freq_o_'+suffix,contact='freq_c_'+suffix,template='freq_t_'+suffix,campaign='freq_k_'+suffix;
  const job={business_id:business,contact_id:contact,campaign_id:campaign,template_category:'MARKETING',frequency_hours:24};
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[business,other]);
    await query("INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed) VALUES ($1,$2,'Allowed','15550001111',TRUE,FALSE)",[contact,business]);
    await query("INSERT INTO templates (id,business_id,name,body,status,category) VALUES ($1,$2,'Frequency','Hello','Approved','MARKETING')",[template,business]);
    await query("INSERT INTO campaigns (id,business_id,name,template_id) VALUES ($1,$2,'Frequency',$3)",[campaign,business,template]);
    const claims=await Promise.all([reserveCampaignDelivery(job),reserveCampaignDelivery(job)]);
    assert.equal(claims.filter(value=>value===null).length,1);
    assert.ok(new Date(claims.find(Boolean)).getTime()>Date.now()+23*3600000);
    await releaseCampaignDelivery(job);
    assert.ok(await reserveCampaignDelivery(job));
    await query('INSERT INTO campaign_policies (business_id,min_marketing_interval_hours) VALUES ($1,48)',[business]);
    assert.equal((await campaignPolicyForBusiness(business)).minMarketingIntervalHours,48);
    assert.ok(new Date(await reserveCampaignDelivery({...job,frequency_hours:0})).getTime()>Date.now()+47*3600000);
    await assert.rejects(query('INSERT INTO campaign_delivery_reservations (business_id,contact_id,campaign_id,reserved_until) VALUES ($1,$2,$3,NOW())',[other,contact,campaign]),{code:'23503'});
    await assert.rejects(transaction(async client=>{
      const role='test_campaign_rls_'+suffix;
      await client.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT ON campaign_delivery_reservations TO ${role}`);
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query("SELECT set_config('app.business_id',$1,true),set_config('app.system_access','false',true)",[other]);
      assert.equal((await client.query('SELECT * FROM campaign_delivery_reservations')).rowCount,0);
      await client.query("SELECT set_config('app.business_id',$1,true)",[business]);
      assert.equal((await client.query('SELECT * FROM campaign_delivery_reservations')).rowCount,1);
      const rollback=new Error('Roll back the disposable test role');rollback.code='TEST_ROLLBACK';throw rollback;
    }),{code:'TEST_ROLLBACK'});
    await query('UPDATE contacts SET unsubscribed=TRUE WHERE id=$1',[contact]);
    await assert.rejects(reserveCampaignDelivery(job),{code:'RECIPIENT_OPTED_OUT'});
    assert.equal(await reserveCampaignDelivery({...job,template_category:'UTILITY'}),null);
  } finally {enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});

test('campaign policies are owner-only, CSRF-protected and ignore caller-supplied tenant IDs',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const previousAuth=process.env.AUTH_SECRET,previousCsrf=process.env.CSRF_SECRET;
  process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');process.env.CSRF_SECRET=crypto.randomBytes(32).toString('hex');
  const suffix=crypto.randomBytes(8).toString('hex'),business='policy_b_'+suffix,other='policy_o_'+suffix,user='policy_u_'+suffix;
  const base=process.env.APP_URL||'https://example.test';
  const csrf=createCsrfToken(),token=createSessionToken({userId:user,businessId:business,role:'Owner',sessionVersion:0});
  const request=(method='PUT',body={},withCsrf=true)=>new Request(new URL('/api/campaigns/policy',base),{method,headers:{cookie:'wcrm_session='+encodeURIComponent(token)+'; wcrm_csrf='+encodeURIComponent(csrf),origin:new URL(base).origin,...(withCsrf?{'x-csrf-token':csrf}:{}),'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[business,other]);
    await query("INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$1,$2,'test-unused',NOW())",[user,user+'@example.test']);
    await query("INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Manager')",['policy_m_'+suffix,user,business]);
    assert.equal((await campaignPolicyEndpoint(request('PUT',{approvalRequired:true,minMarketingIntervalHours:24}))).status,403);
    enterSystemContext();await query("UPDATE memberships SET role='Owner' WHERE business_id=$1 AND user_id=$2",[business,user]);
    assert.equal((await campaignPolicyEndpoint(request('PUT',{approvalRequired:true,minMarketingIntervalHours:24},false))).status,403);
    const saved=await campaignPolicyEndpoint(request('PUT',{businessId:other,approvalRequired:true,minMarketingIntervalHours:24}));
    assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{approvalRequired:true,minMarketingIntervalHours:24});
    enterSystemContext();assert.deepEqual(await campaignPolicyForBusiness(other),{approvalRequired:false,minMarketingIntervalHours:0});
    assert.equal((await campaignPolicyEndpoint(request('PUT',{approvalRequired:'true',minMarketingIntervalHours:24}))).status,400);
    assert.equal((await campaignPolicyEndpoint(request('PUT',{approvalRequired:true,minMarketingIntervalHours:-1}))).status,400);
  }finally{
    enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);await query('DELETE FROM users WHERE id=$1',[user]);
    if(previousAuth===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=previousAuth;
    if(previousCsrf===undefined)delete process.env.CSRF_SECRET;else process.env.CSRF_SECRET=previousCsrf;
  }
});
