import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {enterSystemContext,query} from '../lib/db.js';
import {archiveCrmObjectPage,normalizeCrmObject,removeCrmFieldMapping,saveCrmFieldMapping,setCrmObjectSync,storeCrmObjectPage} from '../lib/crm-objects.js';

test('CRM objects reject invalid provider identities and incomplete associations',()=>{
  assert.equal(normalizeCrmObject('salesforce','company',{Id:'006000000000000AAA',Name:'Wrong',LastModifiedDate:new Date().toISOString()}),null);
  assert.equal(normalizeCrmObject('hubspot','deal',{id:'not-an-id',properties:{dealname:'Wrong'},updatedAt:new Date().toISOString()}),null);
  assert.throws(()=>normalizeCrmObject('hubspot','company',{id:'123',properties:{name:'Company'},updatedAt:new Date().toISOString(),associations:{contacts:{paging:{next:{after:'more'}}}}}),{code:'CRM_ASSOCIATIONS_INCOMPLETE'});
});

test('CRM object sync maps only verified same-tenant associations and ignores stale updates',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='co_'+suffix,other='co2_'+suffix;
  const connection='crmc_'+suffix,contact='ct_'+suffix,otherContact='ct2_'+suffix;
  const context={business_id:business,id:connection,provider:'hubspot'};
  const at=new Date().toISOString();
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1),($2,$2,$2)',[business,other]);
    await query('INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[contact,business,'Customer','15550001111',otherContact,other,'Other','15550002222']);
    await query("INSERT INTO crm_connections(id,business_id,provider,external_account_id,access_encrypted,refresh_encrypted,expires_at) VALUES($1,$2,'hubspot',$3,'x','y',NOW()+INTERVAL '1 hour')",[connection,business,suffix]);
    await query('INSERT INTO crm_contact_links(business_id,connection_id,external_id,contact_id,phone_snapshot) VALUES($1,$2,$3,$4,$5)',[business,connection,'77',contact,'15550001111']);
    const session={businessId:business,userId:null};
    await saveCrmFieldMapping(session,context,{kind:'deal',sourceField:'stage',attributeKey:'crm_stage'});
    const deal={id:'99',properties:{dealname:'Renewal',dealstage:'open',amount:'250'},updatedAt:at,associations:{contacts:{results:[{id:'77'},{id:'88'}]}}};
    const first=await storeCrmObjectPage(context,'deal',[deal]);
    assert.equal(first.imported,1);assert.equal(first.linked,1);
    const linked=(await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2',[contact,business])).rows[0];
    assert.equal(linked.custom_attributes.crm_stage,'open');
    await storeCrmObjectPage(context,'deal',[{...deal,properties:{dealname:'Old',dealstage:'lost'},updatedAt:new Date(0).toISOString()}]);
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2',[contact,business])).rows[0].custom_attributes.crm_stage,'open');
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM crm_object_contacts WHERE business_id=$1',[other])).rows[0].count,0);
    await setCrmObjectSync(session,'hubspot',false);
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2',[contact,business])).rows[0].custom_attributes.crm_stage,undefined);
    await setCrmObjectSync(session,'hubspot',true);
    await storeCrmObjectPage(context,'deal',[deal]);
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2',[contact,business])).rows[0].custom_attributes.crm_stage,'open');
    await archiveCrmObjectPage(context,'deal',[{id:'99',updatedAt:new Date(Date.now()+5000).toISOString()}],{cursor:''});
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2',[contact,business])).rows[0].custom_attributes.crm_stage,undefined);
    assert.equal((await query('SELECT archived FROM crm_object_records WHERE connection_id=$1 AND kind=$2 AND external_id=$3',[connection,'deal','99'])).rows[0].archived,true);
    await removeCrmFieldMapping(session,context,{kind:'deal',sourceField:'stage'});
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2',[contact,business])).rows[0].custom_attributes.crm_stage,undefined);
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});
