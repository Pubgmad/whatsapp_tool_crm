import {errorJson,id,json,query} from '../../../../lib/db.js';
import {requireSuperAdmin} from '../../../../lib/super-admin.js';
import {readOptionalJsonBodyLimited} from '../../../../lib/security.js';
import {brandAssets,changeSiteDraft,getSiteDraft} from '../../../../lib/public-site.js';

export const runtime='nodejs';
export async function GET(request){
  try{await requireSuperAdmin(request);return json({site:await getSiteDraft(),assets:await brandAssets()});}
  catch(error){return errorJson(error);}
}
export async function POST(request){
  try{
    const admin=await requireSuperAdmin(request);
    const body=await readOptionalJsonBodyLimited(request,120000);
    const site=await changeSiteDraft(body);
    await query('INSERT INTO platform_audit_logs(id,super_admin_id,action,metadata) VALUES($1,$2,$3,$4)',[id('pa'),admin.id,body.action==='publish'?'public_site_published':'public_site_draft_saved',JSON.stringify({revision:site.revision})]);
    return json({site});
  }catch(error){return errorJson(error);}
}
