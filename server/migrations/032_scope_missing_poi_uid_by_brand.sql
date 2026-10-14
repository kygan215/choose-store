-- A POI-less suggestion has no external identity shared across brands. Give
-- existing rows (including soft-deleted tombstones) the same brand-scoped key
-- that new discovery writes. Record-level manual decisions keep their row ID.
UPDATE brand_stores
SET source_uid=source_uid||'|'||brand_name
WHERE btrim(COALESCE(amap_poi_id,''))=''
  AND source_uid ~ '^brand-missing:[0-9a-f]{64}$';
