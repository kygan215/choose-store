-- Historical identity is independent of Amap coverage. These fields record a
-- human-confirmed GCJ02 location without overwriting imported source facts.
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS verified_address TEXT;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS verified_longitude DOUBLE PRECISION;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS verified_latitude DOUBLE PRECISION;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS location_source TEXT;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS location_evidence TEXT;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS location_confirmed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS location_confirmed_at TIMESTAMPTZ;
ALTER TABLE history_stores ADD COLUMN IF NOT EXISTS location_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE history_poi_candidates ADD COLUMN IF NOT EXISTS source_location_version BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS history_stores_tenant_identity_idx ON history_stores(tenant_id,id);
ALTER TABLE stores ADD COLUMN IF NOT EXISTS history_store_id BIGINT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS history_linked_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS history_linked_at TIMESTAMPTZ;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS history_link_reason TEXT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='history_stores_verified_location_check' AND conrelid='history_stores'::regclass) THEN
  ALTER TABLE history_stores ADD CONSTRAINT history_stores_verified_location_check CHECK (
   (verified_longitude IS NULL AND verified_latitude IS NULL AND verified_address IS NULL AND location_confirmed_at IS NULL)
   OR (verified_longitude IS NOT NULL AND verified_latitude IS NOT NULL AND verified_longitude BETWEEN 72.004 AND 137.8347 AND verified_latitude BETWEEN 0.8293 AND 55.8271
       AND verified_address IS NOT NULL AND length(btrim(verified_address)) BETWEEN 1 AND 500
       AND location_source IS NOT NULL AND location_source IN ('manual','amap_share') AND location_confirmed_at IS NOT NULL));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='stores_history_tenant_fk' AND conrelid='stores'::regclass) THEN
  ALTER TABLE stores ADD CONSTRAINT stores_history_tenant_fk FOREIGN KEY(tenant_id,history_store_id) REFERENCES history_stores(tenant_id,id) ON DELETE SET NULL (history_store_id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS stores_history_link_idx ON stores(tenant_id,history_store_id) WHERE history_store_id IS NOT NULL;
