import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {readJsonBodyLimited} from './security.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {workspaceFeatureFlags} from './feature-controls.js';

export function commerceRuleInput(body){
  const delay=Number(body.delayMinutes);
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||!['whatsapp_order_received','whatsapp_order_fulfillment','whatsapp_payment_captured'].includes(body.eventType)||typeof body.flowId!=='string'||!Number.isSafeInteger(delay)||delay<0||delay>43200||typeof body.unpaidOnly!=='boolean')throw new AppError('Enter a rule name, event, workflow and valid delay.',400,'COMMERCE_RULE_INVALID');
  if(body.unpaidOnly&&(body.eventType!=='whatsapp_order_received'||delay<1))throw new AppError('Payment reminders need an order-received event and a delay.',400,'COMMERCE_RULE_INVALID');
  if(body.eventType==='whatsapp_order_fulfillment'&&!['processing','shipped','completed','cancelled'].includes(body.fulfillmentStatus))throw new AppError('Select a fulfillment status.',400,'COMMERCE_RULE_INVALID');
  return {name:body.name.trim(),eventType:body.eventType,flowId:body.flowId,delay,unpaidOnly:body.unpaidOnly,fulfillmentStatus:body.eventType==='whatsapp_order_fulfillment'?body.fulfillmentStatus:''};
}
async function utilityWorkflow(businessId,flowId,execute=query){
  const flow=(await execute("SELECT * FROM automation_flows WHERE business_id=$1 AND id=$2 AND status='active' AND trigger_mode='manual'",[businessId,flowId])).rows[0];
  const nodes=flow?.definition?.nodes;
  if(!Array.isArray(nodes)||!nodes.length||nodes.some(node=>!['template','end'].includes(node.type)))throw new AppError('Use an active manual workflow containing utility templates and completion nodes only.',400,'COMMERCE_FLOW_INVALID');
  const visited=new Set();let next=flow.definition.startNodeId,templates=0;
  while(next){
    const node=nodes.find(item=>item.id===next);
    if(!node||visited.has(next)||(node.type==='template'&&(node.inputKind!=='none'||!node.next))||(node.type==='end'&&(node.body||node.next)))throw new AppError('Commerce workflows must be a non-repeating sequence of no-input templates ending in an empty completion node.',400,'COMMERCE_FLOW_INVALID');
    if(node.type==='template')templates++;
    visited.add(next);next=node.next||'';
  }
  if(!templates)throw new AppError('Commerce workflows need at least one approved utility message.',400,'COMMERCE_FLOW_INVALID');
  for(const node of nodes.filter(node=>node.type==='template')){
    const template=(await execute("SELECT id FROM templates WHERE business_id=$1 AND status='Approved' AND category='UTILITY' AND ((id=$2 AND $2<>'') OR (meta_template_name=$3 AND $2=''))",[businessId,node.templateId||'',node.templateName||''])).rows[0];
    if(!template)throw new AppError('Every commerce message must use an approved utility template.',400,'COMMERCE_FLOW_INVALID');
  }
  return flow;
}
export async function commerceAutomationSettings(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    if(request.method==='GET')return json({rules:(await query('SELECT * FROM commerce_automation_rules WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[session.businessId])).rows,flows:(await query("SELECT id,name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name",[session.businessId])).rows,tasks:(await query('SELECT id,order_id,status,error_code,run_at,session_id FROM commerce_automation_tasks WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50',[session.businessId])).rows});
    if(session.role!=='Owner')throw new AppError('Only the owner can enable automatic commerce messaging.',403,'FORBIDDEN');
    const body=await readJsonBodyLimited(request,8192);
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if(body.action==='create'){
      const value=commerceRuleInput(body);await utilityWorkflow(session.businessId,value.flowId);
      await query('INSERT INTO commerce_automation_rules (id,business_id,name,flow_id,event_type,fulfillment_status,unpaid_only,delay_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[id('car'),session.businessId,value.name,value.flowId,value.eventType,value.fulfillmentStatus,value.unpaidOnly,value.delay]);
    }else if(body.action==='toggle'){
      if(typeof body.enabled!=='boolean')throw new AppError('Specify enabled or disabled.',400,'COMMERCE_RULE_INVALID');
      const result=await query('UPDATE commerce_automation_rules SET enabled=$1 WHERE id=$2 AND business_id=$3 RETURNING id',[body.enabled,body.id,session.businessId]);
      if(!result.rowCount)throw new AppError('Rule not found.',404,'NOT_FOUND');
    }else throw new AppError('Unsupported rule action.',400,'INVALID_ACTION');
    await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'commerce_automation_'+body.action,JSON.stringify({ruleId:body.id||'',flowId:body.flowId||''})]);
    return json({ok:true});
  }catch(error){return errorJson(error);}
}
export async function runCommerceAutomation({limit=20}={}){
  const result={started:0,skipped:0,failed:0};
  for(let index=0;index<Math.min(50,Math.max(1,Number(limit)||20));index++){
    const outcome=await transaction(async client=>{
      const task=(await client.query("SELECT t.* FROM commerce_automation_tasks t WHERE t.status='queued' AND t.run_at<=NOW() ORDER BY t.run_at,t.id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if(!task)return null;
      const features=await workspaceFeatureFlags(task.business_id,(sql,params)=>client.query(sql,params));
      if(!features.commerce||!features.automation){
        await client.query("UPDATE commerce_automation_tasks SET status='skipped',error_code='FEATURE_DISABLED' WHERE id=$1 AND business_id=$2",[task.id,task.business_id]);
        return 'skipped';
      }
      let status='skipped',code='',sessionId=null;
      try{
        const rule=(await client.query('SELECT * FROM commerce_automation_rules WHERE id=$1 AND business_id=$2',[task.rule_id,task.business_id])).rows[0];
        const order=(await client.query('SELECT o.*,p.phone_number_id FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id WHERE o.id=$1 AND o.business_id=$2 FOR SHARE OF o',[task.order_id,task.business_id])).rows[0];
        if(!rule?.enabled||!order||(order.fulfillment_status==='cancelled'&&rule.fulfillment_status!=='cancelled')||(rule.unpaid_only&&['captured','partially_refunded','refunded'].includes(order.payment_status))||(rule.fulfillment_status&&rule.fulfillment_status!==order.fulfillment_status))code='RULE_NO_LONGER_APPLICABLE';
        else{
          const business=(await client.query("SELECT id FROM businesses WHERE id=$1 AND account_status<>'suspended' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests WHERE business_id=$1 AND status IN ('scheduled','pending_approval'))",[task.business_id])).rows[0];
          if(!business)throw new AppError('Workspace unavailable.',409,'WORKSPACE_UNAVAILABLE');
          await assertSubscriptionActive(await subscriptionUsage(task.business_id,client));
          const flow=await utilityWorkflow(task.business_id,rule.flow_id,(sql,params)=>client.query(sql,params));
          const contact=(await client.query("SELECT ct.id FROM contacts ct JOIN conversations cv ON cv.contact_id=ct.id AND cv.business_id=ct.business_id WHERE ct.business_id=$1 AND REGEXP_REPLACE(ct.phone,'[^0-9]','','g')=$2 AND ct.unsubscribed=FALSE AND cv.automation_paused=FALSE AND cv.whatsapp_phone_number_id=$3 FOR UPDATE OF ct",[task.business_id,order.customer_phone,order.phone_number_id])).rows[0];
          if(!contact)code='CONTACT_UNAVAILABLE';
          else if((await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status IN ('active','handoff')",[task.business_id,contact.id])).rowCount){
            if(Date.now()-new Date(task.created_at).getTime()<86400000){await client.query("UPDATE commerce_automation_tasks SET run_at=NOW()+INTERVAL '5 minutes',error_code='WORKFLOW_ACTIVE' WHERE id=$1",[task.id]);return 'deferred';}
            code='WORKFLOW_ACTIVE';
          }else{
            sessionId=id('fs');const context={orderId:order.id,orderAmount:String(order.total_amount),orderCurrency:order.currency,fulfillmentStatus:order.fulfillment_status,paymentStatus:order.payment_status,commerceOrderId:order.id,commerceUnpaidOnly:rule.unpaid_only,commerceFulfillmentStatus:rule.fulfillment_status};
            await client.query('INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id,context) VALUES ($1,$2,$3,$4,$5,$6)',[sessionId,task.business_id,contact.id,flow.id,flow.definition.startNodeId,JSON.stringify(context)]);
            await client.query('INSERT INTO automation_jobs (id,business_id,session_id,input) VALUES ($1,$2,$3,$4)',[id('aj'),task.business_id,sessionId,JSON.stringify({phase:'start'})]);status='started';
          }
        }
      }catch(error){status='failed';code=error.code||'COMMERCE_AUTOMATION_FAILED';}
      await client.query('UPDATE commerce_automation_tasks SET status=$1,error_code=$2,session_id=$3 WHERE id=$4',[status,code,sessionId,task.id]);
      return status;
    });
    if(!outcome)break;if(result[outcome]!==undefined)result[outcome]++;
  }
  return result;
}
