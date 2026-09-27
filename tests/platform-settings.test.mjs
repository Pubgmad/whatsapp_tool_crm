import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlatformValue } from "../lib/platform.js";

test("boolean settings accept explicit true and false values", () => {
  assert.equal(normalizePlatformValue("true", "boolean"), true);
  assert.equal(normalizePlatformValue("false", "boolean"), false);
  assert.equal(normalizePlatformValue(false, "boolean"), false);
  assert.throws(() => normalizePlatformValue("yes", "boolean"), { code: "VALIDATION_ERROR" });
});

test("number settings reject empty and non-finite values", () => {
  assert.equal(normalizePlatformValue("0", "number"), 0);
  assert.equal(normalizePlatformValue("90", "number"), 90);
  assert.throws(() => normalizePlatformValue("", "number"), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizePlatformValue("  ", "number"), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizePlatformValue("Infinity", "number"), { code: "VALIDATION_ERROR" });
});

test("JSON settings return a validation error for malformed input", () => {
  assert.deepEqual(normalizePlatformValue('{"enabled":true}', "json"), { enabled: true });
  assert.throws(() => normalizePlatformValue("{", "json"), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizePlatformValue(undefined, "json"), { code: "VALIDATION_ERROR" });
});
