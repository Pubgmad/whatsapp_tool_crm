import assert from 'node:assert/strict';
import test from 'node:test';
import {bookingNoticeFailureStatus} from '../lib/booking-notices.js';

test('booking notices distinguish definitive Meta rejection from uncertain delivery',()=>{
  assert.equal(bookingNoticeFailureStatus(false,'',new Error('Subscription limit')),'failed');
  assert.equal(bookingNoticeFailureStatus(true,'',{code:'META_SEND_FAILED',status:400}),'failed');
  assert.equal(bookingNoticeFailureStatus(true,'',{code:'META_SEND_FAILED',status:429}),'unconfirmed');
  assert.equal(bookingNoticeFailureStatus(true,'wamid.sent',new Error('Database unavailable')),'unconfirmed');
});
