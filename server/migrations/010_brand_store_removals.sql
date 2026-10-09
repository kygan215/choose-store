-- Keep the source UID as a tombstone so discovery cannot recreate removed POIs.
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE TABLE IF NOT EXISTS brand_store_removals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_store_id BIGINT NOT NULL REFERENCES brand_stores(id) ON DELETE CASCADE,
  snapshot_json JSONB NOT NULL,
  reason TEXT NOT NULL,
  deleted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  restored_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_store_removal_open
  ON brand_store_removals(tenant_id,brand_store_id) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_stores_removed
  ON brand_stores(tenant_id,deleted_at DESC,id DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_brand_stores_active_browse
  ON brand_stores(tenant_id,city,district,brand_name,amap_name,id)
  WHERE library_visible AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_stores_active_filters
  ON brand_stores(tenant_id,brand_name,province,city,district)
  WHERE library_visible AND deleted_at IS NULL;
