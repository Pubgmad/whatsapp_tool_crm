import { currentAccount } from '@/lib/auth';
import { mapTemplate } from '@/lib/actions';
import { AppError, errorJson, json, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const account = await currentAccount(request);
    const params = new URL(request.url).searchParams;
    const selectedId = params.get('id');
    if (selectedId) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(selectedId)) throw new AppError('Invalid template ID.', 400, 'VALIDATION_ERROR');
      const selected = await query("SELECT * FROM templates WHERE business_id=$1 AND id=$2 AND status='Approved'", [account.business.id, selectedId]);
      return json({ template: selected.rows[0] ? mapTemplate(selected.rows[0]) : null });
    }
    const search = String(params.get('q') || '').trim().slice(0, 100).toLowerCase();
    const rawPage = Number(params.get('page') || 1);
    if (!Number.isSafeInteger(rawPage) || rawPage < 1 || rawPage > 1000) throw new AppError('Invalid page.', 400, 'VALIDATION_ERROR');
    const limit = 25;
    const values = [account.business.id, `${search.replace(/[\\%_]/g, '\\$&')}%`, limit + 1, (rawPage - 1) * limit];
    const rows = await query(`SELECT * FROM templates WHERE business_id=$1 AND status='Approved'
      AND ($2='%' OR lower(name) LIKE $2 ESCAPE '\\')
      ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`, values);
    return json({ templates: rows.rows.slice(0, limit).map(mapTemplate), page: rawPage, hasMore: rows.rows.length > limit });
  } catch (error) { return errorJson(error); }
}
