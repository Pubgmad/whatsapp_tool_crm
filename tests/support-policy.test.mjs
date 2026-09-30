import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupportPolicy,supportIsOpen} from '../lib/support-rules.js';

const policy=()=>({enabled:true,mode:'round_robin',scope:'handoff',timezone:'Asia/Kolkata',alwaysOpen:false,agentIds:['agent'],maxOpen:5,slaMinutes:30,escalationUserId:null,hours:[{day:1,start:'09:00',end:'17:00'}]});
test('support policies validate explicit agents, hours, capacity and timezone',()=>{
  assert.equal(validateSupportPolicy(policy()).maxOpen,5);
  for(const changes of [{agentIds:[]},{agentIds:['agent','agent']},{timezone:'invalid'},{slaMinutes:0},{maxOpen:1.5},{hours:[{day:1,start:'17:00',end:'09:00'}]},{enabled:'true'}])assert.throws(()=>validateSupportPolicy({...policy(),...changes}));
});
test('business hours use company timezone and exclusive closing boundary',()=>{
  const p=validateSupportPolicy(policy());
  assert.equal(supportIsOpen(p,new Date('2026-09-28T03:30:00Z')),true);
  assert.equal(supportIsOpen(p,new Date('2026-09-28T11:30:00Z')),false);
  assert.equal(supportIsOpen(p,new Date('2026-09-27T03:30:00Z')),false);
  assert.equal(supportIsOpen({...p,alwaysOpen:true},new Date('2026-09-27T03:30:00Z')),true);
});
