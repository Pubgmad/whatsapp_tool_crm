import {requireSession} from './auth.js';
import {AppError,query,json,errorJson} from './db.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {enrichOrderRow} from './attribution-confidence.js';
import {marketingMessagesStatus} from './marketing-messages-readiness.js';
export function journeyRange(params){
  const since=params.get('since'),until=params.get('until');
  const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!valid(since)||!valid(until)||since>until||Date.parse(until)-Date.parse(since)>366*86400000)throw new AppError('Select a valid date range of up to one year.',400,'REPORT_RANGE_INVALID');
  return {since,until};
}
export async function journeyReportForBusiness(businessId,range,page=1){
  const values=[businessId,range.since,range.until];
  const campaigns=(await query(`SELECT c.id,c.name,COUNT(cr.id)::int AS recipients,
    COUNT(cr.id) FILTER (WHERE cr.status IN ('sent','delivered','read'))::int AS sent,
    COUNT(cr.id) FILTER (WHERE cr.status IN ('delivered','read'))::int AS delivered,
    COUNT(cr.id) FILTER (WHERE cr.status='read')::int AS read,
    COUNT(cr.id) FILTER (WHERE cr.status='failed')::int AS failed,
    COUNT(cr.id) FILTER (WHERE EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id AND cv.business_id=c.business_id WHERE m.campaign_recipient_id=cr.id AND m.direction='incoming'))::int AS replied,
    COUNT(cr.id) FILTER (WHERE EXISTS (SELECT 1 FROM tracked_link_tokens tk WHERE tk.business_id=c.business_id AND tk.campaign_recipient_id=cr.id AND tk.confirmed_at IS NOT NULL))::int AS clicked
    FROM campaigns c LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
    WHERE c.business_id=$1 AND c.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND c.created_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC')
    GROUP BY c.id ORDER BY c.created_at DESC,c.id LIMIT 26 OFFSET $4`,[...values,(page-1)*25])).rows;
  const summary=(await query(`SELECT o.currency,COUNT(*)::int AS orders,
    COUNT(*) FILTER (WHERE o.payment_status IN ('captured','partially_refunded'))::int AS paid_orders,
    COALESCE(SUM(o.total_amount),0)::text AS order_value,
    COALESCE(SUM(CASE WHEN o.payment_status IN ('captured','partially_refunded') THEN o.total_amount-COALESCE(s.refunded_amount,0) ELSE 0 END),0)::text AS captured_value,
    COALESCE(SUM(s.refunded_amount),0)::text AS refunded_value
    FROM whatsapp_orders o LEFT JOIN shopify_order_settlements s ON s.order_id=o.id AND s.business_id=o.business_id
    WHERE o.business_id=$1 AND o.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND o.created_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC') GROUP BY o.currency ORDER BY o.currency`,values)).rows;
  const orders=(await query(`SELECT o.id,o.source_message_id,o.customer_phone,o.currency,o.total_amount::text,o.payment_status,o.fulfillment_status,o.created_at,
    s.refunded_amount::text AS refunded_amount,s.shopify_order_id,
    cv.id AS conversation_id,ct.id AS contact_id,ct.name AS contact_name,
    c.id AS campaign_id,c.name AS campaign_name,cr.id AS recipient_id,
    m.metadata->'referral' AS referral
    FROM whatsapp_orders o
    LEFT JOIN shopify_order_settlements s ON s.order_id=o.id AND s.business_id=o.business_id
    LEFT JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id
    LEFT JOIN messages m ON m.meta_message_id=o.source_message_id AND m.direction='incoming' AND EXISTS (SELECT 1 FROM conversations v WHERE v.id=m.conversation_id AND v.business_id=o.business_id AND v.whatsapp_phone_number_id=p.phone_number_id)
    LEFT JOIN conversations cv ON cv.id=m.conversation_id AND cv.business_id=o.business_id
    LEFT JOIN contacts ct ON ct.id=cv.contact_id AND ct.business_id=o.business_id
    LEFT JOIN campaign_recipients cr ON cr.contact_id=ct.id AND cr.meta_message_id<>'' AND cr.meta_message_id=m.metadata->>'replyToMessageId'
    LEFT JOIN campaigns c ON c.id=cr.campaign_id AND c.business_id=o.business_id
    WHERE o.business_id=$1 AND o.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND o.created_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC')
    ORDER BY o.created_at DESC,o.id LIMIT 26 OFFSET $4`,[...values,(page-1)*25])).rows;
  const calls=(await query(`SELECT direction,status,COUNT(*)::int AS count FROM whatsapp_calls WHERE business_id=$1 AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND created_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC') GROUP BY direction,status ORDER BY direction,status`,values)).rows;
  const deliveryMix=(await query(`SELECT delivery_method,COUNT(*)::int AS campaigns,
    COALESCE(SUM((SELECT COUNT(*) FROM campaign_recipients cr WHERE cr.campaign_id=c.id)),0)::int AS recipients
    FROM campaigns c WHERE c.business_id=$1 AND c.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND c.created_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC')
    GROUP BY delivery_method ORDER BY delivery_method`,values)).rows;
  const mmRow=(await query("SELECT capabilities FROM whatsapp_accounts WHERE business_id=$1 AND status='connected' ORDER BY created_at LIMIT 1",[businessId])).rows[0];
  const marketingMessages=marketingMessagesStatus(mmRow?.capabilities||{});
  return {campaigns:campaigns.slice(0,25),orders:orders.slice(0,25).map(enrichOrderRow),summary,calls,deliveryMix,marketingMessages,page,hasMore:campaigns.length>25||orders.length>25,range};
}
export async function getJourneyAnalytics(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    const params=new URL(request.url).searchParams,range=journeyRange(params),page=Number(params.get('page')||1);
    if(!Number.isSafeInteger(page)||page<1||page>100000)throw new AppError('Invalid report page.',400,'INVALID_PAGE');
    return json(await journeyReportForBusiness(session.businessId,range,page));
  }catch(error){return errorJson(error);}
}
