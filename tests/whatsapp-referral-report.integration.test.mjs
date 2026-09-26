import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

test("WhatsApp referral report never counts another company's conversations", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { enterSystemContext } = await import("../lib/db.js");
  const { referralSummaryForBusiness } = await import("../lib/whatsapp-referral-report.js");
  const suffix = crypto.randomBytes(8).toString("hex");
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const businesses = [`ref_a_${suffix}`, `ref_b_${suffix}`];
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    for (let index = 0; index < 2; index++) {
      const businessId = businesses[index];
      const contactId = `ref_contact_${index}_${suffix}`;
      await client.query("INSERT INTO businesses(id,name,slug) VALUES($1,'Referral test',$1)", [businessId]);
      await client.query("INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,'Test',$3)", [contactId, businessId, `1555${suffix.slice(0, 8)}${index}`]);
      await client.query(
        "INSERT INTO conversations(id,business_id,contact_id,first_referral,first_referral_at) VALUES($1,$2,$3,$4,NOW())",
        [`ref_conversation_${index}_${suffix}`, businessId, contactId, JSON.stringify({ sourceType: "AD", sourceId: String(index + 1) })]
      );
    }
    enterSystemContext();
    const first = await referralSummaryForBusiness(businesses[0], 30);
    assert.equal(first.length, 1);
    assert.equal(first[0].sourceId, "1");
    assert.equal(first[0].conversations, 1);
  } finally {
    await client.query("DELETE FROM businesses WHERE id=ANY($1)", [businesses]);
    await client.end();
  }
});
