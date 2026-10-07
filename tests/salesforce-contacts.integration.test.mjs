import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {enterSystemContext,query} from '../lib/db.js';
import {encryptSecret} from '../lib/meta.js';
import {syncSalesforceContacts} from '../lib/salesforce-contacts.js';
import {saveCrmFieldMapping} from '../lib/crm-objects.js';

test('Salesforce contact sync imports a bounded page and exports a linked local edit',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='sfb_'+suffix,connection='crmc_'+suffix;
  const remoteId='003000000000000AAA',leadId='00Q000000000000AAA',remoteTime='2026-10-01T12:00:00.000Z';
  const oldFetch=global.fetch,oldClient=process.env.SALESFORCE_CLIENT_ID,oldSecret=process.env.SALESFORCE_CLIENT_SECRET,oldVersion=process.env.SALESFORCE_API_VERSION;
  process.env.SALESFORCE_CLIENT_ID='client';process.env.SALESFORCE_CLIENT_SECRET='secret';process.env.SALESFORCE_API_VERSION='60.0';
  let patches=0,leadPatches=0,queries=0,refreshes=0;
  global.fetch=async(url,options)=>{
    if(String(url).endsWith('/services/oauth2/token')){refreshes++;return Response.json({access_token:'access-token'});}
    if(String(url).includes('/query?')||String(url).includes('/queryAll?')){
      queries++;
      const soql=new URL(url).searchParams.get('q');
      assert.doesNotMatch(soql,/LIMIT 100/);
      assert.equal(options.headers['Sforce-Query-Options'],'batchSize=200');
      if(soql.includes('FROM Lead'))return Response.json({done:true,records:[{Id:leadId,FirstName:'Grace',LastName:'Hopper',MobilePhone:'+15557654321',LastModifiedDate:remoteTime,IsConverted:false}]});
      if(soql.includes('FROM OpportunityContactRole'))return Response.json({done:true,records:[{OpportunityId:'006000000000000AAA',ContactId:remoteId}]});
      if(soql.includes('FROM Opportunity'))return Response.json({done:true,records:[{Id:'006000000000000AAA',Name:'Renewal',StageName:'Proposal',Amount:250,CloseDate:'2026-11-01',LastModifiedDate:remoteTime,IsDeleted:false}]});
      if(soql.includes('FROM Account'))return Response.json({done:true,records:[{Id:'001000000000000AAA',Name:'Company',Industry:'Software',LastModifiedDate:remoteTime,IsDeleted:false}]});
      return Response.json({done:true,records:[{Id:remoteId,FirstName:'Ada',LastName:'Lovelace',MobilePhone:'+15551234567',AccountId:'001000000000000AAA',LastModifiedDate:remoteTime}]});
    }
    if(String(url).endsWith('/sobjects/Contact/'+remoteId)&&options.method==='GET')return Response.json({LastModifiedDate:remoteTime});
    if(String(url).endsWith('/sobjects/Contact/'+remoteId)&&options.method==='PATCH'){patches++;assert.equal(JSON.parse(options.body).LastName,'Byron');return new Response(null,{status:204});}
    if(String(url).endsWith('/sobjects/Lead/'+leadId)&&options.method==='GET')return Response.json({LastModifiedDate:remoteTime,IsConverted:false});
    if(String(url).endsWith('/sobjects/Lead/'+leadId)&&options.method==='PATCH'){leadPatches++;assert.equal(JSON.parse(options.body).LastName,'Murray');return new Response(null,{status:204});}
    throw new Error('Unexpected Salesforce request');
  };
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$2,$1)',[business,'Salesforce sync test']);
    await query("INSERT INTO crm_connections(id,business_id,provider,external_account_id,instance_url,access_encrypted,refresh_encrypted,expires_at,enabled) VALUES($1,$2,'salesforce',$3,'https://tenant.my.salesforce.com',$4,$5,NOW(),TRUE)",[connection,business,'00D000000000000AAA',encryptSecret('old-access'),encryptSecret('refresh')]);
    const first=await syncSalesforceContacts(business);
    assert.equal(first.imported,1);
    assert.equal(first.exported,0);
    const contact=(await query("SELECT c.id,c.name,c.source FROM contacts c JOIN crm_contact_links l ON l.contact_id=c.id AND l.business_id=c.business_id WHERE l.business_id=$1 AND l.connection_id=$2",[business,connection])).rows[0];
    assert.equal(contact.name,'Ada Lovelace');
    assert.equal(contact.source,'Salesforce');
    await query("UPDATE contacts SET name='Ada Byron',updated_at=NOW()+INTERVAL '1 second' WHERE id=$1 AND business_id=$2",[contact.id,business]);
    const second=await syncSalesforceContacts(business);
    assert.equal(second.exported,1);
    assert.equal(patches,1);
    assert.equal(queries,2);
    assert.equal(refreshes,2);
    await query('UPDATE crm_connections SET sync_leads_enabled=TRUE WHERE id=$1 AND business_id=$2',[connection,business]);
    const leadSync=await syncSalesforceContacts(business);
    assert.equal(leadSync.imported,1);
    const lead=(await query("SELECT c.id,l.external_object_type FROM contacts c JOIN crm_contact_links l ON l.contact_id=c.id AND l.business_id=c.business_id WHERE l.business_id=$1 AND l.connection_id=$2 AND l.external_id=$3",[business,connection,leadId])).rows[0];
    assert.equal(lead.external_object_type,'Lead');
    await query("UPDATE contacts SET name='Grace Murray',updated_at=NOW()+INTERVAL '1 second' WHERE id=$1 AND business_id=$2",[lead.id,business]);
    const exportedLead=await syncSalesforceContacts(business);
    assert.equal(exportedLead.exported,1);
    assert.equal(leadPatches,1);
    const connectionState=(await query('SELECT cursor,lead_cursor,contact_watermark,lead_watermark FROM crm_connections WHERE id=$1 AND business_id=$2',[connection,business])).rows[0];
    assert.equal(connectionState.cursor,'');
    assert.equal(connectionState.lead_cursor,'');
    assert.ok(connectionState.contact_watermark);
    assert.ok(connectionState.lead_watermark);
    await saveCrmFieldMapping({businessId:business,userId:null},{business_id:business,id:connection,provider:'salesforce'},{kind:'deal',sourceField:'stage',attributeKey:'opportunity_stage'});
    await query('UPDATE crm_connections SET sync_objects_enabled=TRUE WHERE id=$1 AND business_id=$2',[connection,business]);
    const objects=await syncSalesforceContacts(business);
    assert.equal(objects.objects.company.linked,1);
    assert.equal(objects.objects.deal.linked,1);
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE business_id=$1 AND id=$2',[business,contact.id])).rows[0].custom_attributes.opportunity_stage,'Proposal');
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[business]);
    global.fetch=oldFetch;
    for(const [key,value] of [['SALESFORCE_CLIENT_ID',oldClient],['SALESFORCE_CLIENT_SECRET',oldSecret],['SALESFORCE_API_VERSION',oldVersion]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
});
