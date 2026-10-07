import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogflowPlatformConfigured } from '../lib/dialogflow-bot.js';

test('dialogflowPlatformConfigured requires project and service account JSON', () => {
  const previousProject = process.env.DIALOGFLOW_PROJECT_ID;
  const previousJson = process.env.GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON;
  delete process.env.DIALOGFLOW_PROJECT_ID;
  delete process.env.GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON;
  assert.equal(dialogflowPlatformConfigured(), false);
  process.env.DIALOGFLOW_PROJECT_ID = 'my-gcp-project';
  process.env.GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON = '{"client_email":"a@b.iam.gserviceaccount.com","private_key":"x","token_uri":"https://oauth2.googleapis.com/token"}';
  assert.equal(dialogflowPlatformConfigured(), true);
  process.env.DIALOGFLOW_PROJECT_ID = previousProject;
  process.env.GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON = previousJson;
});
