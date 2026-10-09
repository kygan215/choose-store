-- Exclude explicit cake shops without conflicting snack/supermarket evidence.
-- Existing source rows are retained; only library visibility changes.
-- Keep 009 as historical SQL; this migration updates its stored expression.
ALTER TABLE brand_stores ALTER COLUMN library_visible SET EXPRESSION AS ((brand_name NOT IN ('良品铺子','零食优选','零食好能嗨','零食很能嗨','零食优选、零食悦、零食很能嗨','零食优选、零食悦、零食好能嗨')
    AND NOT (brand_name ~ '[、，,]' AND brand_name ~ '零食优选|零食好能嗨|零食很能嗨')
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> ''
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|垂钓园|餐饮店|甜品店|奶茶店|烘焙坊|冰粉|冰沙|凉糕|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆'
    AND NOT ((split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) ~ '蛋糕|糕饼|西饼' AND (split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) !~ '零食|超市|日杂店')));
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS needs_review BOOLEAN
  GENERATED ALWAYS AS ((NOT (split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> '' AND split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|垂钓园|餐饮店|甜品店|奶茶店|烘焙坊|冰粉|冰沙|凉糕|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆'
    AND (split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) !~ '蛋糕|糕饼|西饼'
    AND regexp_replace(COALESCE(typecode,''), '[[:space:]]', '', 'g') !~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$)|070000([|;,]|$))[0-9]{6}([|;,]|$)'
    AND replace(COALESCE(poi_type,''),'生活服务;生活服务场所;生活服务场所','') !~ '餐饮|住宿|医疗|公司企业|交通设施|生活服务|科教文化|商务住宅'
    AND ((COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) ~ '零食'
      OR (split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) ~ '^(零食很忙|零食有鸣|赵一鸣零食|赵一鸣|好想来零食乐园|好想来品牌零食|好想来零食|好像来零食|好想来|好像来|爱零食|来优品|戴永红|糖巢|老婆大人|陆小馋|吖嘀吖嘀|来伊份|零食悦)' AND (COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) ~ '日杂店|综合超市'))))) STORED;
CREATE INDEX IF NOT EXISTS idx_brand_stores_review_browse
  ON brand_stores(tenant_id,needs_review,city,district,brand_name,amap_name,id)
  WHERE library_visible AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_brand_stores_review_filters
  ON brand_stores(tenant_id,needs_review,brand_name,province,city,district)
  WHERE library_visible AND deleted_at IS NULL;
UPDATE brand_dashboard_snapshots SET invalidated_at=NOW();
UPDATE brand_region_cache c SET store_count=(SELECT COUNT(*) FROM brand_stores b
  WHERE b.tenant_id=c.tenant_id AND b.brand_name=c.brand_name AND b.province=c.province AND b.city=c.city
  AND b.library_visible AND b.deleted_at IS NULL);
ANALYZE brand_stores;
