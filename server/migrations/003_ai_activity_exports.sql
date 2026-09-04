ALTER TABLE ai_analyses ADD COLUMN IF NOT EXISTS cache_key TEXT;
ALTER TABLE ai_analyses ADD COLUMN IF NOT EXISTS activity_config_json JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_ai_owner_cache ON ai_analyses(tenant_id,created_by,store_id,cache_key,created_at DESC);

CREATE TABLE IF NOT EXISTS ai_export_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  control TEXT NOT NULL DEFAULT 'run',
  total_stores INTEGER NOT NULL DEFAULT 0,
  reusable_stores INTEGER NOT NULL DEFAULT 0,
  generated_stores INTEGER NOT NULL DEFAULT 0,
  failed_stores INTEGER NOT NULL DEFAULT 0,
  skipped_stores INTEGER NOT NULL DEFAULT 0,
  processed_stores INTEGER NOT NULL DEFAULT 0,
  current_store TEXT NOT NULL DEFAULT '',
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  record_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  file_expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_export_owner_created ON ai_export_jobs(tenant_id,created_by,created_at DESC);

CREATE TABLE IF NOT EXISTS ai_export_job_stores (
  id BIGSERIAL PRIMARY KEY,
  export_job_id BIGINT NOT NULL REFERENCES ai_export_jobs(id) ON DELETE CASCADE,
  store_id BIGINT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  cache_key TEXT,
  ai_analysis_id BIGINT REFERENCES ai_analyses(id) ON DELETE SET NULL,
  activity_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(export_job_id,store_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_export_store_status ON ai_export_job_stores(export_job_id,status,id);
