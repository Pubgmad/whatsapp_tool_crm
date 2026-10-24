/**
 * Customer-facing copy helpers.
 * Replaces known internal / Super Admin / CMS jargon with marketing language
 * without wiping unrelated administrator edits.
 */

export const HOME_HERO_SUBTITLE =
  'Connect with customers, manage WhatsApp conversations, automate follow-ups, and grow your business with messaging tools in one place.';

/** Exact legacy strings we safely rewrite when still present in published CMS. */
const EXACT_REPLACEMENTS = Object.freeze([
  [
    'A production WhatsApp CRM for shared inbox, template campaigns, automation, CTWA ads, commerce, and analytics — with Super Admin controlled product pages.',
    HOME_HERO_SUBTITLE
  ]
]);

const PHRASE_REPLACEMENTS = Object.freeze([
  [/with Super Admin controlled product pages\.?/gi, ''],
  [/Super Admin–governed product storytelling/gi, 'clear product storytelling'],
  [/Super Admin CMS controls navigation, product pages, and many marketing sections without redeploying code\./gi,
    'You can update navigation and product pages from your platform settings without a code deploy.'],
  [/from Super Admin/gi, 'from your platform settings'],
  [/in Super Admin/gi, 'in platform settings'],
  [/Super Admin publishes/gi, 'Your team publishes'],
  [/Super Admin owns the public narrative/gi, 'Your team owns the public narrative'],
  [/Super Admin editable/gi, 'editable in platform settings'],
  [/your Super Admin can edit and publish/gi, 'your team can edit and publish'],
  [/Super Admin controls company status, plans, and published site content/gi,
    'Platform administrators control company status, plans, and published site content'],
  [/Add verified facts through Super Admin when you are ready to publish them\./gi,
    'Add verified facts in platform settings when you are ready to publish them.'],
  [/managed in Super Admin/gi, 'managed in platform settings'],
  [/Publishable product storytelling from Super Admin/gi, 'Publishable product storytelling'],
  [/\s{2,}/g, ' ']
]);

function replaceInString(value) {
  if (typeof value !== 'string' || !value) return value;
  let next = value;
  for (const [from, to] of EXACT_REPLACEMENTS) {
    if (next === from) next = to;
  }
  for (const [pattern, to] of PHRASE_REPLACEMENTS) {
    next = next.replace(pattern, to);
  }
  return next.trim().replace(/\s+—\s*$/, '').trim();
}

function walk(value) {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = walk(child);
    }
    return out;
  }
  if (typeof value === 'string') return replaceInString(value);
  return value;
}

function stableJson(value) {
  return JSON.stringify(value);
}

/**
 * Soft-sanitize CMS / marketing documents for public rendering.
 * Safe for every page load; does not mutate the database by itself.
 */
export function sanitizeCustomerFacingDocument(document) {
  if (!document || typeof document !== 'object') return document;
  return walk(document);
}

/** Soft-sanitize a single marketing page object. */
export function sanitizeCustomerFacingPage(page) {
  if (!page || typeof page !== 'object') return page;
  return walk(page);
}

/**
 * Idempotent DB persistence of known jargon scrubbing.
 * Only writes when draft/published JSON actually change after sanitization.
 * Never invents new pages — only rewrites known Super Admin / CMS phrases.
 */
export async function persistSanitizedPublicSiteDocuments(client) {
  const run = client?.query ? client.query.bind(client) : null;
  if (!run) throw new Error('persistSanitizedPublicSiteDocuments requires a DB client');

  const exists = await run("SELECT to_regclass('public.public_site_documents') AS table_name");
  if (!exists.rows[0]?.table_name) {
    return { updated: false, reason: 'table_missing' };
  }

  const row = (
    await run("SELECT draft, published, revision FROM public_site_documents WHERE id='current' FOR UPDATE")
  ).rows[0];
  if (!row) return { updated: false, reason: 'row_missing' };

  const draft = row.draft && typeof row.draft === 'object' ? row.draft : {};
  const published = row.published && typeof row.published === 'object' ? row.published : {};
  const nextDraft = sanitizeCustomerFacingDocument(draft);
  const nextPublished = sanitizeCustomerFacingDocument(published);
  const draftChanged = stableJson(draft) !== stableJson(nextDraft);
  const publishedChanged = stableJson(published) !== stableJson(nextPublished);

  if (!draftChanged && !publishedChanged) {
    return { updated: false, draftChanged: false, publishedChanged: false, revision: row.revision };
  }

  await run(
    `UPDATE public_site_documents
        SET draft = $1::jsonb,
            published = $2::jsonb,
            revision = revision + 1,
            updated_at = NOW(),
            published_at = CASE WHEN $3::boolean THEN NOW() ELSE published_at END
      WHERE id = 'current'`,
    [JSON.stringify(nextDraft), JSON.stringify(nextPublished), publishedChanged]
  );

  return {
    updated: true,
    draftChanged,
    publishedChanged,
    revision: Number(row.revision || 0) + 1
  };
}
