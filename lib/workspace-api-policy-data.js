/**
 * Mutating workspace API routes must include an explicit role guard in the route or delegated handler.
 * Values: manager | owner | session (any member) | public | worker
 */
export const WORKSPACE_API_ROUTE_POLICY = Object.freeze([
  { path: 'app/api/campaigns/route.js', method: 'POST', role: 'manager', guard: 'createCampaign' },
  { path: 'app/api/campaigns/policy/route.js', method: 'PUT', role: 'manager', guard: 'campaignPolicyEndpoint' },
  { path: 'app/api/templates/sync/route.js', method: 'POST', role: 'manager', guard: 'syncTemplatesFromMeta' },
  { path: 'app/api/workspace/production-hub/route.js', method: 'GET', role: 'manager', guard: 'workspaceRoute' },
  { path: 'app/api/workspace/production-pending/route.js', method: 'GET', role: 'manager', guard: 'workspaceRoute' },
  { path: 'app/api/workspace/inbox/route.js', method: 'GET', role: 'session', guard: 'workspaceRoute' },
  { path: 'app/api/workspace/journey-report/route.js', method: 'GET', role: 'manager', guard: 'workspaceRoute' },
  { path: 'app/api/automation/simulate/route.js', method: 'POST', role: 'manager', guard: 'requireWorkspaceManager' },
  { path: 'app/api/conversations/[id]/workflow/route.js', method: 'PATCH', role: 'session', guard: 'updateConversationWorkflow' },
  { path: 'app/api/messages/reply/route.js', method: 'POST', role: 'session', guard: 'sendReply' },
  { path: 'app/api/billing/change-plan/route.js', method: 'POST', role: 'owner', guard: 'changeSubscriptionPlan' },
  { path: 'app/api/integrations/route.js', method: 'POST', role: 'owner', guard: 'integrationSettings' }
]);
