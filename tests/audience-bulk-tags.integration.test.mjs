import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import { bulkTagUpdateStatement } from '../lib/audience-bulk-tags.js';
import { enterSystemContext, query } from '../lib/db.js';

test('bulk tags only mutate the frozen tenant snapshot',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL; enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex');
  const business='bt_'+suffix,other='bto_'+suffix,segment='seg_'+suffix,job='atj_'+suffix;
  const frozen='ctf_'+suffix,later='ctl_'+suffix,foreign='ctx_'+suffix;
  try {
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1),($2,$2,$2)',[business,other]);
    await query(
      `INSERT INTO contacts(id,business_id,name,phone,marketing_permission,tags) VALUES
       ($1,$4,'Frozen','1001',TRUE,'["old"]'),($2,$4,'Later match','1002',TRUE,'["old"]'),($3,$5,'Foreign','1003',TRUE,'["old"]')`,
      [frozen,later,foreign,business,other]
    );
    await query("INSERT INTO audience_segments(id,business_id,name,rules) VALUES($1,$2,'Bulk tags','{}')",[segment,business]);
    await query(
      `INSERT INTO audience_tag_jobs(id,business_id,segment_id,idempotency_key,operation,tags)
       VALUES($1,$2,$3,$4,'add','["vip"]')`,
      [job,business,segment,'integration:'+suffix]
    );
    await query('INSERT INTO audience_tag_job_contacts(job_id,business_id,contact_id) VALUES($1,$2,$3)',[job,business,frozen]);
    const statement=bulkTagUpdateStatement(business,job,'add',['vip']);
    assert.equal((await query(statement.text,statement.params)).rowCount,1);
    const rows=(await query('SELECT id,tags FROM contacts WHERE id=ANY($1::text[])',[frozen,later,foreign])).rows;
    const tags=Object.fromEntries(rows.map(row=>[row.id,row.tags]));
    assert.deepEqual(new Set(tags[frozen]),new Set(['old','vip']));
    assert.deepEqual(tags[later],['old']);
    assert.deepEqual(tags[foreign],['old']);
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=ANY($1::text[])',[[business,other]]);
  }
});
