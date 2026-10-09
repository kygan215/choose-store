import { BRAND_IDENTITIES, brandNamePattern, CAKE_TAG, CONFLICT_TAG, GENERIC_CATERING_TYPE, NON_TARGET_CATEGORY_TAG, POLICY_REASONS as R, RETAIL_TAG, SHOPPING_TYPE_FOR_CONFLICT, SIMILAR_NAME, UNRELATED_NAME } from "../shared/brand-store-policy.js";
import { snackRetailSql } from "./snack-retail.js";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const known = `brand_name IN (${Object.keys(BRAND_IDENTITIES).map(q).join(",")})`;
const genericCatering = `(pt LIKE '%' || ${q(GENERIC_CATERING_TYPE)} || '%' AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE item<>${q(GENERIC_CATERING_TYPE)} AND item !~ ${q(`^${SHOPPING_TYPE_FOR_CONFLICT}$`)}))`;
const cakeWithRetailProof = `(tags ~ ${q(CAKE_TAG)} AND split_part(n,'(',1) ~ '零食|超市|便利店' AND business_tags !~ ${q(CAKE_TAG)} AND tags !~ ${q(NON_TARGET_CATEGORY_TAG)} AND pt LIKE '%糕饼店%' AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE item NOT LIKE '%糕饼店%' AND item !~ ${q(`^${SHOPPING_TYPE_FOR_CONFLICT}$`)}))`;
const resolvedConflict = `(n<>brand AND business_snack AND ((${genericCatering} AND tags !~ ${q(NON_TARGET_CATEGORY_TAG)} AND tags !~ ${q(CAKE_TAG)}) OR ${cakeWithRetailProof}))`;
export const brandPolicyFunctionsSql = `
CREATE OR REPLACE FUNCTION brand_policy_reason(brand text, name text, poi_id text, manual text, poi_type text, codes text, raw jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 WITH evidence AS (SELECT ailingshi_normalize(name) AS n,
 COALESCE(poi_type,'') || ';' || COALESCE(raw->>'tag','') || ';' || COALESCE(raw#>>'{business,tag}','') || ';' || COALESCE(raw#>>'{business,rectag}','') || ';' || COALESCE(raw#>>'{business,keytag}','') AS tags,
 COALESCE(raw->>'tag','') || ';' || COALESCE(raw#>>'{business,tag}','') || ';' || COALESCE(raw#>>'{business,rectag}','') || ';' || COALESCE(raw#>>'{business,keytag}','') AS business_tags,
 COALESCE(poi_type,'') AS pt,
 regexp_replace(COALESCE(codes,''),'[[:space:]]','','g') AS c), flags AS (
 SELECT *, (tags ~ ${q(RETAIL_TAG)} OR c ~ '(^|[|;,])06[0-9]{4}([|;,]|$)') AS retail,
 tags ~ '零食' AS snack_evidence,
 business_tags ~ '(^|[;,])零食([;,]|$)' AS business_snack FROM evidence)
 SELECT CASE
 WHEN btrim(COALESCE(poi_id,''))<>'' AND manual='exclude' THEN ${q(R.blacklist)}
 WHEN split_part(n,'(',1) ~ ${q(UNRELATED_NAME)} THEN ${q(R.unrelated)}
 WHEN brand='爱零食' AND manual<>'accept' AND n ~ ${q(SIMILAR_NAME)} THEN ${q(R.similar)}
 WHEN tags ~ ${q(CAKE_TAG)} AND NOT snack_evidence THEN ${q(R.cake)}
 WHEN tags ~ ${q(NON_TARGET_CATEGORY_TAG)} AND NOT snack_evidence THEN ${q(R.category)}
 WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)}
 WHEN manual<>'accept' AND NOT (CASE brand ${Object.keys(BRAND_IDENTITIES).map(b => `WHEN ${q(b)} THEN n ~ ${q(brandNamePattern(b))}`).join("\n")} ELSE FALSE END) THEN ${q(R.name)}
 WHEN (tags ~ ${q(`${CAKE_TAG}|${NON_TARGET_CATEGORY_TAG}|${CONFLICT_TAG}`)} OR c ~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$)|070000([|;,]|$))[0-9]{6}([|;,]|$)') AND NOT ${resolvedConflict} THEN ${q(R.conflict)}
 WHEN NOT retail THEN ${q(R.tags)}
 WHEN manual='accept' THEN ${q(R.manual)} ELSE ${q(R.accepted)} END FROM flags
$$;
CREATE OR REPLACE FUNCTION brand_policy_decision(brand text, name text, poi_id text, manual text, poi_type text, codes text, raw jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE brand_policy_reason(brand,name,poi_id,manual,poi_type,codes,raw)
 WHEN ${q(R.accepted)} THEN '接受' WHEN ${q(R.manual)} THEN '接受'
 ${[R.blacklist,R.unrelated,R.similar,R.cake,R.category].map(r=>`WHEN ${q(r)} THEN '排除'`).join(" ")}
 ELSE '待核实' END
$$;
`;
const args = "brand_name,amap_name,amap_poi_id,ailingshi_override,poi_type,typecode,raw_json";
export const brandPolicyMigrationSql = `${brandPolicyFunctionsSql}
ALTER TABLE brand_stores ALTER COLUMN name_decision SET EXPRESSION AS
 (CASE WHEN ${known} THEN brand_policy_decision(${args}) ELSE '' END);
ALTER TABLE brand_stores ALTER COLUMN name_decision_reason SET EXPRESSION AS
 (CASE WHEN ${known} THEN brand_policy_reason(${args}) ELSE '' END);
ALTER TABLE brand_stores ALTER COLUMN library_visible SET EXPRESSION AS
 (CASE WHEN ${known} THEN brand_policy_decision(${args})='接受' ELSE ${snackRetailSql()} END);
ALTER TABLE brand_stores ALTER COLUMN needs_review SET EXPRESSION AS
 (CASE WHEN ${known} THEN brand_policy_decision(${args})='待核实' ELSE FALSE END);
CREATE INDEX IF NOT EXISTS idx_brand_policy_review ON brand_stores(tenant_id,name_decision,id) WHERE deleted_at IS NULL;
UPDATE brand_dashboard_snapshots SET invalidated_at=NOW();
UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL);
ANALYZE brand_stores;
`;
