import test from "node:test";
import assert from "node:assert/strict";
import { workerIsFresh,databaseRoleIsIsolated } from "../lib/health.js";

test("readiness rejects missing and stale worker heartbeats", () => {
  const now = Date.now();
  assert.equal(workerIsFresh(null, now), false);
  assert.equal(workerIsFresh(new Date(now - 10000), now), true);
  assert.equal(workerIsFresh(new Date(now - 120000), now), false);
  assert.equal(workerIsFresh(new Date(now + 10000), now), false);
});

test('readiness refuses a superuser or RLS-bypass database login',()=>{
  assert.equal(databaseRoleIsIsolated({rolsuper:false,rolbypassrls:false}),true);
  assert.equal(databaseRoleIsIsolated({rolsuper:true,rolbypassrls:false}),false);
  assert.equal(databaseRoleIsIsolated({rolsuper:false,rolbypassrls:true}),false);
  assert.equal(databaseRoleIsIsolated(null),false);
});
