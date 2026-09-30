import { AppError, errorJson, json, query, transaction, id } from "./db.js";
import { readJsonBodyLimited, readTextBodyLimited } from "./security.js";

export function creditAttachPayload(wabaId, currency, confirmation) {
  if (!/^\d{1,32}$/.test(String(wabaId)) || !/^[A-Z]{3}$/.test(String(currency))) throw new AppError('Meta did not return valid WhatsApp billing assets.',409,'META_CREDIT_ASSETS_INVALID');
  if (confirmation !== wabaId) throw new AppError('Confirm the WhatsApp account ID before accepting billing liability.',400,'META_CREDIT_CONFIRMATION_REQUIRED');
  return {waba_id:wabaId,waba_currency:currency};
}

async function creditRequest(path, body) {
  const response=await fetch('https://graph.facebook.com/'+(process.env.META_GRAPH_API_VERSION || 'v26.0')+'/'+path,{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.META_SYSTEM_USER_ACCESS_TOKEN,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)
  });
  const payload=JSON.parse(await readTextBodyLimited(response,2_000_000));
  return {ok:response.ok,status:response.status,payload};
}

export function creditLinesPath(businessId) {
  if (!/^\d+$/.test(String(businessId))) {
    throw new AppError("Configure a valid Meta Business Portfolio ID.", 503, "META_BUSINESS_ID_REQUIRED");
  }
  return `${businessId}/extendedcredits?fields=id%2Clegal_entity_name`;
}

export async function getMetaCreditLines(request) {
  try {
    const { requireSuperAdmin } = await import("./super-admin.js");
    await requireSuperAdmin(request);
    const businessId = process.env.META_BUSINESS_PORTFOLIO_ID;
    const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN;
    if (!businessId || !token) {
      return json({ configured: false, creditLines: [] });
    }
    const result = await creditRequest(creditLinesPath(businessId));
    const payload = result.payload;
    if (!result.ok) throw new AppError("Meta credit-line status is unavailable. Check platform billing permissions.",502,"META_CREDIT_LINES_FAILED");
    await query("UPDATE meta_credit_operations SET status='unconfirmed',error_code='META_DELIVERY_UNCONFIRMED',updated_at=NOW() WHERE status='processing' AND updated_at < NOW()-INTERVAL '2 minutes'");
    return json({
      configured: true,
      sharingEnabled: process.env.META_CREDIT_SHARING_ENABLED === 'true',
      accounts: (await query("SELECT a.id,a.waba_id,b.name AS company_name FROM whatsapp_accounts a JOIN businesses b ON b.id=a.business_id WHERE a.status='connected' ORDER BY b.name,a.id LIMIT 100")).rows,
      operations: (await query('SELECT id,waba_id,credit_line_id,currency,status,allocation_id,error_code,reconciliation,reconciled_at,created_at FROM meta_credit_operations ORDER BY created_at DESC LIMIT 50')).rows,
      creditLines: (Array.isArray(payload.data) ? payload.data : [])
        .filter((item) => /^\d+$/.test(String(item.id)))
        .map((item) => ({ id: String(item.id), legalEntityName: String(item.legal_entity_name || "") }))
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function shareMetaCreditLine(request) {
  try {
    const {requireSuperAdmin}=await import('./super-admin.js');
    const admin=await requireSuperAdmin(request);
    if (!process.env.META_SYSTEM_USER_ACCESS_TOKEN) throw new AppError('Configure the platform system-user token.',503,'META_TOKEN_REQUIRED');
    const portfolio=process.env.META_BUSINESS_PORTFOLIO_ID;
    creditLinesPath(portfolio);
    const body=await readJsonBodyLimited(request,8192);
    if(body.action==='reconcile'){
      const operation=(await query('SELECT * FROM meta_credit_operations WHERE id=$1',[String(body.operationId||'')])).rows[0];
      if(!operation)throw new AppError('Credit operation not found.',404,'NOT_FOUND');
      const line=await creditRequest(operation.credit_line_id+'?fields=id,owner_business,is_access_revoked,balance,credit_available,allocated_amount');
      if(!line.ok||String(line.payload.owner_business?.id)!==portfolio||line.payload.is_access_revoked)throw new AppError('Platform credit ownership could not be verified.',403,'META_CREDIT_ACCESS_DENIED');
      const allocationId=operation.allocation_id||String(body.allocationId||'');
      if(!/^\d{1,32}$/.test(allocationId))throw new AppError('Provide the allocation ID from Meta to reconcile an uncertain operation.',409,'META_ALLOCATION_REQUIRED');
      const allocation=await creditRequest(allocationId+'?fields=id,owning_credential,receiving_credential,request_status,currency_amount,receiving_business');
      if(!allocation.ok||String(allocation.payload.id)!==allocationId||String(allocation.payload.owning_credential?.id||allocation.payload.owning_credential)!==operation.credit_line_id)throw new AppError('Allocation does not belong to this credit line.',409,'META_ALLOCATION_MISMATCH');
      if(!operation.allocation_id&&String(allocation.payload.receiving_credential?.id||allocation.payload.receiving_credential)!==operation.waba_id)throw new AppError('Meta did not establish an exact WABA allocation match. Do not replay this financial operation.',409,'META_ALLOCATION_MISMATCH');
      const snapshot={allocation:allocation.payload,credit:{id:line.payload.id,balance:line.payload.balance,credit_available:line.payload.credit_available,allocated_amount:line.payload.allocated_amount}};
      await transaction(async client=>{
        const locked=(await client.query('SELECT allocation_id FROM meta_credit_operations WHERE id=$1 FOR UPDATE',[operation.id])).rows[0];
        if(locked.allocation_id&&locked.allocation_id!==allocationId)throw new AppError('Allocation changed during reconciliation.',409,'META_ALLOCATION_MISMATCH');
        await client.query('UPDATE meta_credit_operations SET allocation_id=$1,reconciliation=$2,reconciled_at=NOW(),updated_at=NOW() WHERE id=$3',[allocationId,JSON.stringify(snapshot),operation.id]);
        await client.query('INSERT INTO platform_audit_logs (id,super_admin_id,action,metadata) VALUES ($1,$2,$3,$4)',[id('pa'),admin.id,'meta_credit_reconciled',JSON.stringify({operationId:operation.id,allocationId})]);
      });
      return json({status:operation.status,snapshot});
    }
    if (process.env.META_CREDIT_SHARING_ENABLED !== 'true') throw new AppError('Credit sharing has not been enabled for this platform.',403,'META_CREDIT_SHARING_DISABLED');
    if (!/^\d{1,32}$/.test(String(body.creditLineId || ''))) throw new AppError('Choose a valid platform credit line.',400,'META_CREDIT_ASSETS_INVALID');
    const account=(await query("SELECT id,business_id,waba_id FROM whatsapp_accounts WHERE id=$1 AND status='connected'",[String(body.accountId || '')])).rows[0];
    if (!account) throw new AppError('Connected WhatsApp account not found.',404,'NOT_FOUND');
    const line=await creditRequest(body.creditLineId+'?fields=id,owner_business,is_access_revoked');
    if (!line.ok || String(line.payload.id)!==body.creditLineId || String(line.payload.owner_business?.id)!==portfolio || line.payload.is_access_revoked) throw new AppError('This is not an available credit line owned by the platform.',403,'META_CREDIT_ACCESS_DENIED');
    const waba=await creditRequest(account.waba_id+'?fields=id,currency');
    if (!waba.ok || String(waba.payload.id)!==account.waba_id) throw new AppError('Meta could not verify access to this WhatsApp account.',403,'META_CREDIT_ACCESS_DENIED');
    const payload=creditAttachPayload(account.waba_id,waba.payload.currency,body.confirmation);
    let operationId=id('mco');
    const created=await transaction(async client=>{
      const inserted=await client.query("INSERT INTO meta_credit_operations (id,business_id,waba_id,credit_line_id,currency,status,requested_by) VALUES ($1,$2,$3,$4,$5,'processing',$6) ON CONFLICT (waba_id) DO NOTHING RETURNING id",[operationId,account.business_id,account.waba_id,body.creditLineId,payload.waba_currency,admin.id]);
      let claimed=inserted.rowCount;
      if (!claimed && body.retryRejected===true) {
        const retried=await client.query("UPDATE meta_credit_operations SET status='processing',error_code='',updated_at=NOW(),requested_by=$1 WHERE waba_id=$2 AND credit_line_id=$3 AND status='rejected' RETURNING id",[admin.id,account.waba_id,body.creditLineId]);
        if (retried.rowCount) {operationId=retried.rows[0].id;claimed=1;}
      }
      if (claimed) await client.query('INSERT INTO platform_audit_logs (id,super_admin_id,action,metadata) VALUES ($1,$2,$3,$4)',[id('pa'),admin.id,'meta_credit_sharing_requested',JSON.stringify({operationId,wabaId:account.waba_id,creditLineId:body.creditLineId})]);
      return claimed;
    });
    if (!created) {
      const existing=(await query('SELECT status,credit_line_id,id FROM meta_credit_operations WHERE waba_id=$1',[account.waba_id])).rows[0];
      if (existing?.credit_line_id!==body.creditLineId) throw new AppError('This WhatsApp account already has a recorded credit operation. Reconcile it with Meta before changing billing.',409,'META_CREDIT_OPERATION_CONFLICT');
      return json({duplicate:true,status:existing.status,operationId:existing.id});
    }
    let status='unconfirmed',allocationId='',errorCode='META_DELIVERY_UNCONFIRMED';
    try {
      const result=await creditRequest(body.creditLineId+'/whatsapp_credit_sharing_and_attach',payload);
      if (result.ok && /^\d+$/.test(String(result.payload.id || result.payload.allocation_config_id || ''))) {
        status='attached';allocationId=String(result.payload.id || result.payload.allocation_config_id);errorCode='';
      } else if (!result.ok && [400,401,403,404,422,429].includes(result.status)) {status='rejected';errorCode=String(result.payload.error?.code || 'META_CREDIT_REJECTED');}
    } catch { /* Never automatically replay a financial operation after uncertain delivery. */ }
    await transaction(async client=>{
      await client.query('UPDATE meta_credit_operations SET status=$1,allocation_id=$2,error_code=$3,updated_at=NOW() WHERE id=$4',[status,allocationId,errorCode,operationId]);
      await client.query('INSERT INTO platform_audit_logs (id,super_admin_id,action,metadata) VALUES ($1,$2,$3,$4)',[id('pa'),admin.id,'meta_credit_sharing_result',JSON.stringify({operationId,status,allocationId,errorCode})]);
    });
    return json({status,operationId,allocationId},status==='attached'?201:202);
  } catch(error) {return errorJson(error);}
}
