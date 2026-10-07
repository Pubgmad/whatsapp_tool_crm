import {loadBrandAsset} from '../../../../../lib/public-site.js';

export const runtime='nodejs';
export async function GET(request,{params}){
  const {kind}=await params;
  const asset=await loadBrandAsset(kind);
  if(!asset)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
  const version=new URL(request.url).searchParams.get('v');
  return new Response(asset.image_data,{headers:{'Content-Type':asset.media_type,'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff','Cache-Control':version===asset.version?'public, max-age=31536000, immutable':'no-store'}});
}
