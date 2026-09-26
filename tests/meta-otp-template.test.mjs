import test from "node:test";
import assert from "node:assert/strict";
import { createWhatsAppTemplate, encryptSecret } from "../lib/meta.js";

test("authentication templates send verified OTP button payloads", async (context) => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ENCRYPTION_KEY = "test-only-otp-key";
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });
  const setup = {
    waba_id: "123",
    phone_number_id: "456",
    access_token_encrypted: encryptSecret("test-only-token")
  };
  let submitted;
  globalThis.fetch = async (_url, options) => {
    submitted = JSON.parse(options.body);
    return Response.json({ id: "template-id", status: "PENDING" });
  };
  await createWhatsAppTemplate({
    setup, name: "login code", body: "Your verification code",
    category: "AUTHENTICATION",
    componentSchema: {
      otpType: "ONE_TAP",
      otpPackageName: "com.example.app",
      otpSignatureHash: "K8a/AINcGX7",
      otpAutofillText: "Autofill"
    }
  });
  assert.equal(submitted.name, "login_code");
  assert.deepEqual(submitted.components[2].buttons[0], {
    type: "OTP", otp_type: "ONE_TAP", text: "Copy code",
    autofill_text: "Autofill", package_name: "com.example.app",
    signature_hash: "K8a/AINcGX7"
  });
  submitted = undefined;
  await assert.rejects(
    createWhatsAppTemplate({
      setup, name: "invalid", body: "Code", category: "AUTHENTICATION",
      componentSchema: { otpType: "ONE_TAP" }
    }),
    { code: "OTP_ANDROID_DETAILS_REQUIRED" }
  );
  assert.equal(submitted, undefined);
  await assert.rejects(
    createWhatsAppTemplate({
      setup, name: "unsupported", body: "Code", category: "AUTHENTICATION",
      componentSchema: { otpType: "ZERO_TAP" }
    }),
    { code: "OTP_ACTION_UNSUPPORTED" }
  );
});
