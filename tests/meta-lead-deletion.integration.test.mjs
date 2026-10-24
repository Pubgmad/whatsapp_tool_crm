import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('Meta lead deletion strips enriched contacts and removes meta-only contacts', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `test_b_${suffix}`;
  const metaUserId = `meta_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)', [businessId, 'Lead del', `ld-${suffix}`]);
    const { ingestMetaLeadgenSubmission } = await import('../lib/meta-leadgen-ingest.js');
    const { purgeMetaLeadCopiesForPrincipal } = await import('../lib/meta-lead-deletion.js');
    const enrichedId = `c_enr_${suffix}`;
    await client.query(
      `INSERT INTO contacts (id,business_id,name,phone,source,custom_attributes,meta_lead_only,meta_lead_lineage)
       VALUES ($1,$2,'Customer','+15550001111','Manual','{"note":"keep"}'::jsonb,FALSE,'{}'::jsonb)`,
      [enrichedId, businessId]
    );
    await ingestMetaLeadgenSubmission(client, businessId, {
      formId: 'f1',
      leadId: `lead_enr_${suffix}`,
      metaUserId,
      field_data: [
        { name: 'phone_number', values: ['+15550001111'] },
        { name: 'email', values: ['enriched@example.test'] }
      ]
    });
    const only = await ingestMetaLeadgenSubmission(client, businessId, {
      formId: 'f2',
      leadId: `lead_only_${suffix}`,
      metaUserId,
      field_data: [{ name: 'email', values: ['only@example.test'] }]
    });
    await purgeMetaLeadCopiesForPrincipal(client, { businessId, metaUserId });
    const enriched = await client.query('SELECT custom_attributes, meta_lead_lineage FROM contacts WHERE id=$1', [enrichedId]);
    assert.equal(enriched.rows[0].custom_attributes.note, 'keep');
    assert.equal(enriched.rows[0].custom_attributes.metaLeadId, undefined);
    const onlyRow = await client.query('SELECT id FROM contacts WHERE id=$1', [only.contactId]);
    assert.equal(onlyRow.rowCount, 0);
    const events = await client.query(
      `SELECT metadata FROM events WHERE business_id=$1 AND type='meta_leadgen_ingested'`,
      [businessId]
    );
    assert.ok(events.rows.every((row) => row.metadata?.redacted === true));
  } finally {
    await client.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await client.end();
  }
});

test('deletion result code reflects unresolved legacy provenance in work log', async () => {
  const { deletionResultCodeFromWorkLog } = await import('../lib/meta-data-controls.js');
  assert.equal(deletionResultCodeFromWorkLog([{ store: 'meta_leadgen_legacy', note: 'legacy_provenance_unresolved' }]), 'partial_legacy');
  assert.equal(deletionResultCodeFromWorkLog([{ store: 'meta_leadgen_submissions', count: 1 }]), 'deleted');
});
