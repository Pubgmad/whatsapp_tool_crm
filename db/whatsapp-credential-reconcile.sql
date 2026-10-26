-- Production backfill: keep businesses ↔ whatsapp_accounts credentials aligned.
-- Safe to re-run. Prefer live account tokens; demote fake Connected rows.
SELECT set_config('app.system_access','true', true);

-- 0) Create missing account rows from businesses credentials (same tenant only).
INSERT INTO whatsapp_accounts (
  id, business_id, waba_id, onboarding_method, access_token_encrypted,
  token_expires_at, webhook_subscribed, is_default, status, last_synced_at
)
SELECT 'waa_' || substr(md5(b.id || ':' || b.waba_id), 1, 16),
  b.id, b.waba_id, COALESCE(NULLIF(b.onboarding_method,''), 'manual'),
  b.access_token_encrypted, b.meta_token_expires_at, b.webhook_subscribed,
  FALSE, 'connected', NOW()
FROM businesses b
WHERE b.waba_id <> '' AND b.access_token_encrypted <> ''
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_accounts a
    WHERE a.business_id = b.id AND a.waba_id = b.waba_id
  )
ON CONFLICT (waba_id) DO NOTHING;

INSERT INTO whatsapp_phone_numbers (
  id, business_id, whatsapp_account_id, phone_number_id, display_phone_number,
  is_default, registration_state, onboarding_method, last_synced_at
)
SELECT 'wap_' || substr(md5(b.id || ':' || b.phone_number_id), 1, 16),
  b.id, a.id, b.phone_number_id, COALESCE(b.whatsapp_number,''),
  FALSE, 'unknown', COALESCE(NULLIF(b.onboarding_method,''), 'manual'), NOW()
FROM businesses b
JOIN whatsapp_accounts a ON a.business_id = b.id AND a.waba_id = b.waba_id
WHERE b.phone_number_id <> ''
  AND NOT EXISTS (
    SELECT 1 FROM whatsapp_phone_numbers p
    WHERE p.business_id = b.id AND p.phone_number_id = b.phone_number_id
  )
ON CONFLICT (phone_number_id) DO NOTHING;

UPDATE whatsapp_accounts
SET status = 'disconnected', is_default = FALSE, updated_at = NOW()
WHERE status = 'connected' AND COALESCE(access_token_encrypted, '') = '';

-- 1) Copy live account token onto businesses when the business row is missing credentials.
UPDATE businesses b
SET
  waba_id = COALESCE(NULLIF(b.waba_id, ''), a.waba_id),
  phone_number_id = COALESCE(NULLIF(b.phone_number_id, ''), p.phone_number_id),
  whatsapp_number = COALESCE(NULLIF(b.whatsapp_number, ''), p.display_phone_number, b.whatsapp_number),
  access_token_encrypted = a.access_token_encrypted,
  meta_token_expires_at = COALESCE(a.token_expires_at, b.meta_token_expires_at),
  webhook_subscribed = COALESCE(a.webhook_subscribed, b.webhook_subscribed),
  meta_connected_at = COALESCE(b.meta_connected_at, NOW()),
  status = 'Connected',
  updated_at = NOW()
FROM whatsapp_accounts a
LEFT JOIN LATERAL (
  SELECT phone_number_id, display_phone_number
    FROM whatsapp_phone_numbers
   WHERE business_id = a.business_id AND whatsapp_account_id = a.id
   ORDER BY is_default DESC, created_at DESC
   LIMIT 1
) p ON TRUE
WHERE a.business_id = b.id
  AND a.status = 'connected'
  AND COALESCE(a.access_token_encrypted, '') <> ''
  AND (
    COALESCE(b.access_token_encrypted, '') = ''
    OR COALESCE(b.waba_id, '') = ''
    OR COALESCE(b.phone_number_id, '') = ''
    OR b.status IS DISTINCT FROM 'Connected'
  );

-- 2) Copy business token onto empty whatsapp_accounts for the same WABA.
UPDATE whatsapp_accounts a
SET
  access_token_encrypted = b.access_token_encrypted,
  token_expires_at = COALESCE(b.meta_token_expires_at, a.token_expires_at),
  webhook_subscribed = COALESCE(b.webhook_subscribed, a.webhook_subscribed),
  status = 'connected',
  is_default = TRUE,
  updated_at = NOW()
FROM businesses b
WHERE a.business_id = b.id
  AND a.waba_id = b.waba_id
  AND COALESCE(b.access_token_encrypted, '') <> ''
  AND COALESCE(b.waba_id, '') <> ''
  AND COALESCE(a.access_token_encrypted, '') = '';

-- 3) Ensure only one default account per business among live-token rows.
UPDATE whatsapp_accounts a
SET is_default = (a.id = live.id),
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (business_id) id, business_id
    FROM whatsapp_accounts
   WHERE COALESCE(access_token_encrypted, '') <> ''
   ORDER BY business_id, CASE WHEN status = 'connected' THEN 0 ELSE 1 END, is_default DESC, created_at
) live
WHERE a.business_id = live.business_id
  AND a.is_default IS DISTINCT FROM (a.id = live.id);

-- 4) Demote Connected businesses that still have no credentials and no live account.
UPDATE businesses b
SET status = 'Needs setup',
    updated_at = NOW()
WHERE b.status = 'Connected'
  AND (
    COALESCE(b.access_token_encrypted, '') = ''
    OR COALESCE(b.waba_id, '') = ''
    OR COALESCE(b.phone_number_id, '') = ''
  )
  AND NOT EXISTS (
    SELECT 1
      FROM whatsapp_accounts a
     WHERE a.business_id = b.id
       AND a.status = 'connected'
       AND COALESCE(a.access_token_encrypted, '') <> ''
  );
