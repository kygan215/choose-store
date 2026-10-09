CREATE TABLE IF NOT EXISTS brand_dashboard_snapshots (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data_json JSONB,
  generated_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);
