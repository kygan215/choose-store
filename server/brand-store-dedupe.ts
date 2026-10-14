import { query } from "./db.js";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

// Empty-ID Amap results can be address suggestions for a real POI. Only merge
// when one active POI has the same tenant, brand, exact coordinates and name.
// A reviewed acceptance stays record-scoped: archive it only if the identified
// POI is already accepted. Never copy a record decision into a POI-wide list.
export const archiveExactMissingPoiDuplicatesSql = `
WITH matches AS MATERIALIZED (
  SELECT n.tenant_id, n.id AS duplicate_id, MIN(p.id) AS canonical_id,
    MIN(p.amap_poi_id) AS canonical_poi_id,
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
    AND ($1::bigint IS NULL OR n.tenant_id=$1)
    AND ($2::text IS NULL OR n.brand_name=$2)
    AND ($3::text IS NULL OR n.city=$3)
  GROUP BY n.tenant_id,n.id
  HAVING COUNT(*)=1
), eligible AS (
  SELECT m.* FROM matches m
  JOIN brand_stores n ON n.tenant_id=m.tenant_id AND n.id=m.duplicate_id
  WHERE (btrim(COALESCE(n.ailingshi_override,''))=''
    OR (n.ailingshi_override='accept' AND m.canonical_decision='接受'))
    AND ($4::text[] IS NULL OR m.canonical_poi_id=ANY($4::text[]))
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
SELECT COUNT(*)::int AS archived FROM archived`;

export async function archiveExactMissingPoiDuplicates(tenantId: number, brand: string | null, city: string | null, runQuery: Query = query, poiIds: string[] | null = null) {
  const result = await runQuery(archiveExactMissingPoiDuplicatesSql, [tenantId, brand, city, poiIds]);
  return Number(result.rows[0]?.archived || 0);
}

export const findExactMissingPoiDuplicateSql = `
SELECT n.id AS store_id, MIN(p.id) AS canonical_id, MIN(p.amap_poi_id) AS poi_id, COUNT(*)::int AS match_count
FROM brand_stores n
JOIN brand_stores p ON p.tenant_id=n.tenant_id
  AND p.brand_name=n.brand_name
  AND p.deleted_at IS NULL
  AND btrim(COALESCE(p.amap_poi_id,''))<>''
  AND p.longitude=n.longitude AND p.latitude=n.latitude
  AND p.amap_name=n.address
WHERE n.tenant_id=$1 AND n.id=ANY($2::bigint[]) AND n.deleted_at IS NULL
  AND btrim(COALESCE(n.amap_poi_id,''))=''
  AND n.address<>''
  AND right(n.amap_name,char_length(n.address))=n.address
GROUP BY n.id ORDER BY n.id`;

export type ExactMissingPoiDuplicateMatch = {storeId: number; canonicalId: number; poiId: string; matchCount: number};

export async function findExactMissingPoiDuplicates(tenantId: number, storeIds: number[], runQuery: Query = query): Promise<ExactMissingPoiDuplicateMatch[]> {
  if (!storeIds.length) return [];
  const result = await runQuery(findExactMissingPoiDuplicateSql, [tenantId, storeIds]);
  return result.rows.map(row => ({
    storeId: Number(row.store_id),
    canonicalId: Number(row.canonical_id),
    poiId: String(row.poi_id),
    matchCount: Number(row.match_count),
  }));
}

// This is also used at manual-review time, so a still-active suggestion cannot
// be accepted separately from its identified POI before archival catches up.
export async function findExactMissingPoiDuplicate(tenantId: number, storeId: number, runQuery: Query = query): Promise<{canonicalId: number; poiId: string; matchCount: number} | null> {
  const [match] = await findExactMissingPoiDuplicates(tenantId, [storeId], runQuery);
  return match ? {canonicalId: match.canonicalId, poiId: match.poiId, matchCount: match.matchCount} : null;
}
