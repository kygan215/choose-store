-- Historical campaign sales are facts, separate from analysis task stores and live POIs.
-- Every migration is replayed at startup, so all DDL is deliberately idempotent.
CREATE TABLE IF NOT EXISTS history_permissions (
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,user_id)
);

CREATE TABLE IF NOT EXISTS history_imports (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  original_file BYTEA NOT NULL,
  original_sha256 TEXT NOT NULL,
  parsed_json JSONB NOT NULL,
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_history_imports_tenant ON history_imports(tenant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS history_stores (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_key TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  store_name TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  poi_id TEXT,
  brand_store_id BIGINT REFERENCES brand_stores(id) ON DELETE SET NULL,
  archive_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,identity_key)
);
CREATE INDEX IF NOT EXISTS idx_history_stores_filters ON history_stores(tenant_id,brand_name,province,city);
CREATE INDEX IF NOT EXISTS idx_history_stores_link ON history_stores(tenant_id,brand_store_id);

-- A rare physical deletion must preserve previously linked campaign history in
-- the main history view. Ordinary brand-library removals are soft deletions.
CREATE OR REPLACE FUNCTION history_keep_archived_on_brand_delete() RETURNS trigger AS $$
BEGIN
  UPDATE history_stores SET archive_only=TRUE,brand_store_id=NULL,updated_at=NOW()
  WHERE tenant_id=OLD.tenant_id AND brand_store_id=OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS history_brand_store_before_delete ON brand_stores;
CREATE TRIGGER history_brand_store_before_delete BEFORE DELETE ON brand_stores
FOR EACH ROW EXECUTE FUNCTION history_keep_archived_on_brand_delete();

CREATE TABLE IF NOT EXISTS history_activities (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  history_store_id BIGINT NOT NULL REFERENCES history_stores(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  activity_name TEXT NOT NULL,
  sales_amount NUMERIC(16,2) CHECK (sales_amount IS NULL OR sales_amount >= 0),
  refund_basis TEXT NOT NULL DEFAULT 'unknown' CHECK (refund_basis IN ('refunded','not_refunded','unknown')),
  brand_name TEXT NOT NULL,
  store_name TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  source_import_id BIGINT REFERENCES history_imports(id) ON DELETE SET NULL,
  source_sheet TEXT,
  source_cell TEXT,
  calendar_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  revoked_at TIMESTAMPTZ,
  revoked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_history_activity_one_period ON history_activities(tenant_id,history_store_id,start_date,end_date) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_history_activity_filters ON history_activities(tenant_id,start_date,brand_name,province,city) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS history_activity_revisions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id BIGINT NOT NULL REFERENCES history_activities(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create','update','revoke')),
  before_json JSONB,
  after_json JSONB,
  reason TEXT NOT NULL DEFAULT '',
  changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_history_revisions_activity ON history_activity_revisions(tenant_id,activity_id,changed_at DESC);
