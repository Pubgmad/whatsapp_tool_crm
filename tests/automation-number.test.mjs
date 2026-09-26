import assert from "node:assert/strict";
import test from "node:test";
import { automationMessagingSetup } from "../lib/automation-number.js";

test("automation replies use the conversation's connected WhatsApp number", () => {
  const job = {
    phone_number_id: "default-phone",
    waba_id: "default-waba",
    access_token_encrypted: "default-token",
    conversation_phone_number_id: "source-phone",
    source_phone_number_id: "source-phone",
    source_waba_id: "source-waba",
    source_access_token_encrypted: "source-token"
  };
  assert.deepEqual(
    (({ phone_number_id, waba_id, access_token_encrypted }) => ({ phone_number_id, waba_id, access_token_encrypted }))(automationMessagingSetup(job)),
    { phone_number_id: "source-phone", waba_id: "source-waba", access_token_encrypted: "source-token" }
  );
  assert.equal(job.phone_number_id, "default-phone");
});

test("automation fails closed when a secondary number is disconnected", () => {
  const job = { phone_number_id: "default-phone", conversation_phone_number_id: "source-phone" };
  assert.throws(() => automationMessagingSetup(job), { code: "META_SOURCE_DISCONNECTED" });
  assert.equal(automationMessagingSetup({ phone_number_id: "default-phone" }).phone_number_id, "default-phone");
});
