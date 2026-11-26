-- WhatsApp Automation release: one automated reply-bot outcome per inbound message (per tenant).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_bot_executions_inbound_idempotent
  ON reply_bot_executions (business_id, inbound_message_id)
  WHERE COALESCE(inbound_message_id, '') <> '';