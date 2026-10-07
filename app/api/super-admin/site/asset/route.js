import {AppError,errorJson,id,json,query} from '../../../../../lib/db.js';
import {requireSuperAdmin} from '../../../../../lib/super-admin.js';
import {readMultipartFormLimited,readOptionalJsonBodyLimited} from '../../../../../lib/security.js';
import {brandAssets,removeBrandAsset,saveBrandAsset} from '../../../../../lib/public-site.js';

export const runtime='nodejs';
export async function POST(request){
  try{
    const admin=await requireSuperAdmin(request);
    const form=await readMultipartFormLimited(request,5_300_000);
    const kind=form.get('kind');
    const file=form.get('file');
    if(!(file instanceof File))throw new AppError('Choose an image.',400,'ASSET_INVALID');
    const asset=await saveBrandAsset(kind,Buffer.from(await file.arrayBuffer()));
    await query('INSERT INTO platform_audit_logs(id,super_admin_id,action,metadata) VALUES($1,$2,$3,$4)',[id('pa'),admin.id,'platform_asset_uploaded',JSON.stringify({kind})]);
    return json({asset,assets:await brandAssets()});
  }catch(error){return errorJson(error);}
}
export async function DELETE(request){
  try{
    const admin=await requireSuperAdmin(request);
    const {kind}=await readOptionalJsonBodyLimited(request,1000);
    await removeBrandAsset(kind);
    await query('INSERT INTO platform_audit_logs(id,super_admin_id,action,metadata) VALUES($1,$2,$3,$4)',[id('pa'),admin.id,'platform_asset_removed',JSON.stringify({kind})]);
    return json({assets:await brandAssets()});
  }catch(error){return errorJson(error);}
}
