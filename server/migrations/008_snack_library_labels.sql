-- Earlier discovery caches were populated without requiring upstream snack tags.
-- They must not suppress searches under the new eligibility rule.
ALTER TABLE brand_region_cache ADD COLUMN IF NOT EXISTS filter_version INTEGER NOT NULL DEFAULT 0;

UPDATE brand_catalog SET active=FALSE,updated_at=NOW()
WHERE active=TRUE AND (standard_name IN ('好想来零食','好像来零食','好像来','零食优选','零食好能嗨','零食很能嗨')
  OR (standard_name ~ '[、，,]' AND standard_name ~ '零食优选|零食好能嗨|零食很能嗨'));
UPDATE brand_stores SET brand_name='好想来',updated_at=NOW()
WHERE brand_name IN ('好想来零食','好像来零食','好像来');
UPDATE brand_stores SET brand_name='零食悦',updated_at=NOW()
WHERE brand_name ~ '[、，,]' AND amap_name LIKE '%零食悦%';
