CREATE INDEX IF NOT EXISTS idx_campaign_recipients_contact_timeline
  ON campaign_recipients(contact_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_flow_invites_contact_timeline
  ON whatsapp_flow_invites(business_id,contact_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_flow_submissions_contact_timeline
  ON whatsapp_flow_submissions(business_id,contact_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_calls_remote_timeline
  ON whatsapp_calls(business_id,remote_number,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_contact_tag_timeline
  ON audit_logs(business_id,(metadata->>'contactId'),at DESC,id DESC)
  WHERE action='inbox_contact_tags_updated';
