import {AppError,id,json,errorJson,query,transaction} from './db.js';
import {validateSupportPolicy,supportIsOpen} from './support-rules.js';

export async function recordSupportInbound(client,businessId,conversationId,at) {
  await client.query(`INSERT INTO support_waiting(conversation_id,business_id,waiting_since) VALUES($1,$2,LEAST($3::timestamptz,NOW()))
    ON CONFLICT(conversation_id) DO UPDATE SET waiting_since=COALESCE(support_waiting.waiting_since,EXCLUDED.waiting_since),breached_at=CASE WHEN support_waiting.waiting_since IS NULL THEN NULL ELSE support_waiting.breached_at END
    WHERE support_waiting.business_id=EXCLUDED.business_id AND (support_waiting.responded_at IS NULL OR EXCLUDED.waiting_since>support_waiting.responded_at)`,[conversationId,businessId,at]);
}
export async function recordSupportResponse(businessId,conversationId,at=new Date(),client=null) {
  const sql=`UPDATE support_waiting SET waiting_since=CASE WHEN waiting_since<=$3::timestamptz THEN NULL ELSE waiting_since END,breached_at=CASE WHEN waiting_since<=$3::timestamptz THEN NULL ELSE breached_at END,responded_at=GREATEST(responded_at,LEAST($3::timestamptz,NOW())) WHERE conversation_id=$1 AND business_id=$2`;
  if(client)await client.query(sql,[conversationId,businessId,at]);
  else await query(sql,[conversationId,businessId,at]);
}

export async function supportPolicyRequest(request,context,platform=false) {
  try {
    let businessId,actor;
    if (platform) {const {requireSuperAdmin}=await import('./super-admin.js');actor=await requireSuperAdmin(request);businessId=(await context.params).id;}
    else {const {requireSession}=await import('./auth.js');actor=await requireSession(request);businessId=actor.businessId;if(!['Owner','Manager'].includes(actor.role))throw new AppError('Team management access required.',403,'SUPPORT_FORBIDDEN');}
    if(request.method==='POST') {
      if(!platform&&actor.role!=='Owner')throw new AppError('Only the company Owner can change support policy.',403,'SUPPORT_FORBIDDEN');
      const {readJsonBodyLimited}=await import('./security.js');
      const body=await readJsonBodyLimited(request,32768),policy=validateSupportPolicy(body.policy);
      if(!Number.isInteger(body.revision)||body.revision<0)throw new AppError('Reload the support policy.',409,'REVISION_CONFLICT');
      await transaction(async client=>{
        const company=await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
        if(!company.rows.length)throw new AppError('Company not found.',404,'NOT_FOUND');
        const current=await client.query('SELECT revision FROM support_policies WHERE business_id=$1',[businessId]);
        if((current.rows[0]?.revision||0)!==body.revision)throw new AppError('Policy changed. Reload before saving.',409,'REVISION_CONFLICT');
        const members=await client.query('SELECT user_id,role FROM memberships WHERE business_id=$1',[businessId]);
        if(policy.agentIds.some(id=>!members.rows.some(member=>member.user_id===id))||policy.escalationUserId&&!members.rows.some(member=>member.user_id===policy.escalationUserId&&['Owner','Manager'].includes(member.role)))throw new AppError('Choose current company members and a manager for escalation.',400,'VALIDATION_ERROR');
        await client.query(`INSERT INTO support_policies(business_id,config) VALUES($1,$2) ON CONFLICT(business_id) DO UPDATE SET config=EXCLUDED.config,revision=support_policies.revision+1,updated_at=NOW()`,[businessId,JSON.stringify(policy)]);
        await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('audit'),businessId,platform?null:actor.userId,'support_policy_updated',JSON.stringify({revision:body.revision+1,...(platform?{superAdminId:actor.id}:{})})]);
      });
    }
    const result=await query('SELECT config,revision FROM support_policies WHERE business_id=$1',[businessId]);
    const members=await query('SELECT m.user_id AS id,m.role,m.availability,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 ORDER BY u.name',[businessId]);
    const waiting=await query(`SELECT w.conversation_id,w.waiting_since,w.breached_at,c.assigned_user_id,t.name AS contact_name FROM support_waiting w JOIN conversations c ON c.id=w.conversation_id AND c.business_id=w.business_id JOIN contacts t ON t.id=c.contact_id WHERE w.business_id=$1 AND w.waiting_since IS NOT NULL AND c.status='open' ORDER BY w.waiting_since LIMIT 50`,[businessId]);
    return json({policy:result.rows[0]?.config||null,revision:result.rows[0]?.revision||0,members:members.rows,waiting:waiting.rows});
  } catch(error){return errorJson(error);}
}

export async function runSupportQueue() {
  const policies=await query(`SELECT p.business_id,p.config FROM support_policies p JOIN businesses b ON b.id=p.business_id WHERE b.account_status='active' AND p.config->>'enabled'='true' ORDER BY p.last_checked_at NULLS FIRST,p.business_id LIMIT 100`);
  let assigned=0,breached=0;
  for(const row of policies.rows) {
    const policy=validateSupportPolicy(row.config);
    await query('UPDATE support_policies SET last_checked_at=NOW() WHERE business_id=$1',[row.business_id]);
    if(!supportIsOpen(policy))continue;
    const counts=await transaction(async client=>{
      const company=await client.query('SELECT account_status FROM businesses WHERE id=$1 FOR UPDATE',[row.business_id]);
      if(company.rows[0]?.account_status!=='active')return {assigned:0,breached:0};
      const fresh=await client.query('SELECT config FROM support_policies WHERE business_id=$1',[row.business_id]);
      if(JSON.stringify(fresh.rows[0]?.config)!==JSON.stringify(row.config))return {assigned:0,breached:0};
      const work=await client.query(`SELECT c.id,c.assigned_user_id,w.waiting_since,w.breached_at FROM conversations c JOIN support_waiting w ON w.conversation_id=c.id AND w.business_id=c.business_id WHERE c.business_id=$1 AND c.status='open' AND w.waiting_since IS NOT NULL AND ($2='unassigned' OR c.automation_paused=true) AND ((w.breached_at IS NULL AND w.waiting_since<=NOW()-($4::int*INTERVAL '1 minute')) OR (c.assigned_user_id IS NULL AND $3<>'manual')) ORDER BY w.waiting_since LIMIT 100 FOR UPDATE OF c,w SKIP LOCKED`,[row.business_id,policy.scope,policy.mode,policy.slaMinutes]);
      let routed=0,late=0;
      for(const item of work.rows) {
        if(!item.assigned_user_id&&policy.mode!=='manual') {
          const candidates=await client.query(`SELECT m.user_id,(SELECT COUNT(*) FROM conversations c WHERE c.business_id=m.business_id AND c.assigned_user_id=m.user_id AND c.status='open') AS load FROM memberships m WHERE m.business_id=$1 AND m.user_id=ANY($2::text[]) AND m.availability='available' ORDER BY CASE WHEN $3='least_loaded' THEN (SELECT COUNT(*) FROM conversations c WHERE c.business_id=m.business_id AND c.assigned_user_id=m.user_id AND c.status='open') ELSE 0 END,m.support_assigned_at NULLS FIRST,m.user_id FOR UPDATE OF m`,[row.business_id,policy.agentIds,policy.mode]);
          const agent=candidates.rows.find(member=>Number(member.load)<policy.maxOpen);
          if(agent){await client.query('UPDATE conversations SET assigned_user_id=$1,version=version+1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[agent.user_id,item.id,row.business_id]);await client.query('UPDATE memberships SET support_assigned_at=NOW() WHERE business_id=$1 AND user_id=$2',[row.business_id,agent.user_id]);await client.query('INSERT INTO audit_logs(id,business_id,action,metadata) VALUES($1,$2,$3,$4)',[id('audit'),row.business_id,'support_auto_assigned',JSON.stringify({conversationId:item.id,assignedTo:agent.user_id,mode:policy.mode})]);routed++;}
        }
        if(!item.breached_at&&Date.now()-new Date(item.waiting_since).getTime()>=policy.slaMinutes*60000) {
          await client.query('UPDATE support_waiting SET breached_at=NOW() WHERE conversation_id=$1 AND business_id=$2',[item.id,row.business_id]);
          let escalation=null;
          if(policy.escalationUserId){const manager=await client.query("SELECT user_id FROM memberships WHERE business_id=$1 AND user_id=$2 AND role IN ('Owner','Manager') AND availability='available' FOR UPDATE",[row.business_id,policy.escalationUserId]);escalation=manager.rows[0]?.user_id||null;}
          if(escalation)await client.query('UPDATE conversations SET assigned_user_id=$1,automation_paused=true,version=version+1,updated_at=NOW() WHERE id=$2 AND business_id=$3',[escalation,item.id,row.business_id]);
          await client.query('INSERT INTO audit_logs(id,business_id,action,metadata) VALUES($1,$2,$3,$4)',[id('audit'),row.business_id,'support_sla_breached',JSON.stringify({conversationId:item.id,escalatedTo:escalation})]);late++;
        }
      }
      return {assigned:routed,breached:late};
    });
    assigned+=counts.assigned;breached+=counts.breached;
  }
  return {assigned,breached};
}
