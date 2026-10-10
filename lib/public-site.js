import crypto from 'node:crypto';
import sharp from 'sharp';
import { AppError, query, transaction } from './db.js';
import {
  findPublishedPage,
  getDefaultCmsDocument,
  migrateSiteDocument,
  publicPathForPage,
  validateSiteDocument
} from './cms-document.js';

export { validateSiteDocument, migrateSiteDocument, getDefaultCmsDocument, findPublishedPage, publicPathForPage };

const assetKinds = new Set(['logo', 'favicon', 'hero']);
const fail = (message = 'Invalid website content.') => {
  throw new AppError(message, 400, 'SITE_INVALID');
};

function normalizeDocument(raw) {
  const migrated = migrateSiteDocument(raw || {});
  try {
    return validateSiteDocument(migrated);
  } catch {
    return getDefaultCmsDocument();
  }
}

export function mergePublicFooterLinks(cmsLinks, defaults) {
  const seen = new Set();
  const merged = [];
  for (const link of [...(Array.isArray(cmsLinks) ? cmsLinks : []), ...(Array.isArray(defaults) ? defaults : [])]) {
    if (!link?.href || seen.has(link.href)) continue;
    seen.add(link.href);
    merged.push({ label: String(link.label || '').trim(), href: link.href });
  }
  return merged;
}

export async function getPublishedSite() {
  const row = (await query("SELECT published,published_revision,published_at FROM public_site_documents WHERE id='current'")).rows[0];
  const published = row?.published || {};
  const hasPages = Array.isArray(published.pages) && published.pages.length > 0;
  const hasLegacy = Array.isArray(published.sections) && published.sections.length > 0;
  let document = hasPages || hasLegacy ? normalizeDocument(published) : getDefaultCmsDocument();

  let defaults = [];
  try {
    defaults = (await query("SELECT value FROM platform_settings WHERE key='public_default_footer_links'")).rows[0]?.value || [];
  } catch (error) {
    if (error?.code !== 'DB_NOT_CONFIGURED' && error?.code !== '42P01') throw error;
  }
  document = {
    ...document,
    footer: {
      ...document.footer,
      links: mergePublicFooterLinks(document.footer?.links || document.footerLinks || [], defaults)
    },
    // legacy aliases for older callers/tests
    footerLinks: mergePublicFooterLinks(document.footer?.links || [], defaults),
    socialLinks: document.footer?.socialLinks || [],
    sections: document.pages?.find((page) => page.kind === 'home')?.sections || []
  };
  return { document, revision: row?.published_revision || 0, publishedAt: row?.published_at || null };
}

export async function getSiteDraft() {
  const row = (await query("SELECT draft,revision,published_revision,updated_at,published_at FROM public_site_documents WHERE id='current'")).rows[0];
  if (!row) throw new AppError('Initialize the public site database first.', 503, 'SITE_NOT_READY');
  const draft = row.draft || {};
  const hasPages = Array.isArray(draft.pages) && draft.pages.length > 0;
  const hasLegacy = Array.isArray(draft.sections) && draft.sections.length > 0;
  const document = hasPages || hasLegacy ? normalizeDocument(draft) : getDefaultCmsDocument();
  return {
    document,
    revision: row.revision,
    publishedRevision: row.published_revision,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  };
}

export async function changeSiteDraft({ action, revision, document }) {
  if (!Number.isSafeInteger(revision) || revision < 1 || !['save', 'publish'].includes(action)) fail('Save/publish request is invalid.');
  return transaction(async (client) => {
    const current = (await client.query("SELECT revision,draft,published FROM public_site_documents WHERE id='current' FOR UPDATE")).rows[0];
    if (!current) throw new AppError('Initialize the public site database first.', 503, 'SITE_NOT_READY');
    if (current.revision !== revision) throw new AppError('The public site was edited elsewhere. Reload before saving.', 409, 'SITE_REVISION_CONFLICT');
    if (action === 'save') {
      const validated = validateSiteDocument(document);
      await client.query("UPDATE public_site_documents SET draft=$1,revision=revision+1,updated_at=now() WHERE id='current'", [JSON.stringify(validated)]);
    } else {
      // Prefer request document when provided; otherwise publish the latest saved draft.
      const source = document ? document : migrateSiteDocument(current.draft || {});
      const validated = validateSiteDocument(source);
      try {
        await client.query(
          `INSERT INTO public_site_revisions(id, revision, document, created_at)
           VALUES($1,$2,$3,now())
           ON CONFLICT (id) DO NOTHING`,
          [`rev_${current.revision}`, current.revision, JSON.stringify(current.published || {})]
        );
      } catch {
        /* revisions table optional until db:init */
      }
      await client.query(
        "UPDATE public_site_documents SET draft=$1,published=$1,published_revision=revision,revision=revision+1,published_at=now(),updated_at=now() WHERE id='current'",
        [JSON.stringify(validated)]
      );
    }
    const row = (await client.query("SELECT draft,revision,published_revision,updated_at,published_at FROM public_site_documents WHERE id='current'")).rows[0];
    return { document: row.draft, revision: row.revision, publishedRevision: row.published_revision, updatedAt: row.updated_at, publishedAt: row.published_at };
  });
}

export async function brandAssets() {
  const rows = (await query('SELECT kind,version,width,height,updated_at FROM platform_brand_assets')).rows;
  return Object.fromEntries(rows.map((row) => [row.kind, { url: `/api/platform/asset/${row.kind}?v=${row.version}`, width: row.width, height: row.height, updatedAt: row.updated_at }]));
}

export async function saveBrandAsset(kind, bytes) {
  if (!assetKinds.has(kind) || !Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > 5_000_000) throw new AppError('Choose an image under 5 MB.', 400, 'ASSET_INVALID');
  let metadata;
  try {
    metadata = await sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'error' }).metadata();
  } catch {
    throw new AppError('The image could not be decoded.', 400, 'ASSET_INVALID');
  }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width > 4000 || metadata.height > 4000 || metadata.width < 16 || metadata.height < 16) {
    throw new AppError('Upload a PNG, JPEG or WebP image from 16 to 4000 pixels.', 400, 'ASSET_INVALID');
  }
  if (kind === 'favicon' && (metadata.width !== metadata.height || metadata.width > 1024)) throw new AppError('Favicon must be square and at most 1024 pixels.', 400, 'ASSET_INVALID');
  if (kind === 'hero' && (metadata.width < 1200 || metadata.height < 500)) throw new AppError('Hero image must be at least 1200 by 500 pixels.', 400, 'ASSET_INVALID');
  const image = await sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'error' }).rotate().webp({ quality: 85, effort: 4 }).toBuffer();
  const dimensions = await sharp(image).metadata();
  const version = crypto.createHash('sha256').update(image).digest('hex').slice(0, 16);
  await query(
    `INSERT INTO platform_brand_assets(kind,media_type,image_data,width,height,version) VALUES($1,'image/webp',$2,$3,$4,$5)
    ON CONFLICT(kind) DO UPDATE SET media_type=excluded.media_type,image_data=excluded.image_data,width=excluded.width,height=excluded.height,version=excluded.version,updated_at=now()`,
    [kind, image, dimensions.width, dimensions.height, version]
  );
  return { url: `/api/platform/asset/${kind}?v=${version}`, width: dimensions.width, height: dimensions.height };
}

export async function removeBrandAsset(kind) {
  if (!assetKinds.has(kind)) fail();
  await query('DELETE FROM platform_brand_assets WHERE kind=$1', [kind]);
}

export async function loadBrandAsset(kind) {
  if (!assetKinds.has(kind)) return null;
  return (await query('SELECT image_data,media_type,version FROM platform_brand_assets WHERE kind=$1', [kind])).rows[0] || null;
}
