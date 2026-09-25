import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

test("login selects an accessible membership and rejects a suspended selection", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previousVerification = process.env.EMAIL_VERIFICATION_REQUIRED;
  process.env.EMAIL_VERIFICATION_REQUIRED = "false";
  const { hashPassword, loginAccount } = await import("../lib/auth.js");
  const suffix = crypto.randomBytes(8).toString("hex");
  const userId = `test_user_${suffix}`;
  const suspendedId = `test_suspended_${suffix}`;
  const activeId = `test_active_${suffix}`;
  const email = `workspace-${suffix}@example.test`;
  const password = crypto.randomBytes(24).toString("base64url");
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query("INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)", [userId, "Test user", email, hashPassword(password)]);
    await client.query("INSERT INTO businesses (id,name,slug,account_status) VALUES ($1,$2,$3,'suspended'),($4,$5,$6,'active')", [suspendedId, "Suspended", `suspended-${suffix}`, activeId, "Active", `active-${suffix}`]);
    await client.query("INSERT INTO memberships (id,user_id,business_id,role,created_at) VALUES ($1,$2,$3,'Agent',NOW()-INTERVAL '1 day'),($4,$2,$5,'Manager',NOW())", [`test_m1_${suffix}`, userId, suspendedId, `test_m2_${suffix}`, activeId]);
    const selected = await loginAccount({ email, password });
    assert.equal(selected.businessId, activeId);
    assert.equal(selected.role, "Manager");
    await assert.rejects(loginAccount({ email, password, businessId: suspendedId }), { code: "ACCOUNT_SUSPENDED" });
    await assert.rejects(loginAccount({ email, password, businessId: `unknown_${suffix}` }), { code: "NO_WORKSPACE" });
  } finally {
    await client.query("DELETE FROM businesses WHERE id=ANY($1)", [[suspendedId, activeId]]);
    await client.query("DELETE FROM users WHERE id=$1", [userId]);
    await client.end();
    if (previousVerification === undefined) delete process.env.EMAIL_VERIFICATION_REQUIRED;
    else process.env.EMAIL_VERIFICATION_REQUIRED = previousVerification;
  }
});
