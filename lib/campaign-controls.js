import {AppError, id, transaction, query, json, errorJson} from './db.js';
import {requireSession} from './auth.js';
import {readJsonBodyLimited} from './security.js';
import {assertCampaignCapacity} from './limits.js';
import {validateTemplateParameters} from './template-send-components.js';
import {syncCampaignAudienceFromSegment} from './campaign-audience-sync.js';
import { recipientErrorRetryable } from './campaign-retry-policy.js';

const clean = value => String(value || '').trim();

export function campaignFrequencyHours(value) {
  if (value!==undefined&&value!==null&&!['number','string'].includes(typeof value)) throw new AppError('Marketing frequency must be a number of hours.',400,'CAMPAIGN_FREQUENCY_INVALID');
  const hours = Number(value ?? 0);
  if (!Number.isInteger(hours) || hours < 0 || hours > 8760) throw new AppError('Marketing frequency must be a whole number of hours between 0 and 8760.',400,'CAMPAIGN_FREQUENCY_INVALID');
  return hours;
}

export function campaignReportStatus(campaign,stats,now=Date.now()) {
  if (['paused','cancelled','draft','pending_approval'].includes(campaign.status)) return campaign.status;
  if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime()>now) return 'scheduled';
  return stats.queued?'processing':stats.failed===stats.total&&stats.total?'failed':stats.total?'completed':campaign.status;
}

export async function campaignPolicyForBusiness(businessId,client={query}) {
  const row=(await client.query('SELECT approval_required,min_marketing_interval_hours FROM campaign_policies WHERE business_id=$1',[businessId])).rows[0];
  return {approvalRequired:row?.approval_required===true,minMarketingIntervalHours:row?.min_marketing_interval_hours??0};
}

export async function campaignPolicyEndpoint(request) {
  try {
    const session=await requireSession(request);
    if (!['Owner','Manager'].includes(session.role)) throw new AppError('Campaign management access is required.',403,'CAMPAIGN_MANAGEMENT_FORBIDDEN');
    if (request.method==='GET') return json(await campaignPolicyForBusiness(session.businessId));
    if (session.role!=='Owner') throw new AppError('Only the company owner can change campaign policy.',403,'CAMPAIGN_REVIEW_FORBIDDEN');
    const body=await readJsonBodyLimited(request,4096);
    if (typeof body.approvalRequired!=='boolean') throw new AppError('Provide an explicit campaign approval policy.',400,'CAMPAIGN_POLICY_INVALID');
    const hours=campaignFrequencyHours(body.minMarketingIntervalHours);
    await transaction(async client=>{
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      await client.query(`INSERT INTO campaign_policies (business_id,approval_required,min_marketing_interval_hours,updated_by)
        VALUES ($1,$2,$3,$4) ON CONFLICT (business_id) DO UPDATE SET approval_required=EXCLUDED.approval_required,
        min_marketing_interval_hours=EXCLUDED.min_marketing_interval_hours,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[session.businessId,body.approvalRequired,hours,session.userId]);
      await log(client,session,'campaign_policy_updated',{approvalRequired:body.approvalRequired,minMarketingIntervalHours:hours});
    });
    return json(await campaignPolicyForBusiness(session.businessId));
  }catch(error){return errorJson(error);}
}

export function assertCampaignReviewAction(campaign, action, role) {
  if (!['submit','approve','reject'].includes(action)) throw new AppError('Unsupported campaign action.',400,'VALIDATION_ERROR');
  if (['approve','reject'].includes(action)) {
    if (role !== 'Owner') throw new AppError('Only the company owner can review a campaign.',403,'CAMPAIGN_REVIEW_FORBIDDEN');
    if (campaign.approval_status !== 'pending' || campaign.status !== 'pending_approval') throw new AppError('This campaign is not awaiting review.',409,'CAMPAIGN_NOT_PENDING');
  } else if (!['draft','rejected'].includes(campaign.approval_status) || campaign.status !== 'draft') {
    throw new AppError('Only a draft campaign can be submitted.',409,'CAMPAIGN_NOT_DRAFT');
  }
}

export async function campaignControlAction(session, campaignId, body) {
  if (!['Owner','Manager'].includes(session.role)) throw new AppError('Campaign management access is required.',403,'CAMPAIGN_MANAGEMENT_FORBIDDEN');
  return transaction(async client => {
    const source = (await client.query('SELECT * FROM campaigns WHERE id=$1 AND business_id=$2 FOR UPDATE',[campaignId,session.businessId])).rows[0];
    if (!source) throw new AppError('Campaign not found.',404,'CAMPAIGN_NOT_FOUND');
    const action = clean(body.action);
    if (action === 'duplicate') {
      const name = clean(body.name);
      if (!name || name.length > 255) throw new AppError('Enter a campaign name of up to 255 characters.',400,'CAMPAIGN_NAME_REQUIRED');
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      await assertCampaignCapacity(session.businessId,0,client);
      const copyId = id('k');
      await client.query(
        `INSERT INTO campaigns (id,business_id,name,template_id,automation_flow_id,variables,mode,status,timezone,delivery_method,template_parameters,approval_status,created_by,frequency_hours,source_campaign_id,source_kind,source_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,'draft',$11,$12,$13,'workspace_broadcast',$1)`,
        [copyId,session.businessId,name,source.template_id,source.automation_flow_id,JSON.stringify(source.variables),source.mode,source.timezone,source.delivery_method,JSON.stringify(source.template_parameters || {}),session.userId,source.frequency_hours,source.id]
      );
      const recipients = (await client.query(
        `SELECT r.contact_id,r.message FROM campaign_recipients r JOIN contacts c ON c.id=r.contact_id
         WHERE r.campaign_id=$1 AND c.business_id=$2 AND c.marketing_permission AND NOT c.unsubscribed`,[source.id,session.businessId]
      )).rows;
      for (const recipient of recipients) await client.query('INSERT INTO campaign_recipients (id,campaign_id,contact_id,message) VALUES ($1,$2,$3,$4)',[id('r'),copyId,recipient.contact_id,recipient.message]);
      await log(client,session,'campaign_duplicated',{sourceCampaignId:campaignId,campaignId:copyId,recipients:recipients.length});
      return {ok:true,campaignId:copyId};
    }
    assertCampaignReviewAction(source,action,session.role);
    const note = clean(body.note);
    if (note.length > 2000) throw new AppError('Review note must be at most 2000 characters.',400,'CAMPAIGN_NOTE_INVALID');
    if (action === 'reject') {
      if (!note) throw new AppError('Enter a reason for rejecting the campaign.',400,'CAMPAIGN_NOTE_REQUIRED');
      await client.query("UPDATE campaigns SET status='draft',approval_status='rejected',reviewed_by=$1,reviewed_at=NOW(),review_note=$2 WHERE id=$3 AND business_id=$4",[session.userId,note,source.id,session.businessId]);
    } else {
      const template = (await client.query('SELECT * FROM templates WHERE id=$1 AND business_id=$2',[source.template_id,session.businessId])).rows[0];
      if (template?.status !== 'Approved') throw new AppError('The campaign template must still be approved.',409,'TEMPLATE_NOT_APPROVED');
      validateTemplateParameters(template,source.template_parameters || {});
      if (source.dynamic_audience && source.audience_segment_id) {
        await syncCampaignAudienceFromSegment(session.businessId, source.id, client);
      }
      const eligible = (await client.query(
        `SELECT r.id FROM campaign_recipients r JOIN contacts c ON c.id=r.contact_id
         WHERE r.campaign_id=$1 AND c.business_id=$2 AND c.marketing_permission AND NOT c.unsubscribed`,[source.id,session.businessId]
      )).rows;
      if (!eligible.length) throw new AppError('This campaign has no eligible recipients.',409,'CAMPAIGN_AUDIENCE_EMPTY');
      const scheduledAt = action === 'submit' && body.scheduledAt ? new Date(body.scheduledAt) : source.scheduled_at;
      if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) throw new AppError('Choose a valid schedule.',400,'CAMPAIGN_SCHEDULE_INVALID');
      let hours = action === 'submit' ? campaignFrequencyHours(body.frequencyHours ?? source.frequency_hours) : source.frequency_hours;
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      if (template.category==='MARKETING') hours=Math.max(hours,(await campaignPolicyForBusiness(session.businessId,client)).minMarketingIntervalHours);
      await assertCampaignCapacity(session.businessId,eligible.length,client,{isExisting:true});
      await client.query(
        `UPDATE campaigns SET approval_status=$1,status=$2,scheduled_at=$3,frequency_hours=$4,
           reviewed_by=$5,reviewed_at=CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() END,review_note=$6
         WHERE id=$7 AND business_id=$8`,
        [action === 'approve' ? 'approved' : 'pending',action === 'approve' ? (scheduledAt && new Date(scheduledAt) > new Date() ? 'scheduled' : 'queued') : 'pending_approval',scheduledAt,hours,action === 'approve' ? session.userId : null,note,source.id,session.businessId]
      );
      if (action === 'approve') {
        for (const recipient of eligible) await client.query(
          `INSERT INTO campaign_jobs (id,campaign_recipient_id,run_at) VALUES ($1,$2,GREATEST(COALESCE($3::timestamptz,NOW()),NOW())) ON CONFLICT (campaign_recipient_id) DO NOTHING`,[id('j'),recipient.id,scheduledAt]
        );
        await client.query("UPDATE campaign_recipients SET status='failed',error_message='Recipient opted out before approval',updated_at=NOW() WHERE campaign_id=$1 AND id<>ALL($2::text[]) AND status='queued'",[source.id,eligible.map(r=>r.id)]);
      }
    }
    await log(client,session,'campaign_'+action,{campaignId:source.id,note});
    return {ok:true};
  });
}

async function log(client,session,action,metadata) {
  await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,action,JSON.stringify(metadata)]);
}

export async function retryFailedCampaignRecipients(session, campaignId) {
  if (!['Owner', 'Manager'].includes(session.role)) {
    throw new AppError('Campaign management access is required.', 403, 'CAMPAIGN_MANAGEMENT_FORBIDDEN');
  }
  return transaction(async (client) => {
    const campaign = (await client.query(
      'SELECT * FROM campaigns WHERE id=$1 AND business_id=$2 FOR UPDATE',
      [campaignId, session.businessId]
    )).rows[0];
    if (!campaign) throw new AppError('Campaign not found.', 404, 'CAMPAIGN_NOT_FOUND');
    if (!['completed', 'failed', 'processing', 'paused', 'queued'].includes(campaign.status)) {
      throw new AppError('Only sent or in-progress campaigns can retry failed recipients.', 409, 'CAMPAIGN_NOT_RETRYABLE');
    }
    const template = (await client.query(
      'SELECT status FROM templates WHERE id=$1 AND business_id=$2',
      [campaign.template_id, session.businessId]
    )).rows[0];
    if (template?.status !== 'Approved') {
      throw new AppError('The campaign template must still be approved before retrying.', 409, 'TEMPLATE_NOT_APPROVED');
    }
    const failed = (await client.query(
      `SELECT r.id,r.error_message FROM campaign_recipients r
       JOIN contacts c ON c.id=r.contact_id
       WHERE r.campaign_id=$1 AND c.business_id=$2 AND r.status='failed'
         AND c.marketing_permission AND NOT c.unsubscribed`,
      [campaignId, session.businessId]
    )).rows.filter((row) => recipientErrorRetryable(row.error_message));
    if (!failed.length) throw new AppError('No retryable failed recipients remain for this campaign.', 409, 'CAMPAIGN_RETRY_EMPTY');
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [session.businessId]);
    await assertCampaignCapacity(session.businessId, failed.length, client, { isExisting: true });
    let queued = 0;
    for (const recipient of failed) {
      await client.query(
        "UPDATE campaign_recipients SET status='queued',error_message='',updated_at=NOW() WHERE id=$1 AND campaign_id=$2",
        [recipient.id, campaignId]
      );
      await client.query(
        `INSERT INTO campaign_jobs (id,campaign_recipient_id,run_at,status,attempts,error_message)
         VALUES ($1,$2,NOW(),'queued',0,'')
         ON CONFLICT (campaign_recipient_id) DO UPDATE
         SET status='queued',run_at=NOW(),attempts=0,error_message='',locked_at=NULL,completed_at=NULL,updated_at=NOW()`,
        [id('j'), recipient.id]
      );
      queued += 1;
    }
    if (['completed', 'failed', 'paused'].includes(campaign.status)) {
      await client.query(
        "UPDATE campaigns SET status='queued',updated_at=NOW() WHERE id=$1 AND business_id=$2",
        [campaignId, session.businessId]
      );
    }
    await log(client, session, 'campaign_retry_failed', { campaignId, recipients: failed.length, jobs: queued });
    return { ok: true, recipients: failed.length, jobs: queued };
  });
}

export async function reserveCampaignDelivery(job) {
  if (job.template_category !== 'MARKETING') return null;
  return transaction(async client => {
    const contact = (await client.query('SELECT id,marketing_permission,unsubscribed FROM contacts WHERE id=$1 AND business_id=$2 FOR UPDATE',[job.contact_id,job.business_id])).rows[0];
    if (!contact?.marketing_permission || contact.unsubscribed) throw new AppError('Recipient opted out before delivery.',409,'RECIPIENT_OPTED_OUT');
    const frequencyHours=Math.max(campaignFrequencyHours(job.frequency_hours),(await campaignPolicyForBusiness(job.business_id,client)).minMarketingIntervalHours);
    const timing = (await client.query(
      `SELECT NOW() AS now, GREATEST(
         COALESCE((SELECT reserved_until FROM campaign_delivery_reservations WHERE business_id=$1 AND contact_id=$2),NOW()),
         COALESCE((SELECT attempted_at + ($3 * INTERVAL '1 hour') FROM campaign_delivery_reservations WHERE business_id=$1 AND contact_id=$2),NOW()),
         COALESCE((SELECT MAX(r.sent_at) + ($3 * INTERVAL '1 hour') FROM campaign_recipients r
           JOIN campaigns c ON c.id=r.campaign_id JOIN templates t ON t.id=c.template_id
           WHERE c.business_id=$1 AND r.contact_id=$2 AND t.category='MARKETING'),NOW())
       ) AS eligible_at`,[job.business_id,job.contact_id,frequencyHours]
    )).rows[0];
    if (new Date(timing.eligible_at) > new Date(timing.now)) return timing.eligible_at;
    await client.query(
      `INSERT INTO campaign_delivery_reservations (business_id,contact_id,campaign_id,reserved_until)
       VALUES ($1,$2,$3,NOW()+INTERVAL '15 minutes') ON CONFLICT (business_id,contact_id)
       DO UPDATE SET campaign_id=EXCLUDED.campaign_id,attempted_at=NOW(),reserved_until=EXCLUDED.reserved_until`,[job.business_id,job.contact_id,job.campaign_id]
    );
    return null;
  });
}

export async function releaseCampaignDelivery(job) {
  if (job.template_category !== 'MARKETING') return;
  await transaction(async client => {
    await client.query('UPDATE campaign_delivery_reservations SET reserved_until=NOW() WHERE business_id=$1 AND contact_id=$2 AND campaign_id=$3',[job.business_id,job.contact_id,job.campaign_id]);
  });
}

export async function spawnRecurringCampaignIfComplete(client, campaignId, businessId) {
  const source = (await client.query(
    `SELECT * FROM campaigns WHERE id=$1 AND business_id=$2 AND status='completed' AND recurring_interval_days>0 FOR UPDATE`,
    [campaignId, businessId]
  )).rows[0];
  if (!source) return null;
  const existing = (await client.query(
    `SELECT id FROM campaigns WHERE business_id=$1 AND recurring_parent_id=$2 AND status IN ('scheduled','queued','processing','pending_approval') LIMIT 1`,
    [businessId, source.id]
  )).rows[0];
  if (existing) return null;
  const scheduledAt = new Date(Date.now() + source.recurring_interval_days * 86400000);
  const copyId = id('k');
  await client.query(
    `INSERT INTO campaigns (id,business_id,name,template_id,automation_flow_id,variables,mode,status,scheduled_at,timezone,delivery_method,template_parameters,approval_status,created_by,frequency_hours,whatsapp_phone_number_id,recurring_interval_days,recurring_parent_id,source_campaign_id,source_kind,source_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'recurring_child',$17)`,
    [copyId, businessId, `${source.name} (${scheduledAt.toISOString().slice(0, 10)})`, source.template_id, source.automation_flow_id, JSON.stringify(source.variables || {}), source.mode, scheduledAt, source.timezone, source.delivery_method, JSON.stringify(source.template_parameters || {}), source.approval_status, source.created_by, source.frequency_hours, source.whatsapp_phone_number_id, source.recurring_interval_days, source.id, source.id]
  );
  const recipients = (await client.query(
    `SELECT r.contact_id,r.message FROM campaign_recipients r JOIN contacts c ON c.id=r.contact_id
     WHERE r.campaign_id=$1 AND c.business_id=$2 AND c.marketing_permission AND NOT c.unsubscribed`,
    [source.id, businessId]
  )).rows;
  for (const recipient of recipients) {
    await client.query('INSERT INTO campaign_recipients (id,campaign_id,contact_id,message) VALUES ($1,$2,$3,$4)', [id('r'), copyId, recipient.contact_id, recipient.message]);
  }
  await log(client, { businessId, userId: source.created_by || '' }, 'campaign_recurring_spawned', { sourceCampaignId: source.id, campaignId: copyId, scheduledAt: scheduledAt.toISOString() });
  return copyId;
}
