import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

test("automation dispatch stops after opt-out or human takeover", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { enterSystemContext } = await import("../lib/db.js");
  const { assertAutomationDispatchAllowed } = await import("../lib/automation-dispatch.js");
  const suffix = crypto.randomBytes(8).toString("hex");
  const businessId = `test_automation_business_${suffix}`;
  const contactId = `test_automation_contact_${suffix}`;
  const flowId = `test_automation_flow_${suffix}`;
  const sessionId = `test_automation_session_${suffix}`;
  const conversationId = `test_automation_conversation_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query("INSERT INTO businesses (id,name,slug) VALUES ($1,'Automation test',$2)", [businessId, businessId]);
    await client.query(
      "INSERT INTO contacts (id,business_id,name,phone) VALUES ($1,$2,'Customer','15550002222')",
      [contactId, businessId]
    );
    await client.query(
      "INSERT INTO automation_flows (id,business_id,name,status) VALUES ($1,$2,'Test flow','active')",
      [flowId, businessId]
    );
    await client.query(
      "INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id) VALUES ($1,$2,$3,$4,'start')",
      [sessionId, businessId, contactId, flowId]
    );
    await client.query(
      "INSERT INTO conversations (id,business_id,contact_id) VALUES ($1,$2,$3)",
      [conversationId, businessId, contactId]
    );

    enterSystemContext();
    const context = { businessId, contactId, sessionId };
    await assert.doesNotReject(assertAutomationDispatchAllowed(context));
    await client.query("UPDATE contacts SET unsubscribed=TRUE WHERE id=$1", [contactId]);
    await assert.rejects(assertAutomationDispatchAllowed(context), { code: "AUTOMATION_OPTED_OUT" });
    await client.query("UPDATE contacts SET unsubscribed=FALSE WHERE id=$1", [contactId]);
    await client.query("UPDATE conversations SET automation_paused=TRUE WHERE id=$1", [conversationId]);
    await assert.rejects(assertAutomationDispatchAllowed(context), { code: "AUTOMATION_SUPERSEDED" });
    await client.query("UPDATE conversations SET automation_paused=FALSE WHERE id=$1", [conversationId]);
    await client.query("UPDATE automation_sessions SET status='handoff' WHERE id=$1", [sessionId]);
    await assert.rejects(assertAutomationDispatchAllowed(context), { code: "AUTOMATION_SUPERSEDED" });
  } finally {
    await client.query("DELETE FROM businesses WHERE id=$1", [businessId]);
    await client.end();
  }
});
