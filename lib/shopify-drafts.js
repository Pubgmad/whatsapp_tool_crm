import {AppError,query,transaction} from './db.js';
import {shopifyAccessToken} from './shopify-auth.js';
import {connectorSource} from './provider-connectors.js';
import {readTextBodyLimited} from './security.js';

const draftId=value=>/^gid:\/\/shopify\/DraftOrder\/[1-9]\d*$/.test(value||'');
const orderGid=value=>/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(value||'');
const variantId=value=>/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(value||'');
const draftTag=orderId=>`wcrm_${orderId}`;

export function shopifyDraftInput(intent){
  if(!variantId(intent.variant_id)||!Number.isSafeInteger(Number(intent.quantity))||Number(intent.quantity)<1)throw new AppError('Shopify draft input is invalid.',409,'SHOPIFY_DRAFT_INVALID');
  return {lineItems:[{variantId:intent.variant_id,quantity:Number(intent.quantity)}],tags:[intent.tag],note:`WhatsApp CRM order ${intent.order_id}`};
}

function adminUrl(domain){
  connectorSource('shopify',domain);
  const version=process.env.SHOPIFY_ADMIN_API_VERSION;
  if(!/^20\d{2}-(01|04|07|10)$/.test(version||''))throw new AppError('Configure SHOPIFY_ADMIN_API_VERSION.',503,'SHOPIFY_NOT_CONFIGURED');
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

async function graphql(intent,token,queryText,variables,fetcher=fetch){
  let response;
  try{response=await fetcher(adminUrl(intent.source),{method:'POST',headers:{'content-type':'application/json','x-shopify-access-token':token},body:JSON.stringify({query:queryText,variables}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});}
  catch{throw new AppError('Shopify request outcome is unknown. Reconcile before taking another action.',503,'SHOPIFY_OUTCOME_UNKNOWN');}
  let body;
  try{body=JSON.parse(await readTextBodyLimited(response,200000));}
  catch{throw new AppError('Shopify response could not be verified. Reconcile this order.',503,'SHOPIFY_OUTCOME_UNKNOWN');}
  if(!response.ok||body.errors?.length)throw new AppError('Shopify did not confirm this request. Reconcile this order.',503,'SHOPIFY_OUTCOME_UNKNOWN');
  return body.data;
}

export function confirmedDraftStock(data,variantId,quantity){
  const variant=data?.productVariant;
  if(variant?.id!==variantId||variant.inventoryItem?.tracked!==true||!Number.isSafeInteger(variant.inventoryQuantity)||variant.inventoryQuantity<0)
    throw new AppError('Shopify inventory could not be verified for this variant.',409,'SHOPIFY_STOCK_UNCONFIRMED');
  if(variant.inventoryQuantity<quantity)throw new AppError('Shopify stock is lower than the requested quantity.',409,'SHOPIFY_OUT_OF_STOCK');
  return variant.inventoryQuantity;
}

export async function createShopifyDraftForOrder(businessId,orderId){
  const existing=(await query('SELECT order_id,status,draft_id,last_error FROM shopify_draft_intents WHERE order_id=$1 AND business_id=$2',[orderId,businessId])).rows[0];
  if(existing)return existing;
  const preparation=(await query(`SELECT r.quantity,m.external_id AS variant_id,c.id AS connection_id,c.business_id,c.source,c.credential_encrypted,c.auth_method,c.granted_scopes,c.enabled
    FROM whatsapp_orders o JOIN flow_runtime_reservations r ON r.order_id=o.id AND r.business_id=o.business_id
    JOIN availability_mappings m ON m.resource_id=r.resource_id AND m.business_id=r.business_id
    JOIN availability_connections c ON c.id=m.connection_id AND c.business_id=m.business_id
    WHERE o.id=$1 AND o.business_id=$2 AND o.payment_status='unpaid' AND o.fulfillment_status='pending'
    AND r.status='confirmed' AND m.write_enabled AND c.provider='shopify'`,[orderId,businessId])).rows[0];
  if(!preparation?.enabled||!preparation.granted_scopes?.includes('write_draft_orders')||!preparation.granted_scopes?.includes('read_draft_orders'))throw new AppError('Enable Shopify draft handoff and reconnect with read/write draft scopes.',409,'SHOPIFY_DRAFT_NOT_ENABLED');
  const stock=await graphql(preparation,await shopifyAccessToken(preparation),`query CheckDraftStock($id: ID!) { productVariant(id:$id) { id inventoryQuantity inventoryItem { tracked } } }`,{id:preparation.variant_id});
  confirmedDraftStock(stock,preparation.variant_id,Number(preparation.quantity));
  const claim=await transaction(async client=>{
    const order=(await client.query('SELECT id,payment_status,fulfillment_status FROM whatsapp_orders WHERE id=$1 AND business_id=$2 FOR SHARE',[orderId,businessId])).rows[0];
    if(!order||order.payment_status!=='unpaid'||order.fulfillment_status!=='pending')throw new AppError('Only a pending, unpaid CRM order can be handed to Shopify.',409,'SHOPIFY_DRAFT_NOT_ELIGIBLE');
    const mapping=(await client.query(`SELECT r.quantity,m.external_id AS variant_id,c.id AS connection_id,c.source,c.credential_encrypted,c.granted_scopes,c.enabled
      FROM flow_runtime_reservations r JOIN availability_mappings m ON m.resource_id=r.resource_id AND m.business_id=r.business_id
      JOIN availability_connections c ON c.id=m.connection_id AND c.business_id=m.business_id
      WHERE r.order_id=$1 AND r.business_id=$2 AND r.status='confirmed' AND m.write_enabled AND c.provider='shopify' FOR SHARE OF r,m,c`,[orderId,businessId])).rows[0];
    if(!mapping?.enabled||!mapping.granted_scopes?.includes('write_draft_orders')||!mapping.granted_scopes?.includes('read_draft_orders'))throw new AppError('Enable Shopify draft handoff and reconnect with read/write draft scopes.',409,'SHOPIFY_DRAFT_NOT_ENABLED');
    if(mapping.connection_id!==preparation.connection_id||mapping.source!==preparation.source||mapping.credential_encrypted!==preparation.credential_encrypted||mapping.variant_id!==preparation.variant_id||Number(mapping.quantity)!==Number(preparation.quantity))throw new AppError('The Shopify product mapping or authorization changed. Check stock again.',409,'SHOPIFY_MAPPING_CHANGED');
    const inserted=await client.query(`INSERT INTO shopify_draft_intents(order_id,business_id,connection_id,source,variant_id,quantity,tag,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'unknown') ON CONFLICT(order_id) DO NOTHING RETURNING *`,[orderId,businessId,mapping.connection_id,mapping.source,mapping.variant_id,mapping.quantity,draftTag(orderId)]);
    return {intent:inserted.rows[0],token:mapping.credential_encrypted};
  });
  if(!claim.intent)return (await query('SELECT order_id,status,draft_id,last_error FROM shopify_draft_intents WHERE order_id=$1 AND business_id=$2',[orderId,businessId])).rows[0];
  const intent=claim.intent;
  try{
    const data=await graphql(intent,await shopifyAccessToken(preparation),`mutation CreateCrmDraft($input: DraftOrderInput!) { draftOrderCreate(input:$input) { draftOrder { id } userErrors { field message } } }`,{input:shopifyDraftInput(intent)});
    const result=data?.draftOrderCreate;
    if(result?.userErrors?.length){
      await query("UPDATE shopify_draft_intents SET status='rejected',last_error=$1,updated_at=NOW() WHERE order_id=$2 AND business_id=$3 AND status='unknown'",[String(result.userErrors[0].message||'Shopify rejected this draft.').slice(0,200),orderId,businessId]);
    }else if(draftId(result?.draftOrder?.id)){
      await query("UPDATE shopify_draft_intents SET status='drafted',draft_id=$1,last_error=NULL,updated_at=NOW() WHERE order_id=$2 AND business_id=$3 AND status='unknown'",[result.draftOrder.id,orderId,businessId]);
    }
  }catch(error){
    await query('UPDATE shopify_draft_intents SET last_error=$1,updated_at=NOW() WHERE order_id=$2 AND business_id=$3 AND status=$4',[String(error?.code||'SHOPIFY_OUTCOME_UNKNOWN').slice(0,80),orderId,businessId,'unknown']);
  }
  return (await query('SELECT order_id,status,draft_id,last_error FROM shopify_draft_intents WHERE order_id=$1 AND business_id=$2',[orderId,businessId])).rows[0];
}

export async function reconcileShopifyDraftForOrder(businessId,orderId){
  const intent=(await query(`SELECT i.*,c.credential_encrypted,c.auth_method,c.granted_scopes,c.enabled
    FROM shopify_draft_intents i LEFT JOIN availability_connections c ON c.id=i.connection_id AND c.business_id=i.business_id
    WHERE i.order_id=$1 AND i.business_id=$2`,[orderId,businessId])).rows[0];
  if(!intent)throw new AppError('No Shopify draft attempt exists.',404,'NOT_FOUND');
  if(intent.status==='drafted'||intent.status==='rejected')return {order_id:orderId,status:intent.status,draft_id:intent.draft_id,last_error:intent.last_error};
  if(!intent.enabled||!intent.granted_scopes?.includes('read_draft_orders'))throw new AppError('Reconnect Shopify with draft read access to reconcile.',409,'AVAILABILITY_REAUTHORIZE');
  const data=await graphql(intent,await shopifyAccessToken(intent),`query FindCrmDraft($query: String!) { draftOrders(first: 10,query:$query) { nodes { id tags lineItems(first: 10) { nodes { variant { id } quantity } pageInfo { hasNextPage } } } pageInfo { hasNextPage } } }`,{query:`tag:${intent.tag}`});
  const matches=data?.draftOrders?.nodes;
  if(!Array.isArray(matches))throw new AppError('Shopify draft search could not be verified.',503,'SHOPIFY_OUTCOME_UNKNOWN');
  const exact=matches.filter(item=>item.tags?.includes(intent.tag));
  if(data.draftOrders.pageInfo?.hasNextPage||exact.length>1||exact.length===1&&(!draftId(exact[0].id)||exact[0].lineItems?.pageInfo?.hasNextPage||exact[0].lineItems?.nodes?.length!==1||exact[0].lineItems.nodes[0].variant?.id!==intent.variant_id||exact[0].lineItems.nodes[0].quantity!==intent.quantity)){
    await query("UPDATE shopify_draft_intents SET status='conflict',last_error='SHOPIFY_DRAFT_CONFLICT',updated_at=NOW() WHERE order_id=$1 AND business_id=$2",[orderId,businessId]);
    return {order_id:orderId,status:'conflict',draft_id:null,last_error:'SHOPIFY_DRAFT_CONFLICT'};
  }
  if(exact.length===1){
    await query("UPDATE shopify_draft_intents SET status='drafted',draft_id=$1,last_error=NULL,updated_at=NOW() WHERE order_id=$2 AND business_id=$3",[exact[0].id,orderId,businessId]);
    return {order_id:orderId,status:'drafted',draft_id:exact[0].id,last_error:null};
  }
  return {order_id:orderId,status:'unknown',draft_id:null,last_error:intent.last_error};
}

export function verifiedShopifyOrderSnapshot(draft,expectedDraftId,localAmount,localCurrency){
  if(draft?.id!==expectedDraftId||!['OPEN','INVOICE_SENT','COMPLETED'].includes(draft.status))
    throw new AppError('Shopify draft state could not be verified.',503,'SHOPIFY_ORDER_UNCONFIRMED');
  const order=draft.order;
  if(!order){
    if(draft.status==='COMPLETED')throw new AppError('Completed Shopify draft has no readable order. Reconnect with order access.',409,'SHOPIFY_ORDER_UNCONFIRMED');
    return {orderId:null,status:draft.status,financialStatus:null,amount:null,currency:null,amountMatches:null};
  }
  const money=(order.totalPriceSet||order.currentTotalPriceSet)?.presentmentMoney;
  const amountPattern=/^\d{1,18}(?:\.\d{1,6})?$/;
  if(!orderGid(order.id)||!['PENDING','AUTHORIZED','PARTIALLY_PAID','PAID','PARTIALLY_REFUNDED','REFUNDED','VOIDED','EXPIRED'].includes(order.displayFinancialStatus)
    ||!amountPattern.test(money?.amount||'')||!amountPattern.test(String(localAmount||''))||!/^[A-Z]{3}$/.test(money.currencyCode||''))
    throw new AppError('Shopify order financial state could not be verified.',503,'SHOPIFY_ORDER_UNCONFIRMED');
  const microUnits=value=>{const [whole,fraction='']=String(value).split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));};
  const amountMatches=money.currencyCode===localCurrency&&microUnits(money.amount)===microUnits(localAmount);
  return {orderId:order.id,status:draft.status,financialStatus:order.displayFinancialStatus,amount:money.amount,currency:money.currencyCode,amountMatches};
}

const moneyUnits=value=>{
  if(!/^\d{1,18}(?:\.\d{1,6})?$/.test(String(value||'')))throw new AppError('Shopify payment amount is invalid.',503,'SHOPIFY_PAYMENT_UNCONFIRMED');
  const [whole,fraction='']=String(value).split('.');return BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
};
const moneyText=units=>`${units/1000000n}.${String(units%1000000n).padStart(6,'0')}`;

export function verifiedShopifySettlement(order,shopifyOrderId,localAmount,currency){
  if(order?.id!==shopifyOrderId||order.test!==false||!Array.isArray(order.transactions)||!['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(order.displayFinancialStatus))
    throw new AppError('Shopify payment transactions are not verified.',503,'SHOPIFY_PAYMENT_UNCONFIRMED');
  const expected=moneyUnits(localAmount),seen=new Set();let received=0n,refunded=0n;
  const verified=[];
  for(const item of order.transactions){
    if(!/^gid:\/\/shopify\/OrderTransaction\/[1-9]\d*$/.test(item?.id||'')||seen.has(item.id)||!['SALE','CAPTURE','REFUND','AUTHORIZATION','VOID','CHANGE','EMV_AUTHORIZATION'].includes(item.kind)||!['SUCCESS','PENDING','FAILURE','ERROR','AWAITING_RESPONSE','UNKNOWN'].includes(item.status))throw new AppError('Shopify returned an ambiguous payment transaction.',503,'SHOPIFY_PAYMENT_UNCONFIRMED');
    seen.add(item.id);
    if(item.status!=='SUCCESS'||!['SALE','CAPTURE','REFUND'].includes(item.kind))continue;
    const amount=item.amountSet?.presentmentMoney;
    if(amount?.currencyCode!==currency||item.test!==false||item.manualPaymentGateway!==false||!Number.isFinite(Date.parse(item.processedAt)))throw new AppError('Shopify payment origin or currency cannot be verified.',503,'SHOPIFY_PAYMENT_UNCONFIRMED');
    const units=moneyUnits(amount.amount);
    if(units<=0n)throw new AppError('Shopify payment amount is invalid.',503,'SHOPIFY_PAYMENT_UNCONFIRMED');
    if(item.kind==='REFUND')refunded+=units;else received+=units;
    verified.push({id:item.id,kind:item.kind,amount:moneyText(units),processedAt:item.processedAt});
  }
  const totalReceived=order.totalReceivedSet?.presentmentMoney,totalRefunded=order.totalRefundedSet?.presentmentMoney;
  if(totalReceived?.currencyCode!==currency||totalRefunded?.currencyCode!==currency||received!==moneyUnits(totalReceived.amount)||refunded!==moneyUnits(totalRefunded.amount)||received!==expected||refunded>received||!verified.some(item=>item.kind!=='REFUND'))throw new AppError('Shopify transaction totals do not match the CRM order.',409,'SHOPIFY_PAYMENT_MISMATCH');
  const state=refunded===0n?'captured':refunded===received?'refunded':'partially_refunded';
  if(({captured:'PAID',partially_refunded:'PARTIALLY_REFUNDED',refunded:'REFUNDED'})[state]!==order.displayFinancialStatus)throw new AppError('Shopify financial state and transactions disagree.',409,'SHOPIFY_PAYMENT_MISMATCH');
  return {state,received:moneyText(received),refunded:moneyText(refunded),transactions:verified};
}

export async function reconcileShopifyOrderForDraft(businessId,orderId){
  const intent=(await query(`SELECT i.order_id,i.business_id,i.connection_id,i.status,i.draft_id,i.source,c.credential_encrypted,c.auth_method,c.granted_scopes,c.enabled,
    o.total_amount AS local_amount,o.currency AS local_currency
    FROM shopify_draft_intents i JOIN whatsapp_orders o ON o.id=i.order_id AND o.business_id=i.business_id
    LEFT JOIN availability_connections c ON c.id=i.connection_id AND c.business_id=i.business_id
    WHERE i.order_id=$1 AND i.business_id=$2`,[orderId,businessId])).rows[0];
  if(!intent)throw new AppError('Shopify handoff not found.',404,'NOT_FOUND');
  if(intent.status!=='drafted'||!draftId(intent.draft_id))throw new AppError('Reconcile the Shopify draft before checking its order.',409,'SHOPIFY_DRAFT_UNCONFIRMED');
  if(!intent.enabled||!intent.granted_scopes?.includes('read_draft_orders')||!intent.granted_scopes?.includes('read_orders'))
    throw new AppError('Reconnect Shopify with read_draft_orders and read_orders to check order state.',409,'AVAILABILITY_REAUTHORIZE');
  const data=await graphql(intent,await shopifyAccessToken(intent),`query CheckCrmShopifyOrder($id: ID!) {
    draftOrder(id:$id) { id status order { id test displayFinancialStatus
      totalPriceSet { presentmentMoney { amount currencyCode } }
      currentTotalPriceSet { presentmentMoney { amount currencyCode } }
      totalReceivedSet { presentmentMoney { amount currencyCode } }
      totalRefundedSet { presentmentMoney { amount currencyCode } }
      transactions { id kind status test manualPaymentGateway processedAt amountSet { presentmentMoney { amount currencyCode } } }
    } }
  }`,{id:intent.draft_id});
  const snapshot=verifiedShopifyOrderSnapshot(data?.draftOrder,intent.draft_id,intent.local_amount,intent.local_currency);
  let settlement=null,settlementError=null;
  if(snapshot.orderId&&snapshot.amountMatches&&['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(snapshot.financialStatus)){
    try{settlement=verifiedShopifySettlement(data.draftOrder.order,snapshot.orderId,intent.local_amount,intent.local_currency);}
    catch(error){settlementError=error.code||'SHOPIFY_PAYMENT_UNCONFIRMED';}
  }
  return transaction(async client=>{
    const locked=(await client.query("SELECT i.order_id,i.connection_id,i.source,i.draft_id,o.payment_status FROM shopify_draft_intents i JOIN whatsapp_orders o ON o.id=i.order_id AND o.business_id=i.business_id WHERE i.order_id=$1 AND i.business_id=$2 AND i.status='drafted' FOR UPDATE OF i,o",[orderId,businessId])).rows[0];
    if(!locked||locked.draft_id!==intent.draft_id||locked.source!==intent.source||locked.connection_id!==intent.connection_id)throw new AppError('Shopify handoff changed during reconciliation.',409,'SHOPIFY_DRAFT_UNCONFIRMED');
    if(settlement){
      const previous=(await client.query('SELECT state,refunded_amount,shopify_order_id FROM shopify_order_settlements WHERE order_id=$1 AND business_id=$2 FOR UPDATE',[orderId,businessId])).rows[0];
      const priorTransactions=(await client.query('SELECT transaction_id FROM shopify_payment_transactions WHERE order_id=$1 AND business_id=$2',[orderId,businessId])).rows;
      const competing=(await client.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM merchant_checkouts WHERE order_id=$1 AND business_id=$2)
        OR EXISTS(SELECT 1 FROM whatsapp_native_checkouts WHERE order_id=$1 AND business_id=$2)`,[orderId,businessId])).rowCount;
      if(competing||!previous&&locked.payment_status!=='unpaid'&&locked.payment_status!=='pending'||previous&&previous.shopify_order_id!==snapshot.orderId||previous&&moneyUnits(settlement.refunded)<moneyUnits(previous.refunded_amount)||priorTransactions.some(item=>!settlement.transactions.some(tx=>tx.id===item.transaction_id)))settlementError='SHOPIFY_PAYMENT_CONFLICT';
      else{
        for(const item of settlement.transactions){
          const inserted=await client.query(`INSERT INTO shopify_payment_transactions(transaction_id,business_id,order_id,shopify_order_id,kind,amount,currency,processed_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(transaction_id) DO NOTHING RETURNING transaction_id`,[item.id,businessId,orderId,snapshot.orderId,item.kind,item.amount,intent.local_currency,item.processedAt]);
          if(!inserted.rowCount){
            const old=(await client.query('SELECT business_id,order_id,kind,amount,currency FROM shopify_payment_transactions WHERE transaction_id=$1',[item.id])).rows[0];
            if(!old||old.business_id!==businessId||old.order_id!==orderId||old.kind!==item.kind||moneyUnits(old.amount)!==moneyUnits(item.amount)||old.currency!==intent.local_currency)throw new AppError('Shopify transaction identity changed.',409,'SHOPIFY_PAYMENT_CONFLICT');
          }
        }
        await client.query(`INSERT INTO shopify_order_settlements(order_id,business_id,connection_id,shopify_order_id,currency,received_amount,refunded_amount,state)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(order_id) DO UPDATE SET received_amount=EXCLUDED.received_amount,
          refunded_amount=EXCLUDED.refunded_amount,state=EXCLUDED.state,verified_at=NOW()`,[orderId,businessId,intent.connection_id,snapshot.orderId,intent.local_currency,settlement.received,settlement.refunded,settlement.state]);
        await client.query('UPDATE whatsapp_orders SET payment_status=$1,payment_event_at=NOW(),updated_at=NOW() WHERE id=$2 AND business_id=$3',[settlement.state,orderId,businessId]);
      }
    }
    const result=await client.query(`UPDATE shopify_draft_intents SET shopify_order_id=$1,shopify_order_status=$2,
      shopify_financial_status=$3,shopify_total_amount=$4,shopify_currency=$5,shopify_checked_at=NOW(),
      last_error=$6,shopify_check_claimed_at=NULL,shopify_check_attempts=0,
      shopify_next_check_at=NOW()+INTERVAL '15 minutes',updated_at=NOW()
      WHERE order_id=$7 AND business_id=$8 AND status='drafted' AND draft_id=$9
      RETURNING order_id,status,draft_id,shopify_order_id,shopify_order_status,shopify_financial_status,shopify_total_amount,shopify_currency,shopify_checked_at,last_error`,
      [snapshot.orderId,snapshot.status,snapshot.financialStatus,snapshot.amount,snapshot.currency,!snapshot.amountMatches?'SHOPIFY_ORDER_AMOUNT_MISMATCH':settlementError,orderId,businessId,intent.draft_id]);
    return result.rows[0];
  });
}

export async function reconcileShopifyLedgerFromWebhook(businessId, shopifyOrderExternalId) {
  const numeric = String(shopifyOrderExternalId || '').replace(/\D/g, '');
  if (!numeric) return { reconciled: 0 };
  const intents = (await query(
    `SELECT order_id, business_id FROM shopify_draft_intents
     WHERE business_id = $1 AND status = 'drafted'
       AND (shopify_order_id = $2 OR shopify_order_id = $3 OR shopify_order_id LIKE $4)`,
    [businessId, numeric, `gid://shopify/Order/${numeric}`, `%/${numeric}`]
  )).rows;
  let reconciled = 0;
  for (const row of intents) {
    try {
      await reconcileShopifyOrderForDraft(row.business_id, row.order_id);
      reconciled += 1;
    } catch {}
  }
  return { reconciled };
}

export async function runDueShopifyOrderCheck(){
  const claim=await query(`UPDATE shopify_draft_intents i SET shopify_check_claimed_at=NOW(),updated_at=NOW()
    FROM (SELECT d.order_id,d.business_id FROM shopify_draft_intents d
      JOIN availability_connections c ON c.id=d.connection_id AND c.business_id=d.business_id
      JOIN businesses b ON b.id=d.business_id
      WHERE d.status='drafted' AND d.shopify_next_check_at<=NOW()
        AND (d.shopify_check_claimed_at IS NULL OR d.shopify_check_claimed_at<NOW()-INTERVAL '2 minutes')
        AND c.enabled AND c.order_sync_enabled AND c.granted_scopes @> ARRAY['read_draft_orders','read_orders']::TEXT[]
        AND b.account_status<>'suspended'
        AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests w WHERE w.business_id=d.business_id AND w.status IN ('scheduled','pending_approval'))
      ORDER BY d.shopify_next_check_at,d.order_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED) due
    WHERE i.order_id=due.order_id AND i.business_id=due.business_id
    RETURNING i.order_id,i.business_id,i.shopify_check_attempts`,[]);
  const item=claim.rows[0];
  if(!item)return {attempted:0,failed:0};
  try{await reconcileShopifyOrderForDraft(item.business_id,item.order_id);return {attempted:1,failed:0};}
  catch(error){
    const attempts=Math.min(Number(item.shopify_check_attempts||0)+1,10);
    const minutes=Math.min(5*2**(attempts-1),360);
    await query(`UPDATE shopify_draft_intents SET shopify_check_claimed_at=NULL,shopify_check_attempts=$1,
      shopify_next_check_at=NOW()+$2*INTERVAL '1 minute',last_error=$3,updated_at=NOW()
      WHERE order_id=$4 AND business_id=$5`,[attempts,minutes,String(error?.code||'SHOPIFY_ORDER_CHECK_FAILED').slice(0,80),item.order_id,item.business_id]);
    return {attempted:1,failed:1,code:error?.code||'SHOPIFY_ORDER_CHECK_FAILED'};
  }
}
