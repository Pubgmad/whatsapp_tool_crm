CREATE INDEX IF NOT EXISTS idx_audience_campaign_events ON campaign_recipients(campaign_id,status,contact_id);
CREATE INDEX IF NOT EXISTS idx_audience_campaign_replies ON messages(campaign_recipient_id,at) WHERE direction='incoming' AND campaign_recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audience_paid_orders_v2 ON whatsapp_orders(business_id,customer_phone,payment_event_at) WHERE payment_status IN ('captured','partially_refunded');
