import { currentAccount } from '@/lib/auth';
import { mapTemplate } from '@/lib/actions';
import { AppError, errorJson, json, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const account = await currentAccount(request);
    const params = new URL(request.url).searchParams;
    const wabaId = params.get('wabaId') || '';
    if (wabaId && !/^\d{1,30}$/.test(wabaId)) throw new AppError('Invalid WhatsApp account.', 400, 'VALIDATION_ERROR');
    const category = params.get('category') || '';
    if (category && !['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category)) throw new AppError('Invalid template category.', 400, 'VALIDATION_ERROR');
    const requiresVariables = params.get('requiresVariables') === '1';
    const selectedId = params.get('id');
    if (selectedId) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(selectedId)) throw new AppError('Invalid template ID.', 400, 'VALIDATION_ERROR');
      const selected = await query(`SELECT t.* FROM templates t JOIN businesses b ON b.id=t.business_id
        WHERE t.business_id=$1 AND t.id=$2 AND t.status='Approved'
          AND ($3='' OR t.waba_id=$3 OR (t.waba_id='' AND b.waba_id=$3))
          AND ($4='' OR t.category=$4) AND (NOT $5::boolean OR jsonb_array_length(t.variables)>0)`, [account.business.id, selectedId, wabaId, category, requiresVariables]);
      return json({ template: selected.rows[0] ? mapTemplate(selected.rows[0]) : null });
    }
    const search = String(params.get('q') || '').trim().slice(0, 100).toLowerCase();
    const rawPage = Number(params.get('page') || 1);
    if (!Number.isSafeInteger(rawPage) || rawPage < 1 || rawPage > 1000) throw new AppError('Invalid page.', 400, 'VALIDATION_ERROR');
    const limit = 25;
    const values = [account.business.id, `${search.replace(/[\\%_]/g, '\\$&')}%`, limit + 1, (rawPage - 1) * limit, wabaId, category, requiresVariables];
    const rows = await query(`SELECT t.* FROM templates t JOIN businesses b ON b.id=t.business_id
      WHERE t.business_id=$1 AND t.status='Approved'
      AND ($2='%' OR lower(t.name) LIKE $2 ESCAPE '\\')
      AND ($5='' OR t.waba_id=$5 OR (t.waba_id='' AND b.waba_id=$5))
      AND ($6='' OR t.category=$6) AND (NOT $7::boolean OR jsonb_array_length(t.variables)>0)
      ORDER BY t.created_at DESC,t.id DESC LIMIT $3 OFFSET $4`, values);
    return json({ templates: rows.rows.slice(0, limit).map(mapTemplate), page: rawPage, hasMore: rows.rows.length > limit });
  } catch (error) { return errorJson(error); }
}
