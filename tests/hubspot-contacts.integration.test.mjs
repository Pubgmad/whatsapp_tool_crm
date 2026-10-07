import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {enterSystemContext,query} from '../lib/db.js';
import {encryptSecret} from '../lib/meta.js';
import {syncHubSpotContacts} from '../lib/hubspot-contacts.js';
import {saveCrmFieldMapping} from '../lib/crm-objects.js';

test('HubSpot sync imports without consent and preserves a local edit before outbound update',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),businessId='hsb_'+suffix,connectionId='crmc_'+suffix;
  const originalFetch=global.fetch;
  let patchCount=0;
  const requested=[];
  global.fetch=async(url,options)=>{
    requested.push({url:String(url),method:options.method});
    if(String(url).includes('archived=true'))return Response.json({results:[]});
    if(String(url).includes('/companies?'))return Response.json({results:[{id:'321',updatedAt:new Date().toISOString(),properties:{name:'Acme',industry:'Software'},associations:{contacts:{results:[{id:'123'}]}}}]});
    if(String(url).includes('/deals?'))return Response.json({results:[{id:'456',updatedAt:new Date().toISOString(),properties:{dealname:'Renewal',dealstage:'qualified',amount:'120'},associations:{contacts:{results:[{id:'123'}]}}}]});
    if(options.method==='PATCH'){
      patchCount++;
      const body=JSON.parse(options.body);
      requested.push(body);
      return Response.json({id:'123',updatedAt:new Date().toISOString()});
    }
    return Response.json({results:[{id:'123',updatedAt:new Date().toISOString(),properties:{phone:'+15551234567',firstname:'Remote',lastname:'Name'}}]});
  };
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$2,$1)',[businessId,'Sync business']);
    await query("INSERT INTO crm_connections(id,business_id,provider,external_account_id,access_encrypted,refresh_encrypted,expires_at,enabled) VALUES($1,$2,'hubspot',$3,$4,$5,NOW()+INTERVAL '1 day',TRUE)",[connectionId,businessId,'12345',encryptSecret('test-access'),encryptSecret('test-refresh')]);
    const first=await syncHubSpotContacts(businessId);
    assert.equal(first.imported,1);
    const contact=(await query('SELECT id,marketing_permission,opt_in_at,name,phone FROM contacts WHERE business_id=$1',[businessId])).rows[0];
    assert.equal(contact.name,'Remote Name');
    assert.equal(contact.phone,'15551234567');
    assert.equal(contact.marketing_permission,false);
    assert.equal(contact.opt_in_at,null);
    await query("UPDATE contacts SET name='Local Name',updated_at=NOW()+INTERVAL '1 second' WHERE id=$1 AND business_id=$2",[contact.id,businessId]);
    const second=await syncHubSpotContacts(businessId);
    assert.equal(second.conflicts,1);
    assert.equal(second.exported,1);
    assert.equal(patchCount,1);
    assert.match(requested[0].url,/\/crm\/objects\/2026-03\/contacts\?/);
    assert.equal(requested.find(item=>item.properties)?.properties.firstname,'Local');
    assert.equal((await query('SELECT name FROM contacts WHERE id=$1',[contact.id])).rows[0].name,'Local Name');
    await saveCrmFieldMapping({businessId,userId:null},{business_id:businessId,id:connectionId,provider:'hubspot'},{kind:'deal',sourceField:'stage',attributeKey:'sales_stage'});
    await query('UPDATE crm_connections SET sync_objects_enabled=TRUE WHERE id=$1 AND business_id=$2',[connectionId,businessId]);
    const objectSync=await syncHubSpotContacts(businessId);
    assert.equal(objectSync.objects.company.linked,1);
    assert.equal(objectSync.objects.deal.linked,1);
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE business_id=$1 AND id=$2',[businessId,contact.id])).rows[0].custom_attributes.sales_stage,'qualified');
  }finally{
    global.fetch=originalFetch;
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[businessId]);
  }
});
