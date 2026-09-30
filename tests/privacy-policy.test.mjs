import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DEFAULT_PRIVACY_POLICY, validatePrivacyDocument } from "../lib/privacy-policy.js";

test("privacy policy accepts structured text and preserves support placeholders", () => {
  const policy = validatePrivacyDocument(DEFAULT_PRIVACY_POLICY);
  assert.equal(policy.sections.length, 10);
  assert.match(policy.sections[0].paragraphs[1], /{{support_email}}/);
});

test("privacy policy rejects empty, oversized, and malformed sections", () => {
  assert.throws(() => validatePrivacyDocument({ title: "", intro: "Intro", sections: DEFAULT_PRIVACY_POLICY.sections }), { code: "VALIDATION_ERROR" });
  assert.throws(() => validatePrivacyDocument({ ...DEFAULT_PRIVACY_POLICY, sections: [] }), { code: "VALIDATION_ERROR" });
  assert.throws(() => validatePrivacyDocument({ ...DEFAULT_PRIVACY_POLICY, sections: [{ heading: "Empty", paragraphs: [], bullets: [] }] }), { code: "VALIDATION_ERROR" });
  assert.throws(() => validatePrivacyDocument({ ...DEFAULT_PRIVACY_POLICY, sections: [{ heading: "Wrong", paragraphs: [{}], bullets: [] }] }), { code: "VALIDATION_ERROR" });
  assert.throws(() => validatePrivacyDocument({ ...DEFAULT_PRIVACY_POLICY, intro: "x".repeat(5001) }), { code: "VALIDATION_ERROR" });
});

test("database initializer publishes the existing policy and creates a separate draft", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const published = await client.query("SELECT version,document,effective_date FROM privacy_policy_versions ORDER BY version DESC LIMIT 1");
    const draft = await client.query("SELECT document,revision FROM privacy_policy_drafts WHERE id='current'");
    assert.equal(published.rows[0].version, 1);
    assert.equal(draft.rows[0].revision, 1);
    assert.deepEqual(draft.rows[0].document, published.rows[0].document);
    assert.ok(published.rows[0].effective_date);
  } finally {
    await client.end();
  }
});
