
CREATE OR REPLACE FUNCTION ailingshi_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT translate(btrim(normalize(COALESCE(input,''), NFKC), E' \t\n\r'), '。、•∙・', '.,···')
$$;
CREATE OR REPLACE FUNCTION ailingshi_reason(name text, poi_id text, manual text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
 WHEN btrim(COALESCE(poi_id,''))<>'' AND manual='exclude' THEN '按 POI ID 人工加入黑名单'
 WHEN btrim(COALESCE(poi_id,''))<>'' AND manual='accept' THEN '按 POI ID 人工加入白名单'
 WHEN ailingshi_normalize(name) ~ '^(爱零食的喵|我爱零食|最爱零食|爱零食小屋)' THEN '相似品牌或普通店名，不按爱零食品牌收录'
 WHEN ailingshi_normalize(name) ~ '硬折扣超市|超市|便利店|蛋糕|糕饼|西饼' THEN '统计范围排除：超市、便利店或蛋糕等其他业态，不代表否认品牌归属'
 WHEN btrim(COALESCE(poi_id,''))='' THEN '缺少 POI ID，需补充后人工核实'
 WHEN ailingshi_normalize(name) ~ '^(爱零食|爱零食(量贩零食|量贩零食店)?\((?!\s*店\))[^()]+店\))$' THEN '完整名称符合已确认结构，仅通过名称初筛，未验证品牌归属'
 ELSE '名称不符合已确认结构，需人工核实' END
$$;
CREATE OR REPLACE FUNCTION ailingshi_decision(name text, poi_id text, manual text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE ailingshi_reason(name,poi_id,manual)
 WHEN '按 POI ID 人工加入白名单' THEN '接受'
 WHEN '完整名称符合已确认结构，仅通过名称初筛，未验证品牌归属' THEN '接受'
 WHEN '按 POI ID 人工加入黑名单' THEN '排除'
 WHEN '相似品牌或普通店名，不按爱零食品牌收录' THEN '排除'
 WHEN '统计范围排除：超市、便利店或蛋糕等其他业态，不代表否认品牌归属' THEN '排除'
 ELSE '待核实' END
$$;
CREATE TABLE IF NOT EXISTS ailingshi_poi_overrides (
 tenant_id bigint NOT NULL REFERENCES tenants(id), poi_id text NOT NULL CHECK (btrim(poi_id)<>''),
 decision text NOT NULL CHECK (decision IN ('accept','exclude')), reason text NOT NULL,
 reviewed_by bigint REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,poi_id)
);
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS ailingshi_override text NOT NULL DEFAULT '';
ALTER TABLE brand_stores ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE brand_stores ALTER COLUMN latitude DROP NOT NULL;
CREATE OR REPLACE FUNCTION apply_ailingshi_override() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.ailingshi_override := COALESCE((SELECT decision FROM ailingshi_poi_overrides WHERE tenant_id=NEW.tenant_id AND poi_id=NEW.amap_poi_id),'');
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER apply_ailingshi_override BEFORE INSERT OR UPDATE ON brand_stores
 FOR EACH ROW EXECUTE FUNCTION apply_ailingshi_override();
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS normalized_name text GENERATED ALWAYS AS (ailingshi_normalize(amap_name)) STORED;
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS name_decision text GENERATED ALWAYS AS
 (CASE WHEN brand_name='爱零食' THEN ailingshi_decision(amap_name,amap_poi_id,ailingshi_override) ELSE '' END) STORED;
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS name_decision_reason text GENERATED ALWAYS AS
 (CASE WHEN brand_name='爱零食' THEN ailingshi_reason(amap_name,amap_poi_id,ailingshi_override) ELSE '' END) STORED;
ALTER TABLE brand_stores ALTER COLUMN library_visible SET EXPRESSION AS
 (CASE WHEN brand_name='爱零食' THEN ailingshi_decision(amap_name,amap_poi_id,ailingshi_override)='接受' ELSE (brand_name NOT IN ('良品铺子','零食优选','零食好能嗨','零食很能嗨','零食优选、零食悦、零食很能嗨','零食优选、零食悦、零食好能嗨')
    AND NOT (brand_name ~ '[、，,]' AND brand_name ~ '零食优选|零食好能嗨|零食很能嗨')
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> ''
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|垂钓园|餐饮店|甜品店|奶茶店|烘焙坊|冰粉|冰沙|凉糕|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆'
    AND NOT ((split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) ~ '蛋糕|糕饼|西饼' AND (split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) !~ '零食|超市|日杂店')) END);
CREATE INDEX IF NOT EXISTS idx_ailingshi_review ON brand_stores(tenant_id,name_decision,id) WHERE brand_name='爱零食' AND deleted_at IS NULL;
UPDATE brand_dashboard_snapshots SET invalidated_at=NOW();
UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL) WHERE c.brand_name='爱零食';
ANALYZE brand_stores;
