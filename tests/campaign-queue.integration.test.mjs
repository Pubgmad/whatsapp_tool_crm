import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

test("campaign dispatch rejects an opted-out recipient and settles its final job", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { enterSystemContext } = await import("../lib/db.js");
  const { campaignDispatchState, updateCampaignCompletion } = await import("../lib/campaign-queue-safety.js");
  const suffix = crypto.randomBytes(8).toString("hex");
  const businessId = `test_campaign_business_${suffix}`;
  const contactId = `test_campaign_contact_${suffix}`;
  const templateId = `test_campaign_template_${suffix}`;
  const campaignId = `test_campaign_${suffix}`;
  const recipientId = `test_campaign_recipient_${suffix}`;
  const jobId = `test_campaign_job_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query(
      "INSERT INTO businesses (id,name,slug,account_status,review_access) VALUES ($1,'Campaign test',$2,'active',TRUE)",
      [businessId, businessId]
    );
    await client.query(
      "INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed) VALUES ($1,$2,'Opted out','15550001111',FALSE,TRUE)",
      [contactId, businessId]
    );
    await client.query(
      "INSERT INTO templates (id,business_id,name,body,status) VALUES ($1,$2,'Test template','Hello','Approved')",
      [templateId, businessId]
    );
    await client.query(
      "INSERT INTO campaigns (id,business_id,name,template_id,status) VALUES ($1,$2,'Test campaign',$3,'queued')",
      [campaignId, businessId, templateId]
    );
    await client.query(
      "INSERT INTO campaign_recipients (id,campaign_id,contact_id,message) VALUES ($1,$2,$3,'Hello')",
      [recipientId, campaignId, contactId]
    );
    await client.query(
      "INSERT INTO campaign_jobs (id,campaign_recipient_id) VALUES ($1,$2)",
      [jobId, recipientId]
    );
    const locked = await client.query(
      `SELECT j.id FROM campaign_jobs j
       JOIN campaign_recipients cr ON cr.id=j.campaign_recipient_id
       JOIN campaigns c ON c.id=cr.campaign_id
       LEFT JOIN business_subscriptions bs ON bs.business_id=c.business_id
       WHERE c.id=$1 FOR UPDATE OF j SKIP LOCKED`,
      [campaignId]
    );
    assert.equal(locked.rows[0].id, jobId);

    enterSystemContext();
    await assert.rejects(
      campaignDispatchState({ campaignId, businessId, contactId }),
      { code: "RECIPIENT_OPTED_OUT" }
    );
    await client.query("UPDATE campaign_jobs SET status='failed' WHERE id=$1", [jobId]);
    await client.query("UPDATE campaign_recipients SET status='failed',error_message='Recipient opted out before delivery.' WHERE id=$1", [recipientId]);
    await updateCampaignCompletion(client, campaignId, businessId);
    const result = await client.query(
      `SELECT c.status AS campaign_status, cr.status AS recipient_status, cr.error_message,
              j.status AS job_status
       FROM campaigns c JOIN campaign_recipients cr ON cr.campaign_id=c.id
       JOIN campaign_jobs j ON j.campaign_recipient_id=cr.id
       WHERE c.id=$1`,
      [campaignId]
    );
    assert.deepEqual(
      [result.rows[0].campaign_status, result.rows[0].recipient_status, result.rows[0].job_status],
      ["completed", "failed", "failed"]
    );
    assert.match(result.rows[0].error_message, /opted out/i);
  } finally {
    await client.query("DELETE FROM businesses WHERE id=$1", [businessId]);
    await client.end();
  }
});
