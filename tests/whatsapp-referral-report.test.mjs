import test from "node:test";
import assert from "node:assert/strict";
import { referralReportDays } from "../lib/whatsapp-referral-report.js";

test("WhatsApp referral periods are bounded", () => {
  assert.equal(referralReportDays(null), 30);
  assert.equal(referralReportDays("7"), 7);
  assert.throws(() => referralReportDays("1000"), { code: "INVALID_REPORT_PERIOD" });
  assert.throws(() => referralReportDays("-1"), { code: "INVALID_REPORT_PERIOD" });
});
