import { getBusinessConsentSettings } from './consent-management.js';
import { query } from './db.js';

/**
 * Core CRM marketing eligibility gate.
 * Utility/authentication templates should not call this for non-marketing sends.
 */
export async function evaluateMarketingEligibility(
  { businessId, contactId, purpose = 'whatsapp_marketing' },
  run = query
) {
  const reasons = [];
  const settings = await getBusinessConsentSettings(businessId, run);
  if (!settings.marketingMessagingEnabled) {
    reasons.push('Workspace marketing messaging is disabled.');
  }

  const contact = (await run(
    `SELECT id, phone, name, marketing_permission, unsubscribed, opt_in_at, opt_in_source,
            EXISTS (
              SELECT 1 FROM contact_suppressions s
              WHERE s.business_id=$1 AND s.contact_id=contacts.id
                AND s.channel='whatsapp' AND s.active=TRUE
            ) AS suppressed
     FROM contacts
     WHERE business_id=$1 AND id=$2`,
    [businessId, contactId]
  )).rows[0];

  if (!contact) {
    return {
      eligible: false,
      purpose,
      reasons: ['Contact not found.'],
      contact: null,
      settings: { marketingMessagingEnabled: settings.marketingMessagingEnabled }
    };
  }

  if (!contact.marketing_permission) reasons.push('Marketing permission is not recorded.');
  if (contact.unsubscribed) reasons.push('Contact is unsubscribed.');
  if (contact.suppressed) reasons.push('Contact is on the WhatsApp suppression list.');
  if (!contact.opt_in_at && contact.marketing_permission) {
    // Soft signal only — some legacy rows have permission without timestamp.
  }

  return {
    eligible: reasons.length === 0,
    purpose,
    reasons,
    contact: {
      id: contact.id,
      phone: contact.phone,
      name: contact.name,
      marketingPermission: contact.marketing_permission,
      unsubscribed: contact.unsubscribed,
      suppressed: Boolean(contact.suppressed),
      optInAt: contact.opt_in_at,
      optInSource: contact.opt_in_source
    },
    settings: { marketingMessagingEnabled: settings.marketingMessagingEnabled }
  };
}

export async function assertMarketingEligible(args, run = query) {
  const result = await evaluateMarketingEligibility(args, run);
  if (!result.eligible) {
    const { AppError } = await import('./db.js');
    throw new AppError(result.reasons[0] || 'Contact is not eligible for marketing messages.', 409, 'MARKETING_INELIGIBLE');
  }
  return result;
}
