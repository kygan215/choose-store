// A missing Amap POI ID has no stable external identity. Its manual decision
// belongs to one saved brand_stores record, never to a guessed POI or a name.
export const brandStoreRecordReviewSql = `
CREATE TABLE IF NOT EXISTS brand_store_record_overrides (
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 brand_store_id bigint NOT NULL REFERENCES brand_stores(id) ON DELETE CASCADE,
 decision text NOT NULL CHECK (decision IN ('accept','exclude')),
 reason text NOT NULL,
 reviewed_by bigint REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY (tenant_id,brand_store_id)
);
CREATE OR REPLACE FUNCTION apply_ailingshi_override() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF btrim(COALESCE(NEW.amap_poi_id,''))<>'' THEN
  NEW.ailingshi_override := COALESCE((SELECT decision FROM ailingshi_poi_overrides
   WHERE tenant_id=NEW.tenant_id AND poi_id=NEW.amap_poi_id),'');
 ELSE
  NEW.ailingshi_override := COALESCE((SELECT decision FROM brand_store_record_overrides
   WHERE tenant_id=NEW.tenant_id AND brand_store_id=NEW.id),'');
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER apply_ailingshi_override BEFORE INSERT OR UPDATE ON brand_stores
 FOR EACH ROW EXECUTE FUNCTION apply_ailingshi_override();
`;

// The generic migration runner reapplies historical SQL files before this one.
// Earlier trigger versions understand only POI IDs, so restore the stored
// generated columns and derived counts for records already reviewed here.
// On first installation the new table is empty, making these updates no-ops.
export const brandStoreRecordReviewReconcileSql = `
UPDATE brand_stores AS s SET updated_at=s.updated_at
FROM brand_store_record_overrides AS o
WHERE s.tenant_id=o.tenant_id AND s.id=o.brand_store_id
 AND btrim(COALESCE(s.amap_poi_id,''))='' AND s.deleted_at IS NULL;
UPDATE brand_dashboard_snapshots AS d SET invalidated_at=NOW()
WHERE EXISTS (SELECT 1 FROM brand_store_record_overrides AS o WHERE o.tenant_id=d.tenant_id);
UPDATE brand_region_cache AS c SET store_count=(
 SELECT count(*) FROM brand_stores AS s
 WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province
  AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL)
WHERE EXISTS (
 SELECT 1 FROM brand_store_record_overrides AS o JOIN brand_stores AS s
  ON s.id=o.brand_store_id AND s.tenant_id=o.tenant_id
 WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province
  AND s.city=c.city AND btrim(COALESCE(s.amap_poi_id,''))='');
`;
