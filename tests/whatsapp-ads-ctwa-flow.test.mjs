import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCtwaAdFlow,
  ctwaAdFlowEligibility,
  whatsappAdCtwaFlowWelcomeMessage,
  whatsappAdPayload
} from '../lib/whatsapp-ads.js';

const baseInput = {
  name: 'Owner campaign',
  headline: 'Headline',
  text: 'Ad body',
  dailyBudget: '100',
  countries: ['IN'],
  ageMin: 18,
  ageMax: 65,
  imageHash: 'a'.repeat(32)
};
const connection = { currency: 'INR', page_id: '777' };
const number = '919999999999';

function eligibleFlow(overrides = {}) {
  return {
    business_id: 'biz_1',
    status: 'published',
    meta_flow_id: '987654321',
    validation_errors: [],
    endpoint_uri: '',
    endpoint_phone_id: 'phone_meta_1',
    flow_json: {
      version: '6.0',
      screens: [{
        id: 'FORM',
        layout: {
          type: 'SingleColumnLayout',
          children: [{
            type: 'Form',
            name: 'form',
            children: [
              { type: 'TextInput', name: 'email', label: 'Email', required: true, 'input-type': 'email' },
              { type: 'Footer', label: 'Submit', 'on-click-action': { name: 'complete', payload: {} } }
            ]
          }]
        }
      }]
    },
    ...overrides
  };
}

test('CTWA Flow eligibility follows Meta static single-screen rules', () => {
  assert.equal(ctwaAdFlowEligibility(eligibleFlow()).eligible, true);
  assert.equal(ctwaAdFlowEligibility(eligibleFlow({ flow_json: { version: '5.0', screens: [] } })).eligible, false);
  assert.equal(ctwaAdFlowEligibility(eligibleFlow({ endpoint_uri: 'https://example.test/flow' })).eligible, false);
  assert.equal(ctwaAdFlowEligibility(eligibleFlow({
    flow_json: {
      version: '6.0',
      data_api_version: '3.0',
      screens: eligibleFlow().flow_json.screens
    }
  })).eligible, false);
  assert.equal(ctwaAdFlowEligibility(eligibleFlow({
    flow_json: {
      version: '6.0',
      screens: [
        eligibleFlow().flow_json.screens[0],
        { ...eligibleFlow().flow_json.screens[0], id: 'OTHER' }
      ]
    }
  })).eligible, false);
});

test('assertCtwaAdFlow enforces tenant and connected phone binding', () => {
  assert.equal(assertCtwaAdFlow(eligibleFlow(), 'biz_1', 'phone_meta_1'), '987654321');
  assert.throws(() => assertCtwaAdFlow(eligibleFlow(), 'other_biz', 'phone_meta_1'), { code: 'NOT_FOUND' });
  assert.throws(() => assertCtwaAdFlow(eligibleFlow(), 'biz_1', 'other_phone'), { code: 'ADS_FLOW_PHONE_MISMATCH' });
});

test('whatsappAdPayload adds ctwa_flows welcome message for Click to WhatsApp', () => {
  const welcome = whatsappAdCtwaFlowWelcomeMessage({
    greetingText: 'Tell us about your project',
    flowCta: 'Apply now',
    metaFlowId: '987654321',
    autofillMessage: 'Hello! Can I get more info on this?'
  });
  assert.equal(welcome.landing_screen_type, 'ctwa_flows');
  assert.equal(welcome.text_format.message.automated_greeting_message_cta.flow_data.flow_id, '987654321');

  const result = whatsappAdPayload(
    baseInput,
    connection,
    number,
    {
      nativeFlowId: 'flow_local_1',
      metaFlowId: '987654321',
      greetingText: 'Tell us about your project',
      flowCta: 'Apply now',
      autofillMessage: 'Hello! Can I get more info on this?'
    }
  );
  assert.equal(result.nativeFlowId, 'flow_local_1');
  assert.equal(
    result.creative.object_story_spec.link_data.page_welcome_message.text_format.customer_action_type,
    'whatsapp_flow'
  );
  assert.throws(() => whatsappAdPayload(
    { ...baseInput, objectiveKind: 'WEBSITE_TRAFFIC', websiteUrl: 'https://example.test' },
    connection,
    number,
    { metaFlowId: '987654321', greetingText: 'Hi', flowCta: 'Go', autofillMessage: 'Hi' }
  ), { code: 'ADS_PAYLOAD_INVALID' });
});
