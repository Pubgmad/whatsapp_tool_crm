import {AppError,query,transaction,id} from './db.js';

export const crmFields={company:['name','domain','industry'],deal:['name','stage','amount','currency','close_date']};
const keyPattern=/^[a-z][a-z0-9_]{0,49}$/;

export function normalizeCrmObject(provider,kind,raw){
  if(!crmFields[kind]||!['salesforce','hubspot'].includes(provider))return null;
  const externalId=String(provider==='salesforce'?raw?.Id:raw?.id||'');
  if(provider==='salesforce'&&!new RegExp(`^${kind==='company'?'001':'006'}[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$`).test(externalId)||provider==='hubspot'&&!/^\d{1,32}$/.test(externalId))return null;
  const at=new Date(provider==='salesforce'?raw.LastModifiedDate:raw.updatedAt);
  if(!Number.isFinite(at.getTime()))return null;
  const props=provider==='salesforce'?raw:raw.properties||{};
  const fields=kind==='company'?{
    name:props.Name??props.name,domain:props.Website??props.domain,industry:props.Industry??props.industry
  }:{
    name:props.Name??props.dealname,stage:props.StageName??props.dealstage,
    amount:props.Amount??props.amount,currency:props.CurrencyIsoCode??props.deal_currency_code,
    close_date:props.CloseDate??props.closedate
  };
  const clean={};
  for(const field of crmFields[kind])if(fields[field]!==null&&fields[field]!==undefined&&String(fields[field]).length<=512)clean[field]=String(fields[field]);
  if(!clean.name?.trim())return null;
  const associations=provider==='hubspot'?raw.associations?.contacts:null;
  if(associations?.paging?.next)throw new AppError('CRM contact associations must be paged before object import.',502,'CRM_ASSOCIATIONS_INCOMPLETE');
  const associatedContactIds=provider==='hubspot'?(associations?.results||[]).map(item=>String(item.id)).filter(value=>/^\d{1,32}$/.test(value)).slice(0,100):[];
  return {externalId,kind,displayName:clean.name.trim().slice(0,160),fields:clean,updatedAt:at.toISOString(),archived:Boolean(raw.archived),associatedContactIds};
}

export async function crmObjectCursor(connection,kind){
  return (await query('SELECT cursor,archived_cursor,watermark FROM crm_object_cursors WHERE business_id=$1 AND connection_id=$2 AND kind=$3',[connection.business_id,connection.id,kind])).rows[0]||{cursor:'',archived_cursor:'',watermark:null};
}

async function applyMappings(client,connection,contactIds){
  if(!contactIds.length)return;
  const mappings=(await client.query('SELECT kind,source_field,attribute_key FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 AND enabled ORDER BY kind,source_field',[connection.business_id,connection.id])).rows;
  if(!mappings.length)return;
  for(const contactId of [...new Set(contactIds)]){
    const current=(await client.query('SELECT custom_attributes FROM contacts WHERE business_id=$1 AND id=$2 FOR UPDATE',[connection.business_id,contactId])).rows[0];
    if(!current)continue;
    const attrs={...current.custom_attributes};
    for(const mapping of mappings){
      const latest=(await client.query(`SELECT r.fields->$5 AS value FROM crm_object_contacts l JOIN crm_object_records r
        ON r.connection_id=l.connection_id AND r.business_id=l.business_id AND r.kind=l.kind AND r.external_id=l.external_id
        WHERE l.business_id=$1 AND l.connection_id=$2 AND l.contact_id=$3 AND l.kind=$4 AND NOT r.archived
        AND r.fields ? $5 ORDER BY r.external_updated_at DESC,r.external_id DESC LIMIT 1`,[connection.business_id,connection.id,contactId,mapping.kind,mapping.source_field])).rows[0];
      if(latest?.value!==undefined)attrs[mapping.attribute_key]=latest.value;
      else delete attrs[mapping.attribute_key];
    }
    if(Buffer.byteLength(JSON.stringify(attrs))>16384)throw new AppError('Mapped CRM attributes exceed the contact limit.',409,'CRM_MAPPING_TOO_LARGE');
    await client.query('UPDATE contacts SET custom_attributes=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3 AND custom_attributes IS DISTINCT FROM $1::jsonb',[JSON.stringify(attrs),connection.business_id,contactId]);
  }
}

export async function storeCrmObjectPage(connection,kind,rawItems,{cursor='',watermark=null,associatedContacts={}}={}){
  if(!crmFields[kind]||!Array.isArray(rawItems)||rawItems.length>200||typeof cursor!=='string'||cursor.length>512)throw new AppError('Invalid CRM object page.',502,'CRM_INVALID_RESPONSE');
  const objects=rawItems.map(item=>normalizeCrmObject(connection.provider,kind,item));
  const affected=[];let imported=0,skipped=0;
  await transaction(async client=>{
    for(let index=0;index<objects.length;index++){
      const object=objects[index];if(!object){skipped++;continue;}
      const changed=await client.query(`INSERT INTO crm_object_records(business_id,connection_id,kind,external_id,display_name,fields,external_updated_at,archived)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(connection_id,kind,external_id) DO UPDATE
        SET display_name=EXCLUDED.display_name,fields=EXCLUDED.fields,external_updated_at=EXCLUDED.external_updated_at,
          archived=EXCLUDED.archived,updated_at=NOW()
        WHERE crm_object_records.external_updated_at<=EXCLUDED.external_updated_at RETURNING external_id`,[connection.business_id,connection.id,kind,object.externalId,object.displayName,JSON.stringify(object.fields),object.updatedAt,object.archived]);
      if(!changed.rowCount)continue;
      const before=(await client.query('SELECT contact_id FROM crm_object_contacts WHERE business_id=$1 AND connection_id=$2 AND kind=$3 AND external_id=$4',[connection.business_id,connection.id,kind,object.externalId])).rows.map(row=>row.contact_id);
      await client.query('DELETE FROM crm_object_contacts WHERE business_id=$1 AND connection_id=$2 AND kind=$3 AND external_id=$4',[connection.business_id,connection.id,kind,object.externalId]);
      const externalContacts=object.archived?[]:associatedContacts[object.externalId]||object.associatedContactIds;
      if(!Array.isArray(externalContacts)||externalContacts.length>200)throw new AppError('Invalid CRM associations.',502,'CRM_INVALID_RESPONSE');
      for(const externalContactId of new Set(externalContacts)){
        const linked=(await client.query(`INSERT INTO crm_object_contacts(business_id,connection_id,kind,external_id,contact_id)
          SELECT $1,$2,$3,$4,l.contact_id FROM crm_contact_links l
          WHERE l.business_id=$1 AND l.connection_id=$2 AND l.external_id=$5 AND l.external_object_type='Contact'
          ON CONFLICT DO NOTHING RETURNING contact_id`,[connection.business_id,connection.id,kind,object.externalId,String(externalContactId)])).rows[0];
        if(linked)affected.push(linked.contact_id);
      }
      affected.push(...before);imported++;
    }
    await client.query(`INSERT INTO crm_object_cursors(business_id,connection_id,kind,cursor,watermark) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(connection_id,kind) DO UPDATE SET cursor=EXCLUDED.cursor,watermark=COALESCE(EXCLUDED.watermark,crm_object_cursors.watermark),updated_at=NOW()`,[connection.business_id,connection.id,kind,cursor,watermark]);
    await applyMappings(client,connection,affected);
  });
  return {imported,skipped,linked:new Set(affected).size,hasMore:Boolean(cursor)};
}

export async function archiveCrmObjectPage(connection,kind,items,{cursor=null}={}){
  if(!crmFields[kind]||!Array.isArray(items)||items.length>200||cursor!==null&&(typeof cursor!=='string'||cursor.length>512))throw new AppError('Invalid archived CRM page.',502,'CRM_INVALID_RESPONSE');
  await transaction(async client=>{
    const affected=[];
    for(const item of items){
      const externalId=String(connection.provider==='salesforce'?item?.Id:item?.id||'');
      if(connection.provider==='salesforce'&&!new RegExp(`^${kind==='company'?'001':'006'}[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$`).test(externalId)||connection.provider==='hubspot'&&!/^\d{1,32}$/.test(externalId))throw new AppError('Invalid archived CRM identity.',502,'CRM_INVALID_RESPONSE');
      const at=new Date(connection.provider==='salesforce'?item.LastModifiedDate:item.archivedAt||item.updatedAt);
      if(!Number.isFinite(at.getTime()))throw new AppError('Invalid archived CRM timestamp.',502,'CRM_INVALID_RESPONSE');
      const changed=(await client.query(`UPDATE crm_object_records SET archived=TRUE,external_updated_at=$1,updated_at=NOW()
        WHERE business_id=$2 AND connection_id=$3 AND kind=$4 AND external_id=$5 AND external_updated_at<=$1 RETURNING external_id`,[at.toISOString(),connection.business_id,connection.id,kind,externalId])).rowCount;
      if(!changed)continue;
      const removed=(await client.query('DELETE FROM crm_object_contacts WHERE business_id=$1 AND connection_id=$2 AND kind=$3 AND external_id=$4 RETURNING contact_id',[connection.business_id,connection.id,kind,externalId])).rows;
      affected.push(...removed.map(row=>row.contact_id));
    }
    if(cursor!==null)await client.query(`INSERT INTO crm_object_cursors(business_id,connection_id,kind,archived_cursor) VALUES($1,$2,$3,$4)
      ON CONFLICT(connection_id,kind) DO UPDATE SET archived_cursor=EXCLUDED.archived_cursor,updated_at=NOW()`,[connection.business_id,connection.id,kind,cursor]);
    await applyMappings(client,connection,affected);
  });
}

export async function crmObjectSettings(businessId,connectionId){
  const [objects,mappings]=await Promise.all([
    query(`SELECT r.kind,r.external_id,r.display_name,r.fields,r.external_updated_at,r.archived,COUNT(l.contact_id)::int AS linked_contacts
      FROM crm_object_records r LEFT JOIN crm_object_contacts l ON l.business_id=r.business_id AND l.connection_id=r.connection_id AND l.kind=r.kind AND l.external_id=r.external_id
      WHERE r.business_id=$1 AND r.connection_id=$2 GROUP BY r.connection_id,r.kind,r.external_id ORDER BY r.external_updated_at DESC LIMIT 40`,[businessId,connectionId]),
    query('SELECT kind,source_field,attribute_key,enabled,push_enabled FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 ORDER BY kind,source_field',[businessId,connectionId])
  ]);
  return {objects:objects.rows,mappings:mappings.rows};
}

export async function reconcileSalesforceAccountLinks(connection){
  await transaction(async client=>{
    const removed=(await client.query(`DELETE FROM crm_object_contacts x WHERE x.business_id=$1 AND x.connection_id=$2 AND x.kind='company'
      AND NOT EXISTS(SELECT 1 FROM crm_contact_links l WHERE l.business_id=x.business_id AND l.connection_id=x.connection_id
        AND l.contact_id=x.contact_id AND l.external_object_type='Contact' AND l.account_external_id=x.external_id)
      RETURNING contact_id`,[connection.business_id,connection.id])).rows;
    const added=(await client.query(`INSERT INTO crm_object_contacts(business_id,connection_id,kind,external_id,contact_id)
      SELECT r.business_id,r.connection_id,'company',r.external_id,l.contact_id FROM crm_object_records r
      JOIN crm_contact_links l ON l.business_id=r.business_id AND l.connection_id=r.connection_id
        AND l.account_external_id=r.external_id AND l.external_object_type='Contact'
      WHERE r.business_id=$1 AND r.connection_id=$2 AND r.kind='company' AND NOT r.archived
      ON CONFLICT DO NOTHING RETURNING contact_id`,[connection.business_id,connection.id])).rows;
    await applyMappings(client,connection,[...removed,...added].map(row=>row.contact_id));
  });
}

export async function saveCrmFieldMapping(session,connection,body){
  if(!crmFields[body.kind]?.includes(body.sourceField)||!keyPattern.test(body.attributeKey||'')||['phone','name','marketing_permission','unsubscribed'].includes(body.attributeKey))throw new AppError('Choose an allowed CRM field and contact attribute key.',400,'CRM_MAPPING_INVALID');
  await transaction(async client=>{
    const duplicate=(await client.query('SELECT 1 FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 AND attribute_key=$3 AND (kind<>$4 OR source_field<>$5)',[session.businessId,connection.id,body.attributeKey,body.kind,body.sourceField])).rowCount;
    if(duplicate)throw new AppError('That contact attribute already has a CRM source.',409,'CRM_MAPPING_CONFLICT');
    const previous=(await client.query('SELECT attribute_key FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 AND kind=$3 AND source_field=$4',[session.businessId,connection.id,body.kind,body.sourceField])).rows[0];
    const pushEnabled=body.pushEnabled===true;
    await client.query(`INSERT INTO crm_field_mappings(business_id,connection_id,kind,source_field,attribute_key,push_enabled) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(connection_id,kind,source_field) DO UPDATE SET attribute_key=EXCLUDED.attribute_key,enabled=TRUE,push_enabled=EXCLUDED.push_enabled`,[session.businessId,connection.id,body.kind,body.sourceField,body.attributeKey,pushEnabled]);
    const contacts=(await client.query('SELECT DISTINCT contact_id FROM crm_object_contacts WHERE business_id=$1 AND connection_id=$2 AND kind=$3',[session.businessId,connection.id,body.kind])).rows.map(row=>row.contact_id);
    if(previous&&previous.attribute_key!==body.attributeKey)await client.query('UPDATE contacts SET custom_attributes=custom_attributes-$1,updated_at=NOW() WHERE business_id=$2 AND id=ANY($3::text[])',[previous.attribute_key,session.businessId,contacts]);
    await applyMappings(client,connection,contacts);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'crm_field_mapping_saved',JSON.stringify({provider:connection.provider,kind:body.kind,field:body.sourceField,attributeKey:body.attributeKey})]);
  });
}

export async function removeCrmFieldMapping(session,connection,body){
  if(!crmFields[body.kind]?.includes(body.sourceField))throw new AppError('Choose an existing CRM mapping.',400,'CRM_MAPPING_INVALID');
  await transaction(async client=>{
    const removed=(await client.query('DELETE FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 AND kind=$3 AND source_field=$4 RETURNING attribute_key',[session.businessId,connection.id,body.kind,body.sourceField])).rows[0];
    if(!removed)throw new AppError('CRM mapping not found.',404,'NOT_FOUND');
    const contacts=(await client.query('SELECT DISTINCT contact_id FROM crm_object_contacts WHERE business_id=$1 AND connection_id=$2 AND kind=$3',[session.businessId,connection.id,body.kind])).rows.map(row=>row.contact_id);
    await client.query('UPDATE contacts SET custom_attributes=custom_attributes-$1,updated_at=NOW() WHERE business_id=$2 AND id=ANY($3::text[])',[removed.attribute_key,session.businessId,contacts]);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'crm_field_mapping_removed',JSON.stringify({provider:connection.provider,kind:body.kind,field:body.sourceField})]);
  });
}

export async function setCrmObjectSync(session,provider,enabled){
  if(!['hubspot','salesforce'].includes(provider)||typeof enabled!=='boolean')throw new AppError('Choose a valid object sync status.',400,'CRM_INVALID_ACTION');
  await transaction(async client=>{
    const connection=(await client.query('UPDATE crm_connections SET sync_objects_enabled=$1,updated_at=NOW() WHERE business_id=$2 AND provider=$3 RETURNING id',[enabled,session.businessId,provider])).rows[0];
    if(!connection)throw new AppError('Connect the CRM first.',409,'CRM_NOT_CONNECTED');
    if(!enabled)await clearCrmMappedAttributes(client,session.businessId,connection.id);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'crm_object_sync_toggled',JSON.stringify({provider,enabled})]);
  });
}

export async function clearCrmMappedAttributes(client,businessId,connectionId){
  const keys=(await client.query('SELECT attribute_key FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2',[businessId,connectionId])).rows.map(row=>row.attribute_key);
  if(keys.length)await client.query(`UPDATE contacts c SET custom_attributes=c.custom_attributes-$1::text[],updated_at=NOW()
    WHERE c.business_id=$2 AND c.custom_attributes ?| $1::text[] AND EXISTS(
      SELECT 1 FROM crm_object_contacts l WHERE l.business_id=c.business_id AND l.connection_id=$3 AND l.contact_id=c.id)`,[keys,businessId,connectionId]);
}
