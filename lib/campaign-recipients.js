import {requireSession} from './auth.js';
import {AppError,errorJson,json,query,toIso} from './db.js';

export async function getCampaignRecipients(request,context) {
  try {
    const {id:campaignId}=await context.params;
    const session=await requireSession(request);
    const campaign=await query('SELECT id FROM campaigns WHERE id=$1 AND business_id=$2',[campaignId,session.businessId]);
    if(!campaign.rowCount)throw new AppError('Campaign not found.',404,'NOT_FOUND');
    const requested=Number.parseInt(new URL(request.url).searchParams.get('page'),10);
    const pageSize=50,total=Number((await query('SELECT COUNT(*)::int AS total FROM campaign_recipients WHERE campaign_id=$1',[campaignId])).rows[0]?.total||0);
    const pages=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.min(pages,Number.isSafeInteger(requested)&&requested>0?requested:1);
    const rows=await query(`SELECT cr.*,ct.name AS contact_name,ct.phone AS contact_phone,
      j.status AS job_status,j.attempts AS job_attempts,j.max_attempts AS job_max_attempts,j.run_at AS job_run_at,j.error_message AS job_error_message,
      EXISTS(SELECT 1 FROM messages m WHERE m.campaign_recipient_id=cr.id AND m.direction='incoming') AS replied
      FROM campaign_recipients cr JOIN contacts ct ON ct.id=cr.contact_id
      LEFT JOIN campaign_jobs j ON j.campaign_recipient_id=cr.id
      WHERE cr.campaign_id=$1 AND ct.business_id=$2
      ORDER BY cr.sent_at DESC NULLS LAST,cr.id LIMIT $3 OFFSET $4`,[campaignId,session.businessId,pageSize,(page-1)*pageSize]);
    return json({recipients:rows.rows.map(row=>({
      id:row.id,contactId:row.contact_id,contactName:row.contact_name,contactPhone:row.contact_phone,
      message:row.message,status:row.status,metaMessageId:row.meta_message_id,sentAt:toIso(row.sent_at),
      errorMessage:row.error_message||'',jobStatus:row.job_status||null,attempts:row.job_attempts??null,
      maxAttempts:row.job_max_attempts??null,nextRunAt:['queued','retry'].includes(row.job_status)?toIso(row.job_run_at):null,
      jobError:row.job_error_message||'',replied:Boolean(row.replied)
    })),pagination:{page,pageSize,total,pages}});
  }catch(error){return errorJson(error);}
}
