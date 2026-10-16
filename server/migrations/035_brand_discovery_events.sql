BEGIN;
CREATE TABLE IF NOT EXISTS brand_discovery_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  job_id BIGINT NOT NULL REFERENCES brand_discovery_jobs(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  stage TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS brand_discovery_events_job_time_idx ON brand_discovery_events(tenant_id,job_id,id DESC);
CREATE INDEX IF NOT EXISTS brand_discovery_events_time_idx ON brand_discovery_events(created_at);
CREATE INDEX IF NOT EXISTS amap_usage_events_discovery_idx ON amap_usage_events(tenant_id,source_type,source_id,id DESC);
CREATE INDEX IF NOT EXISTS brand_stores_job_activity_idx ON brand_stores(tenant_id,last_job_id,updated_at DESC);
COMMIT;
