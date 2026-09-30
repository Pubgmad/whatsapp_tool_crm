import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,transaction,enterSystemContext} from '../lib/db.js';
import {recordSupportInbound,recordSupportResponse,runSupportQueue} from '../lib/support-policy.js';
test('support routing respects availability, capacity, tenant boundaries and real response SLA',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex'),b='support_'+suffix,o='other_'+suffix,u='agent_'+suffix,m='manager_'+suffix,c='contact_'+suffix,v='conversation_'+suffix;
  try {
    await query("INSERT INTO businesses(id,name,slug,account_status) VALUES($1,$1,$1,'active'),($2,$2,$2,'active')",[b,o]);
    await query("INSERT INTO users(id,name,email,password_hash) VALUES($1,$1,$1||'@example.test','unused'),($2,$2,$2||'@example.test','unused')",[u,m]);
    await query("INSERT INTO memberships(id,user_id,business_id,role,availability) VALUES($1||'_membership',$1,$3,'Agent','away'),($2||'_membership',$2,$3,'Manager','available')",[u,m,b]);
    await query("INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,$1,'15550001234')",[c,b]);
    await query("INSERT INTO conversations(id,business_id,contact_id,status,automation_paused) VALUES($1,$2,$3,'open',true)",[v,b,c]);
    const p={enabled:true,mode:'round_robin',scope:'handoff',timezone:'UTC',alwaysOpen:true,agentIds:[u],maxOpen:1,slaMinutes:30,escalationUserId:m,hours:[]};
    await query('INSERT INTO support_policies(business_id,config) VALUES($1,$2)',[b,JSON.stringify(p)]);
    const start=new Date();
    await transaction(client=>recordSupportInbound(client,b,v,start));
    await runSupportQueue();
    assert.equal((await query('SELECT assigned_user_id FROM conversations WHERE id=$1',[v])).rows[0].assigned_user_id,null);
    await query("UPDATE memberships SET availability='available' WHERE business_id=$1 AND user_id=$2",[b,u]);
    assert.equal((await runSupportQueue()).assigned,1);
    assert.equal((await query('SELECT assigned_user_id FROM conversations WHERE id=$1',[v])).rows[0].assigned_user_id,u);
    await transaction(client=>recordSupportInbound(client,b,v,new Date(start.getTime()+1000)));
    assert.equal(new Date((await query('SELECT waiting_since FROM support_waiting WHERE conversation_id=$1',[v])).rows[0].waiting_since).getTime(),start.getTime());
    await assert.rejects(query('UPDATE support_waiting SET business_id=$1 WHERE conversation_id=$2',[o,v]),{code:'23503'});
    await query("UPDATE support_waiting SET waiting_since=NOW()-INTERVAL '31 minutes' WHERE conversation_id=$1",[v]);
    assert.equal((await runSupportQueue()).breached,1);
    assert.equal((await runSupportQueue()).breached,0);
    assert.equal((await query('SELECT assigned_user_id FROM conversations WHERE id=$1',[v])).rows[0].assigned_user_id,m);
    await recordSupportResponse(b,v);
    assert.equal((await query('SELECT waiting_since FROM support_waiting WHERE conversation_id=$1',[v])).rows[0].waiting_since,null);
    await transaction(client=>recordSupportInbound(client,b,v,start));
    assert.equal((await query('SELECT waiting_since FROM support_waiting WHERE conversation_id=$1',[v])).rows[0].waiting_since,null);
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN($1,$2)',[b,o]);await query('DELETE FROM users WHERE id IN($1,$2)',[u,m]);}
});
