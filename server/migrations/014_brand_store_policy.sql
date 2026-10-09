CREATE OR REPLACE FUNCTION brand_policy_reason(brand text, name text, poi_id text, manual text, poi_type text, codes text, raw jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 WITH evidence AS (SELECT ailingshi_normalize(name) AS n,
 COALESCE(poi_type,'') || ';' || COALESCE(raw->>'tag','') || ';' || COALESCE(raw#>>'{business,tag}','') || ';' || COALESCE(raw#>>'{business,rectag}','') || ';' || COALESCE(raw#>>'{business,keytag}','') AS tags,
 regexp_replace(COALESCE(codes,''),'[[:space:]]','','g') AS c), flags AS (
 SELECT *, (tags ~ '零食|超市|购物' OR c ~ '(^|[|;,])06[0-9]{4}([|;,]|$)') AS retail FROM evidence)
 SELECT CASE
 WHEN btrim(COALESCE(poi_id,''))<>'' AND manual='exclude' THEN '按 POI ID 人工排除'
 WHEN split_part(n,'(',1) ~ '蛋糕|糕饼|西饼|酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|甜品|烘焙|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站' THEN '名称主体明确为蛋糕、餐馆、仓库等非目标业态'
 WHEN brand='爱零食' AND manual<>'accept' AND n ~ '^(爱零食的喵|我爱零食|最爱零食|爱零食小屋)' THEN '相似名称，不按目标品牌收录'
 WHEN tags ~ '蛋糕|糕饼|西饼|烘焙|甜品' AND NOT retail THEN '分类或标签明确为蛋糕／烘焙等非目标业态'
 WHEN btrim(COALESCE(poi_id,''))='' THEN '缺少 POI ID，待核验'
 WHEN manual<>'accept' AND NOT (CASE brand WHEN '吖嘀吖嘀' THEN n ~ '^(吖嘀吖嘀)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '好想来' THEN n ~ '^(好想来|好想来品牌零食|好想来零食乐园)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '戴永红' THEN n ~ '^(戴永红)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '来伊份' THEN n ~ '^(来伊份)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '来优品' THEN n ~ '^(来优品|来优品品牌零食|来优品零食乐园)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '爱零食' THEN n ~ '^(爱零食)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '糖巢' THEN n ~ '^(糖巢)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '老婆大人' THEN n ~ '^(老婆大人)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '赵一鸣零食' THEN n ~ '^(赵一鸣零食|赵一鸣省钱超市)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '陆小馋' THEN n ~ '^(陆小馋)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '零食很忙' THEN n ~ '^(零食很忙)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '零食悦' THEN n ~ '^(零食悦)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$'
WHEN '零食有鸣' THEN n ~ '^(零食有鸣)(零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店)?(\((?!\s*店\))[^()]+店\))?$' ELSE FALSE END) THEN '名称未匹配品牌完整结构，待核验'
 WHEN tags ~ '蛋糕|糕饼|西饼|烘焙|甜品|餐饮|住宿|医疗|公司企业|交通设施|科教文化|商务住宅' OR c ~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$)|070000([|;,]|$))[0-9]{6}([|;,]|$)' THEN '购物与其他业态证据冲突，待核验'
 WHEN NOT retail THEN '缺少零食／超市／购物分类或标签证据，待核验'
 WHEN manual='accept' THEN '按 POI ID 人工确认名称，零食／超市／购物证据通过初筛' ELSE '品牌名称与零食／超市／购物证据通过初筛，未验证品牌归属' END FROM flags
$$;
CREATE OR REPLACE FUNCTION brand_policy_decision(brand text, name text, poi_id text, manual text, poi_type text, codes text, raw jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE brand_policy_reason(brand,name,poi_id,manual,poi_type,codes,raw)
 WHEN '品牌名称与零食／超市／购物证据通过初筛，未验证品牌归属' THEN '接受' WHEN '按 POI ID 人工确认名称，零食／超市／购物证据通过初筛' THEN '接受'
 WHEN '按 POI ID 人工排除' THEN '排除' WHEN '名称主体明确为蛋糕、餐馆、仓库等非目标业态' THEN '排除' WHEN '相似名称，不按目标品牌收录' THEN '排除' WHEN '分类或标签明确为蛋糕／烘焙等非目标业态' THEN '排除'
 ELSE '待核实' END
$$;

ALTER TABLE brand_stores ALTER COLUMN name_decision SET EXPRESSION AS
 (CASE WHEN brand_name IN ('吖嘀吖嘀','好想来','戴永红','来伊份','来优品','爱零食','糖巢','老婆大人','赵一鸣零食','陆小馋','零食很忙','零食悦','零食有鸣') THEN brand_policy_decision(brand_name,amap_name,amap_poi_id,ailingshi_override,poi_type,typecode,raw_json) ELSE '' END);
ALTER TABLE brand_stores ALTER COLUMN name_decision_reason SET EXPRESSION AS
 (CASE WHEN brand_name IN ('吖嘀吖嘀','好想来','戴永红','来伊份','来优品','爱零食','糖巢','老婆大人','赵一鸣零食','陆小馋','零食很忙','零食悦','零食有鸣') THEN brand_policy_reason(brand_name,amap_name,amap_poi_id,ailingshi_override,poi_type,typecode,raw_json) ELSE '' END);
ALTER TABLE brand_stores ALTER COLUMN library_visible SET EXPRESSION AS
 (CASE WHEN brand_name IN ('吖嘀吖嘀','好想来','戴永红','来伊份','来优品','爱零食','糖巢','老婆大人','赵一鸣零食','陆小馋','零食很忙','零食悦','零食有鸣') THEN brand_policy_decision(brand_name,amap_name,amap_poi_id,ailingshi_override,poi_type,typecode,raw_json)='接受' ELSE (brand_name NOT IN ('良品铺子','零食优选','零食好能嗨','零食很能嗨','零食优选、零食悦、零食很能嗨','零食优选、零食悦、零食好能嗨')
    AND NOT (brand_name ~ '[、，,]' AND brand_name ~ '零食优选|零食好能嗨|零食很能嗨')
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> ''
    AND split_part(split_part(regexp_replace(amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|垂钓园|餐饮店|甜品店|奶茶店|烘焙坊|冰粉|冰沙|凉糕|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆'
    AND NOT ((split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) ~ '蛋糕|糕饼|西饼' AND (split_part(split_part(regexp_replace(COALESCE(amap_name,''), '[[:space:]]', '', 'g'), '(', 1), '（', 1) || ';' || COALESCE(poi_type,'') || ';' || COALESCE(raw_json->>'tag','') || ';' || COALESCE(raw_json#>>'{business,tag}','') || ';' || COALESCE(raw_json#>>'{business,rectag}','') || ';' || COALESCE(raw_json#>>'{business,keytag}','')) !~ '零食|超市|日杂店')) END);
ALTER TABLE brand_stores ALTER COLUMN needs_review SET EXPRESSION AS
 (CASE WHEN brand_name IN ('吖嘀吖嘀','好想来','戴永红','来伊份','来优品','爱零食','糖巢','老婆大人','赵一鸣零食','陆小馋','零食很忙','零食悦','零食有鸣') THEN brand_policy_decision(brand_name,amap_name,amap_poi_id,ailingshi_override,poi_type,typecode,raw_json)='待核实' ELSE FALSE END);
CREATE INDEX IF NOT EXISTS idx_brand_policy_review ON brand_stores(tenant_id,name_decision,id) WHERE deleted_at IS NULL;
UPDATE brand_dashboard_snapshots SET invalidated_at=NOW();
UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL);
ANALYZE brand_stores;
