import { requireSession } from './auth.js';
import { AppError, errorJson, id, json, query } from './db.js';
import { readJsonBodyLimited } from './security.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { createTemplateFromLibraryItem } from './template-library-submit.js';

const clean = (value) => String(value || '').trim();

function mapItem(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    language: row.language,
    industry: row.industry,
    description: row.description || '',
    body: row.body,
    headerText: row.header_text || '',
    footerText: row.footer_text || '',
    componentSchema: row.component_schema || {},
    tags: Array.isArray(row.tags) ? row.tags : [],
    sortOrder: Number(row.sort_order || 0)
  };
}

export async function listTemplateLibrary(request) {
  try {
    const session = await requireSession(request);
    await assertWorkspaceFeature('templates', session.businessId);
    const url = new URL(request.url);
    const category = clean(url.searchParams.get('category')).toUpperCase();
    const industry = clean(url.searchParams.get('industry')).toLowerCase();
    const q = clean(url.searchParams.get('q')).slice(0, 120);
    const values = [];
    const clauses = ['is_active = TRUE'];
    if (['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category)) {
      values.push(category);
      clauses.push(`category = $${values.length}`);
    }
    if (industry && industry !== 'all') {
      values.push(industry);
      clauses.push(`industry = $${values.length}`);
    }
    if (q) {
      values.push(`%${q.replace(/[%_]/g, '')}%`);
      clauses.push(`(name ILIKE $${values.length} OR description ILIKE $${values.length} OR body ILIKE $${values.length} OR $${values.length} = ANY(tags))`);
    }
    const rows = (
      await query(
        `SELECT id, slug, name, category, language, industry, description, body, header_text, footer_text, component_schema, tags, sort_order
           FROM template_library_items
          WHERE ${clauses.join(' AND ')}
          ORDER BY sort_order ASC, name ASC
          LIMIT 200`,
        values
      )
    ).rows;
    const industries = (
      await query(
        `SELECT DISTINCT industry FROM template_library_items WHERE is_active = TRUE ORDER BY industry`
      )
    ).rows.map((row) => row.industry);
    return json({
      items: rows.map(mapItem),
      industries,
      categories: ['MARKETING', 'UTILITY', 'AUTHENTICATION']
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function useTemplateLibraryItem(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('templates', session.businessId);
    const body = await readJsonBodyLimited(request, 65536);
    const libraryItemId = clean(body.libraryItemId || body.id);
    const submitToMeta = body.submitToMeta === true;
    const accountId = clean(body.accountId);
    const customName = clean(body.name);
    if (!libraryItemId) throw new AppError('Select a template from the library.', 400, 'VALIDATION_ERROR');
    const item = (
      await query(
        `SELECT * FROM template_library_items WHERE id = $1 AND is_active = TRUE`,
        [libraryItemId]
      )
    ).rows[0];
    if (!item) throw new AppError('Library template not found.', 404, 'NOT_FOUND');
    const created = await createTemplateFromLibraryItem({
      session,
      item,
      submitToMeta,
      accountId,
      customName
    });
    await query(
      `INSERT INTO template_library_uses (id, business_id, library_item_id, template_id, user_id, submit_to_meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id('tlu'), session.businessId, item.id, created.templateId, session.userId, submitToMeta]
    );
    return json({ ok: true, template: created.template, submittedToMeta: submitToMeta });
  } catch (error) {
    return errorJson(error);
  }
}
