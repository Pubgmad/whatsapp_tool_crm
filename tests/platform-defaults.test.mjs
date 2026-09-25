import test from "node:test";
import assert from "node:assert/strict";
import { defaultPlatformConfig } from "../lib/platform.js";

test("initial platform branding reads deployment configuration", () => {
  const previous = {
    brand: process.env.PLATFORM_BRAND_NAME,
    company: process.env.PLATFORM_COMPANY_NAME,
    support: process.env.PLATFORM_SUPPORT_EMAIL
  };
  try {
    process.env.PLATFORM_BRAND_NAME = "Custom CRM";
    process.env.PLATFORM_COMPANY_NAME = "Custom Company";
    process.env.PLATFORM_SUPPORT_EMAIL = "support@example.test";
    const config = defaultPlatformConfig();
    assert.equal(config.brand_name, "Custom CRM");
    assert.equal(config.company_name, "Custom Company");
    assert.equal(config.support_email, "support@example.test");
  } finally {
    if (previous.brand === undefined) delete process.env.PLATFORM_BRAND_NAME;
    else process.env.PLATFORM_BRAND_NAME = previous.brand;
    if (previous.company === undefined) delete process.env.PLATFORM_COMPANY_NAME;
    else process.env.PLATFORM_COMPANY_NAME = previous.company;
    if (previous.support === undefined) delete process.env.PLATFORM_SUPPORT_EMAIL;
    else process.env.PLATFORM_SUPPORT_EMAIL = previous.support;
  }
});
