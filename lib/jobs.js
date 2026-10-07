import { AppError, errorJson, json } from "./db";
import { runCampaignQueue } from "./actions";
import { runAutomationQueue } from "./automation";
import { readOptionalJsonBodyLimited } from "./security";
import { monitorDueMetaConnections } from "./meta-health";
import {runWorkspaceWebhooks} from './workspace-integrations.js';
import {runCommerceAutomation} from './commerce-automation.js';
import {runSupportQueue} from './support-policy.js';
import {runProviderConnectorEvents,runCheckoutRecovery} from './provider-connectors.js';
import {runMetaWebhookQueue} from './meta-webhook-queue.js';
import {runDueHubSpotSync} from './hubspot-contacts.js';
import {runDueSalesforceSync} from './salesforce-contacts.js';
import {runDueCrmOutboundPush} from './crm-contact-export.js';
import {runCalendarFulfillment} from './calendar-fulfillment.js';
import {runBookingNotices} from './booking-notices.js';
import {runDueShopifyOrderCheck} from './shopify-drafts.js';
import {runDueAiAutoReply} from './ai-auto-replies.js';
import {runIsolatedJobs} from './job-isolation.js';

import { query } from './db.js';

function clean(value) {
  return String(value || "").trim();
}

export async function processAllQueuesJob(request) {
  try {
    const { enterSystemContext } = await import('./db');
    enterSystemContext();
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const { runRetentionJobs } = await import('./retention');
    const businessId = clean(body.businessId);
    const limit=body.limit===undefined?25:Number(body.limit);
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new AppError('Invalid job batch size.',400,'INVALID_JOB_LIMIT');
    const reportFailure=(job,code)=>console.error('Queue job failed',{job,code});
    const webhookRun=await runIsolatedJobs([['metaWebhooks',()=>runMetaWebhookQueue({limit})]],reportFailure);
    const remaining=await runIsolatedJobs([
      ['commerce',()=>runCommerceAutomation()],
      ['support',()=>runSupportQueue()],
      ['connectors',()=>runProviderConnectorEvents()],
      ['checkoutRecovery',()=>runCheckoutRecovery({limit})],
      ['crmSync',()=>runDueHubSpotSync()],
      ['salesforceSync',()=>runDueSalesforceSync()],
      ['crmOutbound',()=>runDueCrmOutboundPush({limit})],
      ['calendarFulfillment',()=>runCalendarFulfillment()],
      ['bookingNotices',()=>runBookingNotices()],
      ['shopifyOrderCheck',()=>runDueShopifyOrderCheck()],
      ['aiAutoReply',()=>runDueAiAutoReply()],
      ['campaigns',()=>runCampaignQueue({businessId,limit})],
      ['automation',()=>runAutomationQueue({businessId,limit})],
      ['retention',()=>body.runRetention===false?null:runRetentionJobs()],
      ['metaHealth',()=>monitorDueMetaConnections()],
      ['integrations',()=>runWorkspaceWebhooks()]
    ],reportFailure,4);
    const results={...webhookRun.results,...remaining.results};
    const errors={...webhookRun.errors,...remaining.errors};
    await query(
      `INSERT INTO worker_heartbeats (worker_name,last_success_at,last_cycle_errors) VALUES ('queue',NOW(),$1::jsonb)
       ON CONFLICT (worker_name) DO UPDATE SET last_success_at=NOW(),last_cycle_errors=EXCLUDED.last_cycle_errors,updated_at=NOW()`,
      [JSON.stringify(errors)]
    );
    return json({ok:Object.keys(errors).length===0,...results,errors},Object.keys(errors).length?503:200);
  } catch (error) {
    return errorJson(error);
  }
}
