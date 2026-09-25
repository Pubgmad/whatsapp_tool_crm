import test from "node:test";
import assert from "node:assert/strict";
import { workerIsFresh } from "../lib/health.js";

test("readiness rejects missing and stale worker heartbeats", () => {
  const now = Date.now();
  assert.equal(workerIsFresh(null, now), false);
  assert.equal(workerIsFresh(new Date(now - 10000), now), true);
  assert.equal(workerIsFresh(new Date(now - 120000), now), false);
  assert.equal(workerIsFresh(new Date(now + 10000), now), false);
});
