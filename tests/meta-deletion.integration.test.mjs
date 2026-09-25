import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

test("Meta deletion disconnects tokens and reuses a pending confirmation on retry", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previousSecret = process.env.META_APP_SECRET;
  const previousAppUrl = process.env.APP_URL;
  const secret = crypto.randomBytes(32).toString("hex");
  process.env.META_APP_SECRET = secret;
  process.env.APP_URL = "https://crm.example.test";
  const { handleMetaDataDeletion } = await import("../lib/meta-data-controls.js");
  const suffix = crypto.randomBytes(8).toString("hex");
  const businessId = `test_b_${suffix}`;
  const metaUserId = `test_meta_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  let confirmationCode = "";
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query("INSERT INTO businesses (id,name,slug,waba_id,phone_number_id,access_token_encrypted,status) VALUES ($1,$2,$3,$4,$5,$6,'Connected')", [businessId, "Deletion test", `deletion-${suffix}`, `waba_${suffix}`, `phone_${suffix}`, "encrypted-test-value"]);
    await client.query("INSERT INTO meta_authorizations (id,business_id,meta_user_id) VALUES ($1,$2,$3)", [`test_ma_${suffix}`, businessId, metaUserId]);
    await client.query("INSERT INTO whatsapp_accounts (id,business_id,waba_id,access_token_encrypted) VALUES ($1,$2,$3,$4)", [`test_wa_${suffix}`, businessId, `waba_${suffix}`, "encrypted-test-value"]);
    const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: metaUserId })).toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const request = () => new Request("https://crm.example.test/api/meta/data-deletion", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ signed_request: `${signature}.${payload}` })
    });
    const first = await handleMetaDataDeletion(request());
    assert.equal(first.status, 200);
    confirmationCode = (await first.json()).confirmation_code;
    const second = await handleMetaDataDeletion(request());
    assert.equal(second.status, 200);
    assert.equal((await second.json()).confirmation_code, confirmationCode);
    const record = await client.query("SELECT status,businesses_affected FROM meta_data_deletion_requests WHERE confirmation_code=$1", [confirmationCode]);
    assert.equal(record.rows[0].status, "pending");
    assert.equal(record.rows[0].businesses_affected, 1);
    const business = await client.query("SELECT access_token_encrypted FROM businesses WHERE id=$1", [businessId]);
    assert.equal(business.rows[0].access_token_encrypted, "");
    const accounts = await client.query("SELECT COUNT(*)::int AS total FROM whatsapp_accounts WHERE business_id=$1", [businessId]);
    assert.equal(accounts.rows[0].total, 0);
  } finally {
    if (confirmationCode) await client.query("DELETE FROM meta_data_deletion_requests WHERE confirmation_code=$1", [confirmationCode]);
    await client.query("DELETE FROM businesses WHERE id=$1", [businessId]);
    await client.end();
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});
