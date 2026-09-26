import test from "node:test";
import assert from "node:assert/strict";
import { creditLinesPath } from "../lib/meta-credit-lines.js";

test("credit-line lookup is restricted to a configured Meta business ID", () => {
  assert.equal(creditLinesPath("123"), "123/extendedcredits?fields=id%2Clegal_entity_name");
  assert.throws(() => creditLinesPath("../other"), { code: "META_BUSINESS_ID_REQUIRED" });
});
