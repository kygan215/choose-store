-- Amap sometimes returns an address suggestion with no POI ID alongside the
-- actual POI. Archive exact unique matches. A manually accepted ID-less row is
-- archived only when its identified POI is already accepted; its record-level
-- decision is never promoted to a POI-wide override.
CREATE INDEX IF NOT EXISTS idx_brand_stores_missing_poi_exact
  ON brand_stores(tenant_id,brand_name,city,longitude,latitude)
  WHERE deleted_at IS NULL AND btrim(COALESCE(amap_poi_id,''))='';
CREATE INDEX IF NOT EXISTS idx_brand_stores_identified_poi_exact
  ON brand_stores(tenant_id,brand_name,longitude,latitude,amap_name)
  WHERE deleted_at IS NULL AND btrim(COALESCE(amap_poi_id,''))<>'';

WITH matches AS MATERIALIZED (
  SELECT n.tenant_id, n.id AS duplicate_id, MIN(p.id) AS canonical_id,
    MIN(p.name_decision) AS canonical_decision
  FROM brand_stores n
  JOIN brand_stores p ON p.tenant_id=n.tenant_id
    AND p.brand_name=n.brand_name
    AND p.deleted_at IS NULL
    AND btrim(COALESCE(p.amap_poi_id,''))<>''
    AND p.longitude=n.longitude AND p.latitude=n.latitude
    AND p.amap_name=n.address
  WHERE n.deleted_at IS NULL
    AND btrim(COALESCE(n.amap_poi_id,''))=''
    AND n.address<>''
    AND right(n.amap_name,char_length(n.address))=n.address
  GROUP BY n.tenant_id,n.id
  HAVING COUNT(*)=1
), eligible AS (
  SELECT m.* FROM matches m
  JOIN brand_stores n ON n.tenant_id=m.tenant_id AND n.id=m.duplicate_id
  WHERE btrim(COALESCE(n.ailingshi_override,''))=''
    OR (n.ailingshi_override='accept' AND m.canonical_decision='接受')
), snapshots AS (
  INSERT INTO brand_store_removals(tenant_id,brand_store_id,snapshot_json,reason,deleted_by)
  SELECT n.tenant_id,n.id,to_jsonb(n),
    '自动归并：与有高德 POI ID 的门店记录 #'||m.canonical_id||' 同品牌同名同坐标',NULL
  FROM eligible m JOIN brand_stores n ON n.tenant_id=m.tenant_id AND n.id=m.duplicate_id
  ON CONFLICT (tenant_id,brand_store_id) WHERE restored_at IS NULL DO NOTHING
  RETURNING tenant_id,brand_store_id
), archived AS (
  UPDATE brand_stores n
  SET deleted_at=NOW(),deleted_by=NULL,
      delete_reason='自动归并：与有高德 POI ID 的门店记录 #'||m.canonical_id||' 同品牌同名同坐标',
      updated_at=NOW()
  FROM snapshots s JOIN eligible m ON m.tenant_id=s.tenant_id AND m.duplicate_id=s.brand_store_id
  WHERE n.tenant_id=s.tenant_id AND n.id=s.brand_store_id AND n.deleted_at IS NULL
  RETURNING n.tenant_id,n.id,n.brand_name,n.province,n.city,m.canonical_id
), cache_refresh AS (
  UPDATE brand_region_cache c SET store_count=(
    SELECT COUNT(*) FROM brand_stores s
    WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name
      AND s.province=c.province AND s.city=c.city
      AND s.library_visible AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM archived a WHERE a.tenant_id=s.tenant_id AND a.id=s.id)
  )
  WHERE EXISTS (SELECT 1 FROM archived a WHERE a.tenant_id=c.tenant_id
    AND a.brand_name=c.brand_name AND a.province=c.province AND a.city=c.city)
  RETURNING c.tenant_id
), invalidated AS (
  INSERT INTO brand_dashboard_snapshots(tenant_id,invalidated_at)
  SELECT DISTINCT tenant_id,NOW() FROM archived
  ON CONFLICT (tenant_id) DO UPDATE SET invalidated_at=NOW()
  RETURNING tenant_id
), audited AS (
  INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,details)
  SELECT tenant_id,NULL,'archive_duplicate_missing_poi_brand_store','brand_store',id::text,
    jsonb_build_object('duplicate_id',id,'canonical_id',canonical_id)
  FROM archived
  RETURNING id
)
SELECT COUNT(*)::int AS archived FROM archived;
