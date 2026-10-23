import { AppError } from './db.js';

/**
 * Permission groups used by this app, checked against Meta documentation on 2026-10-23.
 *
 * Click-to-WhatsApp creation:
 * https://developers.facebook.com/docs/marketing-api/ad-creative/messaging-ads/click-to-whatsapp/
 * requires ads_management, pages_manage_ads, pages_read_engagement, pages_show_list.
 *
 * Embedded Signup v4 lists those scopes plus ads_read for the CTWA product row:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/
 * ads_read is not a dependency of ads_management
 * (https://developers.facebook.com/documentation/development/permissions).
 * This app treats ads_read as the reporting capability. The default connect request
 * includes it. Missing ads_read blocks reporting calls and does not block CTWA creation.
 *
 * Lead retrieval:
 * https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving
 * adds leads_retrieval. pages_manage_metadata is required only to subscribe the Page
 * to leadgen webhooks.
 *
 * business_management is for Business Manager asset APIs
 * (https://developers.facebook.com/docs/marketing-api/get-started/authorization/).
 * This app lists assets with /me/adaccounts and /me/accounts and does not call those APIs,
 * so the capability is not requested and is not treated as granted.
 */

export const ADS_CAPABILITY_GROUPS = Object.freeze({
  ctwa: Object.freeze({
    id: 'ctwa',
    label: 'Click-to-WhatsApp campaign creation and management',
    scopes: Object.freeze(['ads_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads']),
    optional: false,
    implemented: true
  }),
  reporting: Object.freeze({
    id: 'reporting',
    label: 'Ads reporting',
    scopes: Object.freeze(['ads_read']),
    optional: true,
    implemented: true
  }),
  leads: Object.freeze({
    id: 'leads',
    label: 'Lead-form retrieval and Page lead subscriptions',
    scopes: Object.freeze(['leads_retrieval', 'pages_manage_metadata']),
    optional: true,
    implemented: true
  }),
  business_assets: Object.freeze({
    id: 'business_assets',
    label: 'Business asset management',
    scopes: Object.freeze(['business_management']),
    optional: true,
    implemented: false
  })
});

export const ADS_DEFAULT_REQUESTED = Object.freeze(['ctwa', 'reporting']);

/** Scopes requested for a default CTWA + reporting connect. Lead scopes are not included. */
export const ADS_REQUIRED_SCOPES = Object.freeze([
  ...ADS_CAPABILITY_GROUPS.ctwa.scopes,
  ...ADS_CAPABILITY_GROUPS.reporting.scopes
]);

export function parseRequestedCapabilities(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const chosen = [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))];
  const requested = chosen.length ? chosen : [...ADS_DEFAULT_REQUESTED];
  if (!requested.includes('ctwa')) requested.unshift('ctwa');
  for (const id of requested) {
    const group = ADS_CAPABILITY_GROUPS[id];
    if (!group) {
      throw new AppError(`Unknown ads capability "${id}".`, 400, 'ADS_CAPABILITY_UNKNOWN');
    }
    if (group.implemented === false) {
      throw new AppError(`${group.label} is not available in this product.`, 400, 'ADS_CAPABILITY_UNAVAILABLE');
    }
  }
  return requested;
}

export function scopesForCapabilities(ids) {
  const scopes = [];
  for (const id of ids) {
    for (const scope of ADS_CAPABILITY_GROUPS[id].scopes) {
      if (!scopes.includes(scope)) scopes.push(scope);
    }
  }
  return scopes;
}

export function permissionReportFromScopes(scopes = [], requested = ADS_DEFAULT_REQUESTED) {
  const granted = [...new Set((scopes || []).map(String))];
  const grantedSet = new Set(granted);
  const requestedIds = requested?.length ? [...requested] : [...ADS_DEFAULT_REQUESTED];
  const capabilities = {};
  for (const [id, group] of Object.entries(ADS_CAPABILITY_GROUPS)) {
    if (group.implemented === false) {
      capabilities[id] = {
        status: 'not_applicable',
        label: group.label,
        missing: [],
        enabled: false,
        implemented: false,
        optional: true
      };
      continue;
    }
    const missing = group.scopes.filter((scope) => !grantedSet.has(scope));
    const asked = requestedIds.includes(id);
    let status = 'not_requested';
    if (asked && missing.length === 0) status = 'ready';
    else if (asked && group.optional) status = 'optional_unavailable';
    else if (asked) status = 'missing';
    else if (missing.length === 0) status = 'ready';
    capabilities[id] = {
      status,
      label: group.label,
      missing,
      enabled: missing.length === 0,
      optional: group.optional,
      implemented: true,
      reconnectRequired: asked && missing.length > 0 && !group.optional
    };
  }
  const missing = [];
  const optionalUnavailable = [];
  for (const id of requestedIds) {
    const capability = capabilities[id];
    if (!capability || capability.status === 'not_applicable') continue;
    if (capability.status === 'missing') missing.push(...capability.missing);
    if (capability.status === 'optional_unavailable') optionalUnavailable.push(...capability.missing);
  }
  return {
    required: scopesForCapabilities(requestedIds.filter((id) => !ADS_CAPABILITY_GROUPS[id].optional)),
    requestedCapabilities: requestedIds,
    granted,
    missing: [...new Set(missing)],
    optionalUnavailable: [...new Set(optionalUnavailable)],
    capabilities,
    complete: missing.length === 0,
    reconnectRequired: missing.length > 0,
    appReviewNote: 'Production use beyond Meta development assets requires App Review and Advanced Access. Connecting here does not grant that access.',
    liveVerification: missing.length ? 'blocked_scopes' : 'not_yet_verified'
  };
}

/**
 * Existing rows that never stored scopes keep working for CTWA and reporting.
 * They do not gain lead access, and a recorded empty scope list stays denied.
 */
export function deriveConnectionCapabilities(scopes, { scopesRecorded = false } = {}) {
  const report = permissionReportFromScopes(scopes || [], ['ctwa', 'reporting', 'leads']);
  if (!scopesRecorded) {
    report.capabilities.ctwa = {
      ...report.capabilities.ctwa,
      status: 'not_verified',
      enabled: true,
      grandfathered: true,
      missing: []
    };
    report.capabilities.reporting = {
      ...report.capabilities.reporting,
      status: 'not_verified',
      enabled: true,
      grandfathered: true,
      missing: []
    };
    report.capabilities.leads = {
      ...report.capabilities.leads,
      status: 'not_requested',
      enabled: false
    };
    report.complete = true;
    report.reconnectRequired = false;
    report.grandfathered = true;
    report.missing = [];
  }
  return report;
}

export function reportForStoredConnection(connection = {}) {
  if (connection.authorization_status === 'revoked') {
    return {
      revoked: true,
      complete: false,
      reconnectRequired: true,
      missing: [],
      capabilities: {},
      granted: []
    };
  }
  const scopes = Array.isArray(connection.token_scopes) ? connection.token_scopes : [];
  const scopesRecorded = Boolean(connection.permissions_checked_at) || scopes.length > 0;
  return deriveConnectionCapabilities(scopes, { scopesRecorded });
}

export function assertAdsCapability(connection, capability) {
  const report = reportForStoredConnection(connection);
  if (report.revoked) {
    throw new AppError('Meta advertising authorization was revoked. Reconnect with Facebook Login.', 409, 'META_AUTHORIZATION_REVOKED');
  }
  const current = report.capabilities?.[capability];
  if (current?.enabled) return report;
  const missing = (current?.missing || []).join(', ') || capability;
  const label = current?.label || capability;
  throw new AppError(
    `${label} is not available (${missing}). Reconnect Facebook Login and approve that capability. Lead access is optional and is not required for Click-to-WhatsApp.`,
    403,
    'META_CAPABILITY_MISSING'
  );
}

export function nextGraphPath(path, paging) {
  const after = paging?.cursors?.after;
  if (!paging?.next || !after) return '';
  const [base, query = ''] = String(path).split('?');
  const params = new URLSearchParams(query);
  params.set('after', after);
  params.delete('access_token');
  return `${base}?${params.toString()}`;
}
