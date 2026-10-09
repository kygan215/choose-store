-- Cache the existing conservative retention predicate at write time.
-- No records are removed. If retention rules change, update this expression too.
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS library_visible BOOLEAN
  GENERATED ALWAYS AS ((brand_name NOT IN ('良品铺子','零食优选','零食好能嗨','零食很能嗨','零食优选、零食悦、零食很能嗨','零食优选、零食悦、零食好能嗨')
    AND NOT (brand_name ~ '[、，,]' AND brand_name ~ '零食优选|零食好能嗨|零食很能嗨')
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> ''
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|垂钓园|餐饮店|甜品店|奶茶店|烘焙坊|冰粉|冰沙|凉糕|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆')) STORED;
CREATE INDEX IF NOT EXISTS idx_brand_stores_browse
  ON brand_stores(tenant_id,city,district,brand_name,amap_name,id)
  WHERE library_visible;
CREATE INDEX IF NOT EXISTS idx_brand_stores_visible_filters
  ON brand_stores(tenant_id,brand_name,province,city,district)
  WHERE library_visible;
CREATE INDEX IF NOT EXISTS idx_stores_brand_analyzed
  ON stores(tenant_id,brand_store_id) WHERE analysis_json IS NOT NULL;
ANALYZE brand_stores;
