CREATE TABLE IF NOT EXISTS operations_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK(service IN ('api','worker','web')),
  level TEXT NOT NULL CHECK(level IN ('info','warn','error')),
  module TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  request_id TEXT,
  task_type TEXT,
  task_id TEXT,
  duration_ms INTEGER,
  status_code INTEGER,
  details_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS operations_logs_tenant_time_idx ON operations_logs(tenant_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS operations_logs_task_idx ON operations_logs(tenant_id,task_type,task_id,created_at DESC);
CREATE INDEX IF NOT EXISTS operations_logs_request_idx ON operations_logs(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS operations_logs_time_idx ON operations_logs(created_at);
CREATE INDEX IF NOT EXISTS amap_usage_events_tenant_time_idx ON amap_usage_events(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_time_idx ON audit_logs(tenant_id,created_at DESC);
