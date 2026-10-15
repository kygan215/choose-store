import { BRAND_IDENTITIES, CLEAR_RETAIL_LABEL, NON_STORE_TAIL, brandSnackNamePattern, OTHER_SHOP_TAG, NON_STORE_BRANCH, brandGeoPrefixPattern, NAME_REPAIRS, EXPLICIT_UNRELATED, REVIEW_CONVENIENCE, brandBareBranchPattern, brandLocationPrimaryPattern, brandNamePattern, CAKE_TAG, CONFLICT_TAG, GENERIC_CATERING_TYPE, HARD_NON_RETAIL_TAG, INACTIVE_STATUS, LOCATION_BRANCH_BLOCK, NON_TARGET_CATEGORY_TAG, POLICY_REASONS as R, RETAIL_TAG, SHOPPING_TYPE_FOR_CONFLICT, SIMILAR_NAME, SOFT_UNRELATED_NAME, UNRELATED_NAME, WAREHOUSE_BRANCH } from "../shared/brand-store-policy.js";
import { snackRetailSql } from "./snack-retail.js";
import { AMBIGUOUS_STORE_NAME, EXTREME_STORE_TAG, RELATED_STORE_TAG, brandRelatedNamePattern } from "../shared/brand-store-policy.js";
import { EXCLUDED_STORE_LABEL, HXL_NON_BRAND_NAME } from "../shared/brand-store-policy.js";
import { HXL_REVIEW_NAME, HXL_PRIMARY_PATTERN } from "../shared/brand-store-policy.js";
import {brandIdentityEvidenceNames} from "../shared/brand-store-policy.js";
import {CLEAR_UNRELATED_BUSINESS} from "../shared/brand-store-policy.js";
import {CONFIRMED_NON_CHAIN_NAME} from "../shared/brand-store-policy.js";
import {CONFIRMED_ADDITIONAL_BRANDS} from "../shared/brand-store-policy.js";
import {brandStandardBranchPattern,NAME_FIRST_BRANCH_REVIEW_TAG,HOTMAXX_OFFICIAL_NAME_PATTERN,HOTMAXX_REVERSE_NAME_PATTERN,HOTMAXX_SUPERMARKET_NAME_PATTERN,HOTMAXX_DAILY_BRANCH_PATTERN,HOTMAXX_CONFLICT_TAG,HOTMAXX_NON_STORE_BRANCH,HOTMAXX_MALL_LANDMARK_HINT,HOTMAXX_MALL_BRANCH_CONFLICT,ZERO_YOUXUAN_LOCATION_PREFIX,ZERO_YOUXUAN_NON_LOCATION_PREFIX,ZERO_YOUXUAN_SAVING_CONVENIENCE_NAME,ZERO_YOUXUAN_NON_STORE_NAME,ZERO_YOUXUAN_ZHAOSHANG_LANDMARK_NAME,ADDONE_UNRELATED_NAME} from "../shared/brand-store-policy.js";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const repairedNameSql = NAME_REPAIRS.reduce((sql, [pattern, replacement]) =>
 `regexp_replace(${sql},${q(pattern)},${q(replacement.replace(/\$(\d)/g, "\\$1"))})`, "ailingshi_normalize(name)");
const normalizedNameSql = `(CASE brand ${Object.keys(BRAND_IDENTITIES).map(brand =>
 `WHEN ${q(brand)} THEN regexp_replace(${repairedNameSql},${q(brandGeoPrefixPattern(brand))},${q("\\1")})`).join(" ")} ELSE ${repairedNameSql} END)`;
const known = `brand_name IN (${Object.keys(BRAND_IDENTITIES).map(q).join(",")})`;
const primaryForExclusionsSql = `(CASE brand ${CONFIRMED_ADDITIONAL_BRANDS.map(brand=>`WHEN ${q(brand)} THEN regexp_replace(split_part(n,'(',1),${q('^'+brand)},'')`).join(' ')} ELSE split_part(n,'(',1) END)`;
const leadingPlaceBracketSql = `n ~ ${q('^\\([^()]*\\)')}`;
const identityPrimarySql = `(CASE WHEN ${leadingPlaceBracketSql} THEN split_part(regexp_replace(n,${q('^\\([^()]*\\)')},''),'(',1) ELSE split_part(n,'(',1) END)`;
const missingIdentitySql = `((btrim(split_part(n,'(',1))<>'' OR ${leadingPlaceBracketSql}) AND (CASE brand ${Object.keys(BRAND_IDENTITIES).map(brand=>`WHEN ${q(brand)} THEN (${brandIdentityEvidenceNames(brand).map(name=>`position(${q(name)} in ${identityPrimarySql})=0`).join(' AND ')})`).join(' ')} ELSE FALSE END))`;
const genericCatering = `(pt LIKE '%' || ${q(GENERIC_CATERING_TYPE)} || '%' AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE item<>${q(GENERIC_CATERING_TYPE)} AND item !~ ${q(`^${SHOPPING_TYPE_FOR_CONFLICT}$`)}))`;
const cakeWithRetailProof = `(tags ~ ${q(CAKE_TAG)} AND business_tags !~ ${q(CAKE_TAG)} AND tags !~ ${q(NON_TARGET_CATEGORY_TAG)} AND pt LIKE '%糕饼店%' AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE item NOT LIKE '%糕饼店%' AND item !~ ${q(`^${SHOPPING_TYPE_FOR_CONFLICT}$`)}))`;
const resolvedConflict = `(business_snack AND ((${genericCatering} AND tags !~ ${q(NON_TARGET_CATEGORY_TAG)} AND tags !~ ${q(CAKE_TAG)}) OR ${cakeWithRetailProof}))`;
const shoppingCategory = `(pt<>'' AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE item !~ ${q(`^${SHOPPING_TYPE_FOR_CONFLICT}$`)}))`;
const strictNameSql = `(CASE brand ${Object.keys(BRAND_IDENTITIES).map(brand=>`WHEN ${q(brand)} THEN n ~ ${q(brandNamePattern(brand))}`).join(" ")} ELSE FALSE END)`;
const chainNameSql = `(${strictNameSql} AND n ~ ${q("(\\([^()]+店\\)|[-－][^()]+店|店)$")} AND split_part(n,'(',1) !~ ${q(SOFT_UNRELATED_NAME)} AND business_tags !~ ${q(CAKE_TAG)} AND (tags !~ ${q(NON_TARGET_CATEGORY_TAG)} OR (pt LIKE '%中餐厅%' AND business_snack)) AND (business_snack OR retail OR split_part(n,'(',1) ~ '品牌零食|零食乐园|量贩零食|省钱超市|批发超市|零食店|零食超市|硬折扣超市' OR (pt='生活服务;生活服务场所;生活服务场所' AND c ~ '(^|[|;,])070000([|;,]|$)')))`;
const snackNameSql = `(clear_retail AND business_tags !~ ${q(CAKE_TAG)} AND split_part(n,'(',1) !~ ${q(`${SOFT_UNRELATED_NAME}|${LOCATION_BRANCH_BLOCK}`)} AND substring(n FROM length(split_part(n,'(',1))+1) !~ ${q(LOCATION_BRANCH_BLOCK)} AND (CASE brand ${Object.keys(BRAND_IDENTITIES).map(brand=>`WHEN ${q(brand)} THEN n ~ ${q(brandSnackNamePattern(brand))}`).join(" ")} ELSE FALSE END))`;
const otherShopLandmarkSql = `(tags ~ ${q(OTHER_SHOP_TAG)} AND (CASE brand ${Object.entries(BRAND_IDENTITIES).map(([brand, names]) => `WHEN ${q(brand)} THEN (${names.map(name=>`position(${q(name)} in split_part(n,'(',1))=0`).join(' AND ')} AND (${names.map(name=>`position(${q(name)} in n)>0`).join(' OR ')}))`).join(' ')} ELSE FALSE END))`;
const relatedNameSql = `(split_part(n,'(',1) !~ ${q(`${SOFT_UNRELATED_NAME}|${LOCATION_BRANCH_BLOCK}|${AMBIGUOUS_STORE_NAME}`)} AND substring(n FROM length(split_part(n,'(',1))+1) !~ ${q(LOCATION_BRANCH_BLOCK)} AND (CASE brand ${Object.keys(BRAND_IDENTITIES).map(brand => `WHEN ${q(brand)} THEN ((n ~ ${q(brandNamePattern(brand))} OR n ~ ${q(brandSnackNamePattern(brand))} OR n ~ ${q(brandRelatedNamePattern(brand))}) AND ${Object.entries(BRAND_IDENTITIES).filter(([other])=>other!==brand).flatMap(([,names])=>names.map(name=>`position(${q(name)} in other_primary)=0`)).join(' AND ')})`).join(' ')} ELSE FALSE END))`;
const validRelatedNameSql = `(${relatedNameSql} AND n !~ ${q('\\([[:space:]]*店\\)')})`;
const relatedConflictSql = `(tags ~ ${q(`${CAKE_TAG}|${NON_TARGET_CATEGORY_TAG}|住宿|医疗|公司|科教|商务住宅`)} AND NOT (business_tags ~ '(^|[;,])零食([;,]|$)' AND business_tags !~ ${q(CAKE_TAG)}))`;
const hxlRetailSql = `(brand='好想来' AND position('好想来' in split_part(n,'(',1))>0
 AND n !~ ${q('\\([[:space:]]*(店)?\\)')}
 AND split_part(n,'(',1) !~ ${q(`${SOFT_UNRELATED_NAME}|${LOCATION_BRANCH_BLOCK}|${HXL_REVIEW_NAME}`)}
 AND ${Object.entries(BRAND_IDENTITIES).filter(([brand])=>brand!=='好想来').flatMap(([,names])=>names.map(name=>`position(${q(name)} in other_primary)=0`)).join(' AND ')}
 AND NOT (position(')' in n)>0 AND regexp_replace(n,'^.*\\)','') ~ ${q(`${UNRELATED_NAME}|${EXPLICIT_UNRELATED}`)})
 AND (CASE WHEN btrim(replace(business_tags,';',''))<>'' THEN business_tags ELSE pt END) ~ ${q(RELATED_STORE_TAG)}
 AND tags !~ ${q(EXTREME_STORE_TAG)} AND NOT ${relatedConflictSql})`;
const nameMatchSql = Object.keys(BRAND_IDENTITIES).map(brand => {
 const strict = `n ~ ${q(brandNamePattern(brand))}`;
 const soft = ` OR (business_snack AND ${shoppingCategory} AND split_part(n,'(',1) !~ ${q(SOFT_UNRELATED_NAME)} AND n ~ ${q(brandBareBranchPattern(brand))}) OR (retail AND ${shoppingCategory} AND n ~ '^[^()]+\\([^()]+\\)$' AND split_part(n,'(',1) ~ ${q(brandLocationPrimaryPattern(brand))} AND split_part(split_part(n,'(',2),')',1) !~ ${q(LOCATION_BRANCH_BLOCK)})`;
 return `WHEN ${q(brand)} THEN (${strict}${soft})`;
}).join("\n");
const effectiveLabelsSql = `(CASE WHEN btrim(replace(business_tags,';',''))<>'' THEN business_tags ELSE pt END)`;
const nameFirstBranchSql = `(brand='优味多' AND n ~ ${q(brandStandardBranchPattern('优味多'))}
 AND ${primaryForExclusionsSql} !~ ${q(`${SOFT_UNRELATED_NAME}|${AMBIGUOUS_STORE_NAME}|${LOCATION_BRANCH_BLOCK}`)}
 AND substring(n FROM length(split_part(n,'(',1))+1) !~ ${q(LOCATION_BRANCH_BLOCK)}
 AND ${Object.entries(BRAND_IDENTITIES).filter(([brand])=>brand!=='优味多').flatMap(([,names])=>names.map(name=>`position(${q(name)} in other_primary)=0`)).join(' AND ')})`;
const nameFirstExtremeSql = `(${effectiveLabelsSql} ~ ${q(NAME_FIRST_BRANCH_REVIEW_TAG)} OR (btrim(replace(business_tags,';',''))='' AND c ~ '(^|[|;,])(08|09|10|12|14|17)[0-9]{4}([|;,]|$)'))`;
const shopping06Sql = `(EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE btrim(item) ~ '^购物服务(;|$)')
 AND c ~ '(^|[|;,])06[0-9]{4}([|;,]|$)')`;
const zeroYouxuanZhaoshangLandmarkSql = `(brand='零食优选' AND n ~ ${q(ZERO_YOUXUAN_ZHAOSHANG_LANDMARK_NAME)} AND ${shopping06Sql})`;
const confirmedRetailNameSql = `(brand IN (${CONFIRMED_ADDITIONAL_BRANDS.map(q).join(',')})
 AND ${primaryForExclusionsSql} !~ ${q(`${SOFT_UNRELATED_NAME}|${AMBIGUOUS_STORE_NAME}|${LOCATION_BRANCH_BLOCK}`)}
 AND (${zeroYouxuanZhaoshangLandmarkSql} OR substring(n FROM length(split_part(n,'(',1))+1) !~ ${q(LOCATION_BRANCH_BLOCK)})
 AND ((CASE brand ${nameMatchSql} ELSE FALSE END) OR (CASE brand ${CONFIRMED_ADDITIONAL_BRANDS.map(brand=>`WHEN ${q(brand)} THEN n ~ ${q(brandSnackNamePattern(brand))}`).join(' ')} ELSE FALSE END)
 OR (brand='零食优选' AND n ~ ${q(ZERO_YOUXUAN_SAVING_CONVENIENCE_NAME)}) OR ${zeroYouxuanZhaoshangLandmarkSql}))`;
const confirmedMismatchSql = `(${effectiveLabelsSql} ~ ${q(`${CAKE_TAG}|${NON_TARGET_CATEGORY_TAG}|${CONFLICT_TAG}|${EXTREME_STORE_TAG}`)}
 OR ${effectiveLabelsSql} ~ ${q(EXCLUDED_STORE_LABEL)}
 OR (btrim(replace(business_tags,';',''))='' AND c ~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$))[0-9]{6}([|;,]|$)'))`;
const confirmedRetailEvidenceSql = `(${effectiveLabelsSql} ~ '零食|超市|购物|便利店|折扣店' OR (btrim(replace(business_tags,';',''))='' AND c ~ '(^|[|;,])06[0-9]{4}([|;,]|$)'))`;
const hotmaxxStandardNameSql = `(brand='好特卖' AND n ~* ${q(`^${HOTMAXX_OFFICIAL_NAME_PATTERN}(?:[[:space:]]*\\((?![[:space:]]*店\\))[^()]+店\\)){0,2}$`)})`;
const hotmaxxReverseNameSql = `(brand='好特卖' AND n ~* ${q(`^${HOTMAXX_REVERSE_NAME_PATTERN}(?:[[:space:]]*\\((?![[:space:]]*店\\))[^()]+店\\)){0,2}$`)})`;
const hotmaxxSupermarketNameSql = `(brand='好特卖' AND n ~ ${q(HOTMAXX_SUPERMARKET_NAME_PATTERN.replaceAll('\\s','[[:space:]]'))})`;
const hotmaxxSupermarketLabelSql = `business_tags ~ ${q('(^|[;,|])[[:space:]]*超市[[:space:]]*([;,|]|$)')}`;
const hotmaxxMallBranchSql = `substring(n FROM ${q(`(?i)^${HOTMAXX_OFFICIAL_NAME_PATTERN}\\(([^()]+)\\)$`)})`;
const hotmaxxSingleMallNameSql = `(brand='好特卖' AND btrim(COALESCE(${hotmaxxMallBranchSql},''))<>''
 AND position('店' in ${hotmaxxMallBranchSql})=0
 AND ${hotmaxxMallBranchSql} ~ ${q(HOTMAXX_MALL_LANDMARK_HINT)}
 AND ${hotmaxxMallBranchSql} !~ ${q(HOTMAXX_MALL_BRANCH_CONFLICT)})`;
const hotmaxxOfficialNameSql = `(${hotmaxxStandardNameSql} OR ${hotmaxxReverseNameSql} OR ${hotmaxxSingleMallNameSql})`;
const hotmaxxConflictSql = `(tags ~ ${q(HOTMAXX_CONFLICT_TAG)} OR ${effectiveLabelsSql} ~ ${q(EXCLUDED_STORE_LABEL)}
 OR (btrim(replace(business_tags,';',''))='' AND c ~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$)|070000([|;,]|$))[0-9]{6}([|;,]|$)'))`;
const hotmaxxDailyOnlySql = `(brand='好特卖' AND n ~* ${q(HOTMAXX_DAILY_BRANCH_PATTERN)} AND ${shopping06Sql}
 AND tags ~ ${q('(^|[;,|])[[:space:]]*日杂店[[:space:]]*([;,|]|$)')}
 AND tags !~ ${q(HOTMAXX_CONFLICT_TAG)}
 AND tags !~ ${q(EXCLUDED_STORE_LABEL.replace('|日杂店',''))}
 AND c !~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$))[0-9]{6}([|;,]|$)')`;
const hotmaxxRetailEvidenceSql = `(EXISTS (SELECT 1 FROM unnest(string_to_array(pt,'|')) item WHERE btrim(item) ~ '^购物服务(;|$)')
 OR ${effectiveLabelsSql} ~ '零食|超市|购物' OR c ~ '(^|[|;,])06[0-9]{4}([|;,]|$)')`;
const zeroYouxuanSourcePrimarySql = `split_part(source_name,'(',1)`;
const zeroYouxuanPrefixSql = `btrim(left(${zeroYouxuanSourcePrimarySql},position('零食优选' in ${zeroYouxuanSourcePrimarySql})-1))`;
const zeroYouxuanOtherShopPrefixSql = `(brand='零食优选' AND position('零食优选' in ${zeroYouxuanSourcePrimarySql})>1
 AND (${zeroYouxuanPrefixSql} ~ ${q(ZERO_YOUXUAN_NON_LOCATION_PREFIX)} OR ${zeroYouxuanPrefixSql} !~ ${q(`^${ZERO_YOUXUAN_LOCATION_PREFIX}$`)}))`;
export const brandPolicyFunctionsSql = `
CREATE OR REPLACE FUNCTION brand_policy_reason(brand text, name text, poi_id text, manual text, poi_type text, codes text, raw jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 WITH evidence AS MATERIALIZED (SELECT ${normalizedNameSql} AS n, ailingshi_normalize(name) AS source_name,
 COALESCE(poi_type,'') || ';' || COALESCE(raw->>'tag','') || ';' || COALESCE(raw#>>'{business,tag}','') || ';' || COALESCE(raw#>>'{business,rectag}','') || ';' || COALESCE(raw#>>'{business,keytag}','') AS tags,
 COALESCE(raw->>'tag','') || ';' || COALESCE(raw#>>'{business,tag}','') || ';' || COALESCE(raw#>>'{business,rectag}','') || ';' || COALESCE(raw#>>'{business,keytag}','') AS business_tags,
 COALESCE(poi_type,'') AS pt,
 regexp_replace(COALESCE(codes,''),'[[:space:]]','','g') AS c), flags AS (
 SELECT *, CASE WHEN starts_with(split_part(n,'(',1),brand) THEN substring(split_part(n,'(',1) FROM length(brand)+1) ELSE split_part(n,'(',1) END AS other_primary,
 (tags ~ ${q(RETAIL_TAG)} OR c ~ '(^|[|;,])06[0-9]{4}([|;,]|$)') AS retail,
 tags ~ '零食' AS snack_evidence,
 business_tags ~ '(^|[;,])零食([;,]|$)' AS business_snack,
 tags ~ ${q(`(^|[;,|])[[:space:]]*(${CLEAR_RETAIL_LABEL})[[:space:]]*([;,|]|$)`)} AS clear_retail FROM evidence)
 SELECT CASE
 WHEN manual='exclude' THEN CASE WHEN btrim(COALESCE(poi_id,''))<>'' THEN ${q(R.blacklist)} ELSE ${q(R.recordExclude)} END
 WHEN source_name ~ ${q(INACTIVE_STATUS)} THEN ${q(R.inactive)}
 WHEN n ~ ${q(WAREHOUSE_BRANCH)} THEN ${q(R.warehouse)}
 WHEN ${hotmaxxOfficialNameSql} AND n ~ ${q(HOTMAXX_NON_STORE_BRANCH)} THEN ${q(R.hotmaxxNonStoreBranch)}
 WHEN brand='零食优选' AND source_name ~ ${q(ZERO_YOUXUAN_NON_STORE_NAME)} THEN ${q(R.nonStoreEntity)}
 WHEN brand='加一加' AND split_part(n,'(',1) ~ ${q(ADDONE_UNRELATED_NAME)} THEN ${q(R.unrelated)}
 WHEN ${primaryForExclusionsSql} ~ ${q(`${UNRELATED_NAME}|${EXPLICIT_UNRELATED}|${CLEAR_UNRELATED_BUSINESS}`)} OR ${otherShopLandmarkSql} OR n ~ ${q(NON_STORE_BRANCH)} OR source_name ~ ${q(NON_STORE_TAIL)} THEN ${q(R.unrelated)}
 WHEN (brand='爱零食' AND split_part(n,'(',1) ~ ${q(SIMILAR_NAME)}) OR (brand='好想来' AND n ~ '^好像来') THEN ${q(R.similar)}
 WHEN brand='好想来' AND split_part(n,'(',1) ~ ${q(HXL_NON_BRAND_NAME)} THEN ${q(R.hxlNonBrand)}
 WHEN split_part(n,'(',1) ~ ${q(CONFIRMED_NON_CHAIN_NAME)} THEN ${q(R.nonChain)}
 WHEN manual='accept' THEN CASE
  WHEN ${missingIdentitySql} AND (${[...new Set(Object.values(BRAND_IDENTITIES).flat())].map(name=>`position(${q(name)} in split_part(n,'(',1))>0`).join(' OR ')}) THEN ${q(R.noBrand)}
  ELSE CASE WHEN btrim(COALESCE(poi_id,''))<>'' THEN ${q(R.manual)} ELSE ${q(R.manualRecord)} END END
 WHEN ${zeroYouxuanOtherShopPrefixSql} THEN ${q(R.otherShopPrefix)}
 WHEN manual<>'accept' AND ${missingIdentitySql} THEN ${q(R.noBrand)}
 WHEN ${hotmaxxOfficialNameSql} THEN CASE
  WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)}
  WHEN btrim(replace(tags,';',''))='' AND c !~ '(^|[|;,])[0-9]{6}([|;,]|$)' THEN ${q(R.missing)}
  WHEN ${hotmaxxConflictSql} AND NOT ${hotmaxxDailyOnlySql} THEN ${q(R.confirmedMismatch)}
  WHEN (${hotmaxxSingleMallNameSql} OR ${hotmaxxReverseNameSql}) AND NOT ${shopping06Sql} THEN ${q(R.tags)}
  WHEN NOT ${hotmaxxRetailEvidenceSql} THEN ${q(R.tags)}
  ELSE ${q(R.hotmaxxOfficial)} END
 WHEN ${hotmaxxSupermarketNameSql} THEN CASE
  WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)}
  WHEN btrim(replace(tags,';',''))='' AND c !~ '(^|[|;,])[0-9]{6}([|;,]|$)' THEN ${q(R.missing)}
  WHEN ${hotmaxxConflictSql} THEN ${q(R.confirmedMismatch)}
  WHEN NOT ${shopping06Sql} OR NOT ${hotmaxxSupermarketLabelSql} THEN ${q(R.tags)}
  ELSE ${q(R.hotmaxxSupermarket)} END
 WHEN ${nameFirstBranchSql} THEN CASE
  WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)}
  WHEN btrim(replace(tags,';',''))='' AND c !~ '(^|[|;,])[0-9]{6}([|;,]|$)' THEN ${q(R.missing)}
  WHEN ${nameFirstExtremeSql} THEN ${q(R.extreme)} ELSE ${q(R.nameFirstBranch)} END
 WHEN ${confirmedRetailNameSql} THEN CASE
  WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)}
  WHEN btrim(replace(tags,';',''))='' AND c !~ '(^|[|;,])[0-9]{6}([|;,]|$)' THEN ${q(R.missing)}
  WHEN ${confirmedMismatchSql} THEN ${q(R.confirmedMismatch)}
  WHEN NOT ${confirmedRetailEvidenceSql} THEN ${q(R.tags)}
  WHEN manual='accept' THEN ${q(R.manual)} ELSE ${q(R.accepted)} END
 WHEN brand='爱零食' AND split_part(n,'(',1) ~ '^爱零食优选' AND manual<>'accept' THEN CASE WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)} ELSE ${q(R.overlappingName)} END
 WHEN (CASE WHEN btrim(replace(business_tags,';',''))<>'' THEN business_tags ELSE pt END) ~ ${q(EXCLUDED_STORE_LABEL)} THEN ${q(R.excludedLabel)}
 WHEN ${validRelatedNameSql} AND tags ~ ${q(EXTREME_STORE_TAG)} THEN ${q(R.extreme)}
 WHEN tags ~ ${q(HARD_NON_RETAIL_TAG)} THEN ${q(R.hardCategory)}
 WHEN tags ~ ${q(CAKE_TAG)} AND NOT snack_evidence THEN ${q(R.cake)}
 WHEN tags ~ ${q(NON_TARGET_CATEGORY_TAG)} AND NOT snack_evidence THEN ${q(R.category)}
 WHEN btrim(COALESCE(poi_id,''))='' THEN ${q(R.noId)}
 WHEN manual<>'accept' AND brand='零食有鸣' AND n ~ ${q(REVIEW_CONVENIENCE)} THEN ${q(R.convenience)}
 WHEN btrim(replace(tags,';',''))='' AND c !~ '(^|[|;,])[0-9]{6}([|;,]|$)' THEN ${q(R.missing)}
 WHEN manual<>'accept' AND brand='好想来' AND position('好想来' in split_part(n,'(',1))>0 AND (btrim(substring(split_part(n,'(',1) FROM position('好想来' in split_part(n,'(',1)))) !~ ${q(HXL_PRIMARY_PATTERN)} OR substring(split_part(n,'(',1) FROM position('好想来' in split_part(n,'(',1))+3) ~ ${q(HXL_REVIEW_NAME)}) THEN ${q(R.hxlSuffix)}
 WHEN brand IN (${CONFIRMED_ADDITIONAL_BRANDS.map(q).join(',')}) AND manual<>'accept' THEN ${q(R.name)}
 WHEN ${hxlRetailSql} THEN ${q(R.related)}
 WHEN ${validRelatedNameSql} AND (tags ~ ${q(RELATED_STORE_TAG)} OR c ~ '(^|[|;,])(05|06)[0-9]{4}([|;,]|$)') AND NOT ${relatedConflictSql} THEN ${q(R.related)}
 WHEN ${snackNameSql} THEN ${q(R.accepted)}
 WHEN manual<>'accept' AND NOT (CASE brand ${nameMatchSql} ELSE FALSE END) THEN ${q(R.name)}
 WHEN ${chainNameSql} THEN ${q(R.chain)}
 WHEN (tags ~ ${q(`${CAKE_TAG}|${NON_TARGET_CATEGORY_TAG}|${CONFLICT_TAG}`)} OR c ~ '(^|[|;,])(?!06[0-9]{4}([|;,]|$)|070000([|;,]|$))[0-9]{6}([|;,]|$)') AND NOT ${resolvedConflict} THEN ${q(R.conflict)}
 WHEN NOT retail THEN ${q(R.tags)}
 WHEN manual='accept' THEN ${q(R.manual)} ELSE ${q(R.accepted)} END FROM flags
$$;
CREATE OR REPLACE FUNCTION brand_policy_decision(brand text, name text, poi_id text, manual text, poi_type text, codes text, raw jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE brand_policy_reason(brand,name,poi_id,manual,poi_type,codes,raw)
 WHEN ${q(R.accepted)} THEN '接受' WHEN ${q(R.manual)} THEN '接受' WHEN ${q(R.manualRecord)} THEN '接受' WHEN ${q(R.chain)} THEN '接受' WHEN ${q(R.related)} THEN '接受' WHEN ${q(R.nameFirstBranch)} THEN '接受' WHEN ${q(R.hotmaxxOfficial)} THEN '接受' WHEN ${q(R.hotmaxxSupermarket)} THEN '接受'
 ${[R.blacklist,R.recordExclude,R.inactive,R.warehouse,R.unrelated,R.similar,R.hardCategory,R.cake,R.category,R.hxlNonBrand,R.excludedLabel,R.noBrand,R.nonChain,R.otherShopPrefix,R.nonStoreEntity,R.hotmaxxNonStoreBranch].map(r=>`WHEN ${q(r)} THEN '排除'`).join(" ")}
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
