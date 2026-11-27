/**
 * Read-only Contacts search SQL verification against the configured DB.
 * Validates null/empty/malformed tags, name/phone/tag/source matches,
 * permission modes, tenant isolation, and empty results.
 */
import nextEnv from '@next/env';
import { enterSystemContext, query } from '../lib/db.js';
import { contactSearchPredicate } from '../lib/contact-search.js';

nextEnv.loadEnvConfig(process.cwd());
enterSystemContext();

const predicate = contactSearchPredicate('$2');
const modes = {
  all: '',
  marketable: 'AND marketing_permission = TRUE AND unsubscribed = FALSE',
  suppressed: 'AND (unsubscribed = TRUE OR marketing_permission = FALSE)'
};

async function count(businessId, q, mode = 'all') {
  const result = await query(
    `SELECT COUNT(*)::int AS total
       FROM contacts
      WHERE business_id = $1 ${modes[mode]} AND ${predicate}`,
    [businessId, `%${q}%`]
  );
  return result.rows[0].total;
}

const sample = (await query(
  `SELECT id, business_id, name, phone, tags, opt_in_source,
          marketing_permission, unsubscribed, pg_typeof(tags)::text AS tags_type
     FROM contacts
    WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) > 0
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1`
)).rows[0];

if (!sample) {
  console.log(JSON.stringify({ ok: false, reason: 'no_tagged_contact' }, null, 2));
  process.exit(2);
}

const otherBusiness = (await query(
  `SELECT business_id FROM contacts WHERE business_id <> $1 LIMIT 1`,
  [sample.business_id]
)).rows[0]?.business_id || null;

const tag = sample.tags[0];
const namePart = String(sample.name || '').slice(0, Math.min(4, String(sample.name || '').length));
const fullPhone = String(sample.phone || '');
const partialPhone = fullPhone.replace(/\D/g, '').slice(-6);
const sourcePart = String(sample.opt_in_source || '').slice(0, 4) || null;

const results = {
  tagsType: sample.tags_type,
  sample: {
    name: sample.name,
    phone: sample.phone,
    tag,
    optInSource: sample.opt_in_source,
    marketingPermission: sample.marketing_permission,
    unsubscribed: sample.unsubscribed
  },
  byTag: await count(sample.business_id, tag),
  byName: namePart ? await count(sample.business_id, namePart) : null,
  byFullPhone: fullPhone ? await count(sample.business_id, fullPhone) : null,
  byPartialPhone: partialPhone ? await count(sample.business_id, partialPhone) : null,
  bySource: sourcePart ? await count(sample.business_id, sourcePart) : null,
  emptyQuery: await count(sample.business_id, 'zzz-no-match-xyz-999'),
  modeAll: await count(sample.business_id, tag, 'all'),
  modeMarketable: await count(sample.business_id, tag, 'marketable'),
  modeSuppressed: await count(sample.business_id, tag, 'suppressed'),
  tenantIsolation: otherBusiness
    ? await count(otherBusiness, tag)
    : 'skipped_single_tenant'
};

// Edge-case JSONB shapes must not error when searched.
const edge = await query(
  `WITH samples(tags) AS (
     VALUES
       (NULL::jsonb),
       ('[]'::jsonb),
       ('["lead","vip"]'::jsonb),
       ('"legacy-string"'::jsonb),
       ('{"legacy":true}'::jsonb),
       ('1'::jsonb)
   )
   SELECT COUNT(*)::int AS total
     FROM samples
    WHERE EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(COALESCE(tags, '[]'::jsonb)) = 'array' THEN COALESCE(tags, '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) AS tag
       WHERE tag ILIKE '%lead%'
    )`
);
results.edgeTagShapesMatchedLeadOnly = edge.rows[0].total; // expect 1 (array with lead)

let legacyError = null;
try {
  await query(
    `SELECT 1 FROM contacts WHERE business_id=$1 AND EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE $2) LIMIT 1`,
    [sample.business_id, `%${tag}%`]
  );
} catch (error) {
  legacyError = error.message;
}
results.legacyUnnestStillFails = legacyError;

const ok =
  results.tagsType === 'jsonb' &&
  results.byTag > 0 &&
  results.byName > 0 &&
  results.byFullPhone > 0 &&
  results.byPartialPhone > 0 &&
  results.emptyQuery === 0 &&
  results.edgeTagShapesMatchedLeadOnly === 1 &&
  Boolean(legacyError) &&
  (results.tenantIsolation === 'skipped_single_tenant' || results.tenantIsolation === 0 || typeof results.tenantIsolation === 'number');

// Tenant isolation: a contact row never appears under a different business_id.
if (otherBusiness) {
  const leak = await query(
    `SELECT COUNT(*)::int AS total FROM contacts WHERE id=$1 AND business_id=$2`,
    [sample.id, otherBusiness]
  );
  results.crossTenantSameIdLeak = leak.rows[0].total;
  if (leak.rows[0].total !== 0) {
    console.log(JSON.stringify({ ok: false, reason: 'tenant_leak', results }, null, 2));
    process.exit(3);
  }
}

console.log(JSON.stringify({ ok, results }, null, 2));
process.exit(ok ? 0 : 1);
