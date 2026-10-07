import assert from 'node:assert/strict';
import test from 'node:test';
import {canAutoReply} from '../lib/ai-auto-replies.js';

test('automatic replies yield to agents, automation, opt-out, closed windows and newer messages',()=>{
  const job={status:'processing',inbound_message_id:'m_1'};
  const conversation={status:'open',assigned_user_id:null,automation_paused:false};
  const contact={unsubscribed:false,last_message_at:new Date().toISOString()};
  const latest={id:'m_1',direction:'incoming',message_type:'text',body:'What is your return policy?'};
  const eligible={job,conversation,contact,latest,automationActive:false};
  assert.equal(canAutoReply(eligible),true);
  assert.equal(canAutoReply({...eligible,conversation:{...conversation,assigned_user_id:'agent'}}),false);
  assert.equal(canAutoReply({...eligible,conversation:{...conversation,automation_paused:true}}),false);
  assert.equal(canAutoReply({...eligible,automationActive:true}),false);
  assert.equal(canAutoReply({...eligible,contact:{...contact,unsubscribed:true}}),false);
  assert.equal(canAutoReply({...eligible,contact:{...contact,last_message_at:'2020-01-01T00:00:00Z'}}),false);
  assert.equal(canAutoReply({...eligible,latest:{...latest,id:'m_2'}}),false);
  assert.equal(canAutoReply({...eligible,latest:{...latest,direction:'outgoing'}}),false);
});
