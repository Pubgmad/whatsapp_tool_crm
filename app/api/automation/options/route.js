import { currentAccount } from '@/lib/auth';
import { AppError, errorJson, json, query } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const account = await currentAccount(request);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get('page') || 1);
    const search = params.get('q') || '';
    const flowId = params.get('id') || '';
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 120 || (flowId && !/^[a-zA-Z0-9_-]{1,100}$/.test(flowId))) {
      throw new AppError('Invalid flow search.', 400, 'INVALID_PAGE');
    }
    const result = flowId
      ? await query("SELECT id,name,status FROM automation_flows WHERE business_id=$1 AND status='active' AND id=$2", [account.business.id, flowId])
      : await query("SELECT id,name,status FROM automation_flows WHERE business_id=$1 AND status='active' AND ($2='' OR STRPOS(LOWER(name),LOWER($2))>0) ORDER BY name,id LIMIT 26 OFFSET $3", [account.business.id, search, (page - 1) * 25]);
    return json({ flows: result.rows.slice(0, 25), hasMore: result.rows.length > 25, page });
  } catch (error) { return errorJson(error); }
}
