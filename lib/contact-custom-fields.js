import { AppError, id, json, errorJson, query, transaction } from './db.js';
import { requireSession } from './auth.js';
import { readJsonBodyLimited } from './security.js';

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40);
}

export async function listCustomFieldDefs(businessId) {
  const rows = (await query(
    `SELECT id, field_key, label, field_type, created_at
     FROM contact_custom_field_defs
     WHERE business_id=$1
     ORDER BY label, field_key`,
    [businessId]
  )).rows;
  return rows.map((row) => ({
    id: row.id,
    key: row.field_key,
    label: row.label,
    type: row.field_type,
    createdAt: row.created_at
  }));
}

export async function customFieldsRequest(request) {
  try {
    const session = await requireSession(request);
    if (request.method === 'GET') {
      return json({ fields: await listCustomFieldDefs(session.businessId) });
    }
    if (!['Owner', 'Manager'].includes(session.role)) {
      throw new AppError('Manager access required.', 403, 'FORBIDDEN');
    }
    const body = await readJsonBodyLimited(request, 8192);
    if (body.action === 'create') {
      const key = normalizeKey(body.key || body.label);
      const label = String(body.label || '').trim().slice(0, 80);
      const fieldType = ['text', 'number', 'boolean', 'date'].includes(body.type) ? body.type : 'text';
      if (!KEY_RE.test(key) || !label) {
        throw new AppError('Provide a label and a lowercase field key (letters, numbers, underscore).', 400, 'CUSTOM_FIELD_INVALID');
      }
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO contact_custom_field_defs (id,business_id,field_key,label,field_type)
           VALUES ($1,$2,$3,$4,$5)`,
          [id('cfd'), session.businessId, key, label, fieldType]
        );
        await client.query(
          `INSERT INTO audit_logs(id,business_id,user_id,action,metadata)
           VALUES ($1,$2,$3,'custom_field_created',$4)`,
          [id('a'), session.businessId, session.userId, JSON.stringify({ key, label, fieldType })]
        );
      });
      return json({ ok: true, fields: await listCustomFieldDefs(session.businessId) }, 201);
    }
    if (body.action === 'delete') {
      const deleted = await query(
        `DELETE FROM contact_custom_field_defs WHERE id=$1 AND business_id=$2 RETURNING id`,
        [body.id, session.businessId]
      );
      if (!deleted.rowCount) throw new AppError('Custom field not found.', 404, 'NOT_FOUND');
      return json({ ok: true, fields: await listCustomFieldDefs(session.businessId) });
    }
    throw new AppError('Invalid custom field operation.', 400, 'CUSTOM_FIELD_INVALID');
  } catch (error) {
    return errorJson(error);
  }
}
