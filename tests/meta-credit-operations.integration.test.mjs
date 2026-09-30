import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {enterSystemContext,query} from '../lib/db.js';

test('credit-operation ledger prevents duplicate liabilities and retries only definitive rejections',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='credit_b_'+suffix;
  const operation='credit_o_'+suffix,waba='100'+BigInt('0x'+suffix);
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)',[business]);
    const sql="INSERT INTO meta_credit_operations (id,business_id,waba_id,credit_line_id,currency,status) VALUES ($1,$2,$3,'123','INR','processing') ON CONFLICT (waba_id) DO NOTHING RETURNING id";
    assert.equal((await query(sql,[operation,business,waba])).rowCount,1);
    assert.equal((await query(sql,['duplicate_'+suffix,business,waba])).rowCount,0);
    const retry="UPDATE meta_credit_operations SET status='processing' WHERE waba_id=$1 AND credit_line_id='123' AND status='rejected' RETURNING id";
    for(const status of ['processing','unconfirmed','attached']) {
      await query('UPDATE meta_credit_operations SET status=$1 WHERE id=$2',[status,operation]);
      assert.equal((await query(retry,[waba])).rowCount,0);
    }
    await query("UPDATE meta_credit_operations SET status='rejected' WHERE id=$1",[operation]);
    assert.equal((await query(retry,[waba])).rowCount,1);
    assert.equal((await query(retry,[waba])).rowCount,0);
    const table=(await query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='meta_credit_operations'")).rows[0];
    assert.ok(table.relrowsecurity&&table.relforcerowsecurity);
    const policy=(await query("SELECT qual,with_check FROM pg_policies WHERE tablename='meta_credit_operations' AND policyname='platform_only'")).rows[0];
    assert.match(policy.qual,/app.system_access/);assert.match(policy.with_check,/app.system_access/);
    await query('DELETE FROM businesses WHERE id=$1',[business]);
    const retained=(await query('SELECT business_id FROM meta_credit_operations WHERE id=$1',[operation])).rows[0];
    assert.equal(retained.business_id,null);
    assert.equal((await query(sql,['recreated_'+suffix,null,waba])).rowCount,0);
  } finally {
    await query('DELETE FROM meta_credit_operations WHERE id=$1',[operation]);
    await query('DELETE FROM businesses WHERE id=$1',[business]);
  }
});
