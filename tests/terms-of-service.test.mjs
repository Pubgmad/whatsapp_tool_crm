import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TERMS_OF_SERVICE, getTermsOfService } from "../lib/terms-of-service.js";

test("terms of service exposes a public document with support placeholders", () => {
  const { document, effectiveDate } = getTermsOfService();
  assert.equal(document.title, "Terms of Service");
  assert.ok(effectiveDate);
  assert.equal(document.sections.length, DEFAULT_TERMS_OF_SERVICE.sections.length);
  assert.match(document.intro, /{{company_name}}/);
  assert.match(document.sections.at(-1).paragraphs[0], /{{support_email}}/);
});
