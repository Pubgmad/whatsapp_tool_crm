import test from 'node:test';
import assert from 'node:assert/strict';
import {jobFailureCode,runIsolatedJobs} from '../lib/job-isolation.js';

test('queue failures do not stop independent jobs and expose only safe codes',async()=>{
  const observed=[];
  const result=await runIsolatedJobs([
    ['webhooks',async()=>{throw Object.assign(new Error('secret data'),{code:'META_RATE_LIMIT'});}],
    ['campaigns',async()=>({claimed:2})],
    ['aiAutoReply',async()=>{throw Object.assign(new Error('secret data'),{code:'secret value'});}]
  ],(job,code)=>observed.push([job,code]),2);
  assert.deepEqual(result.results,{campaigns:{claimed:2}});
  assert.deepEqual(result.errors,{webhooks:'META_RATE_LIMIT',aiAutoReply:'JOB_FAILED'});
  assert.deepEqual(observed.sort(),[['aiAutoReply','JOB_FAILED'],['webhooks','META_RATE_LIMIT']]);
  assert.equal(jobFailureCode({code:'A'.repeat(81)}),'JOB_FAILED');
  await assert.rejects(runIsolatedJobs([],()=>{},9),TypeError);
});
