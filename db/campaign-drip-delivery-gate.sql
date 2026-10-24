-- Wait for Meta delivery before advancing drip enrollments to the next step.
ALTER TABLE campaign_drip_enrollments DROP CONSTRAINT IF EXISTS campaign_drip_enrollments_status_check;
ALTER TABLE campaign_drip_enrollments
  ADD CONSTRAINT campaign_drip_enrollments_status_check
  CHECK (status IN ('active', 'awaiting_delivery', 'completed', 'cancelled', 'failed'));
