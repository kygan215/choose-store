CREATE TABLE IF NOT EXISTS amap_usage_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  usage_date DATE NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  operation TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 1 CHECK (calls > 0),
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amap_usage_events_tenant_date
  ON amap_usage_events(tenant_id, usage_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amap_usage_events_user_date
  ON amap_usage_events(tenant_id, user_id, usage_date, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_amap_usage_events_source
  ON amap_usage_events(tenant_id, source_type, source_id);
