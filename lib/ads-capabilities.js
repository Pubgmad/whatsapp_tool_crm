import { AppError, query } from './db.js';
import { decryptSecret } from './meta.js';

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
        optional: true,
        verification_status: 'not_applicable'
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
      reconnectRequired: asked && missing.length > 0 && !group.optional,
      verification_status: missing.length === 0 ? 'verified' : 'missing'
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
    verification_status: 'verified',
    appReviewNote: 'Production use beyond Meta development assets requires App Review and Advanced Access. Connecting here does not grant that access.',
    liveVerification: missing.length ? 'blocked_scopes' : 'verified'
  };
}

/**
 * Legacy rows without stored scopes must be validated against Meta before local gates grant access.
 */
export function deriveConnectionCapabilities(scopes, { scopesRecorded = false } = {}) {
  const report = permissionReportFromScopes(scopes || [], ['ctwa', 'reporting', 'leads']);
  if (!scopesRecorded) {
    for (const id of ['ctwa', 'reporting']) {
      report.capabilities[id] = {
        ...report.capabilities[id],
        status: 'not_verified',
        enabled: false,
        grandfathered: true,
        missing: [],
        verification_status: 'unverified'
      };
    }
    report.capabilities.leads = {
      ...report.capabilities.leads,
      status: 'not_requested',
      enabled: false,
      verification_status: 'unverified'
    };
    report.complete = false;
    report.reconnectRequired = false;
    report.grandfathered = true;
    report.missing = [];
    report.verification_status = 'unverified';
    report.verificationRequired = true;
    report.liveVerification = 'not_yet_verified';
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
      granted: [],
      verification_status: 'revoked'
    };
  }
  const scopes = Array.isArray(connection.token_scopes) ? connection.token_scopes : [];
  const scopesRecorded = Boolean(connection.permissions_checked_at) || scopes.length > 0;
  const report = deriveConnectionCapabilities(scopes, { scopesRecorded });
  if (scopesRecorded && connection.permissions_checked_at) {
    report.verification_status = 'verified';
    report.verificationRequired = false;
  }
  return report;
}

function verificationPendingError() {
  return new AppError(
    'Meta advertising permissions could not be verified right now. Try again in a few minutes.',
    503,
    'META_CAPABILITY_VERIFICATION_PENDING'
  );
}

export async function ensureAdsConnectionVerified(connection, { force = false, businessId = '', run = query } = {}) {
  const report = reportForStoredConnection(connection);
  if (report.revoked) return report;
  const scopesRecorded = Boolean(connection.permissions_checked_at)
    || (Array.isArray(connection.token_scopes) && connection.token_scopes.length > 0);
  if (scopesRecorded && !force) return report;
  const token = connection.token || (connection.access_token_encrypted ? decryptSecret(connection.access_token_encrypted) : '');
  if (!token) {
    throw new AppError('Meta advertising token is missing. Reconnect with Facebook Login.', 409, 'META_TOKEN_MISSING');
  }
  const requested = Array.isArray(connection.requested_capabilities) && connection.requested_capabilities.length
    ? connection.requested_capabilities
    : [...ADS_DEFAULT_REQUESTED];
  const { debugAdsToken } = await import('./ads-meta-oauth.js');
  try {
    const debug = await debugAdsToken(token, requested);
    if (businessId) {
      await run(
        `UPDATE whatsapp_ads_connections
            SET token_scopes=$2::jsonb, permissions_checked_at=NOW(), last_permission_report=$3::jsonb, updated_at=NOW()
          WHERE business_id=$1`,
        [businessId, JSON.stringify(debug.scopes || []), JSON.stringify(debug.report)]
      );
    }
    return { ...debug.report, verification_status: 'verified', verificationRequired: false };
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status >= 500 || error?.code === 'META_REQUEST_FAILED' && status >= 500) throw verificationPendingError();
    if (status === 503 || error?.code === 'META_CAPABILITY_VERIFICATION_PENDING') throw verificationPendingError();
    throw error;
  }
}

export async function assertAdsCapability(connection, capability, { businessId = '' } = {}) {
  let report = reportForStoredConnection(connection);
  if (report.revoked) {
    throw new AppError('Meta advertising authorization was revoked. Reconnect with Facebook Login.', 409, 'META_AUTHORIZATION_REVOKED');
  }
  if (report.verificationRequired || report.verification_status === 'unverified') {
    report = await ensureAdsConnectionVerified(connection, { businessId: businessId || connection.business_id });
  }
  const current = report.capabilities?.[capability];
  if (current?.enabled && current?.verification_status !== 'unverified') return report;
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
