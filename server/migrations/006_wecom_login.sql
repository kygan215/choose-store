ALTER TABLE users ADD COLUMN IF NOT EXISTS wecom_corp_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wecom_user_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wecom_avatar TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wecom_identity
  ON users(wecom_corp_id,wecom_user_id)
  WHERE wecom_corp_id IS NOT NULL AND wecom_user_id IS NOT NULL;
