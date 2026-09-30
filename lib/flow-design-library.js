import {requireSession} from './auth.js';
import {AppError,query,json,errorJson,id} from './db.js';
import {readJsonBodyLimited} from './security.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {compileFlowDesign} from './flow-design.js';
export async function flowDesignLibrary(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    if(request.method==='GET')return json({designs:(await query('SELECT id,name,design,updated_at FROM whatsapp_flow_designs WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 100',[session.businessId])).rows});
    const body=await readJsonBodyLimited(request,100000);
    if(body.action==='delete'){
      const result=await query('DELETE FROM whatsapp_flow_designs WHERE business_id=$1 AND id=$2 RETURNING id',[session.businessId,body.id]);
      if(!result.rowCount)throw new AppError('Saved design not found.',404,'NOT_FOUND');
    }else if(body.action==='save'){
      compileFlowDesign(body.design);
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)throw new AppError('Enter a design name.',400,'VALIDATION_ERROR');
      if(body.id){
        const updated=await query('UPDATE whatsapp_flow_designs SET name=$1,design=$2,updated_at=NOW() WHERE business_id=$3 AND id=$4 RETURNING id',[body.name.trim(),JSON.stringify(body.design),session.businessId,body.id]);
        if(!updated.rowCount)throw new AppError('Saved design not found.',404,'NOT_FOUND');
      }else{
        const saved=await query('INSERT INTO whatsapp_flow_designs (id,business_id,name,design) VALUES ($1,$2,$3,$4) RETURNING id',[id('fd'),session.businessId,body.name.trim(),JSON.stringify(body.design)]);
        return json({ok:true,id:saved.rows[0].id},201);
      }
    }else throw new AppError('Unsupported design operation.',400,'INVALID_ACTION');
    return json({ok:true});
  }catch(error){return errorJson(error.code==='FLOW_DESIGN_INVALID'?new AppError(error.message,400,error.code):error);}
}
