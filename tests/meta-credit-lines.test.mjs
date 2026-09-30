import test from "node:test";
import assert from "node:assert/strict";
import { creditLinesPath,creditAttachPayload } from "../lib/meta-credit-lines.js";

test("credit-line lookup is restricted to a configured Meta business ID", () => {
  assert.equal(creditLinesPath("123"), "123/extendedcredits?fields=id%2Clegal_entity_name");
  assert.throws(() => creditLinesPath("../other"), { code: "META_BUSINESS_ID_REQUIRED" });
});

test('credit sharing requires valid billing assets and explicit account confirmation',()=>{
  assert.deepEqual(creditAttachPayload('123','INR','123'),{waba_id:'123',waba_currency:'INR'});
  assert.throws(()=>creditAttachPayload('123','INR','456'),{code:'META_CREDIT_CONFIRMATION_REQUIRED'});
  for(const [waba,currency] of [['../other','INR'],['123','inr'],['123','']])
    assert.throws(()=>creditAttachPayload(waba,currency,waba),{code:'META_CREDIT_ASSETS_INVALID'});
});
