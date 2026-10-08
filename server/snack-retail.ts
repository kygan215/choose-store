import { DEFAULT_SNACK_BRANDS, RETIRED_SNACK_BRANDS } from "./snack-brands.js";
// Target brands may carry broad retail tags instead of Amap's snack tag.
// Ignore branch names (which can contain nearby restaurant/street names).
const NON_SNACK_NAME = "酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|垂钓园|餐饮店|甜品店|奶茶店|烘焙坊|冰粉|冰沙|凉糕|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆";
const NON_RETAIL_TYPE = "餐饮|住宿|医疗|公司企业|交通设施|生活服务|科教文化|商务住宅";
const nonSnackName = new RegExp(NON_SNACK_NAME);
const nonRetailType = new RegExp(NON_RETAIL_TYPE);
const targetBrandPattern = `^(${[...new Set(DEFAULT_SNACK_BRANDS.flatMap(brand=>brand.aliases))].map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})`;
const targetBrand = new RegExp(targetBrandPattern);
const suspectedTargetBrand = new RegExp(targetBrandPattern.slice(1));
const BROAD_RETAIL_TAG = "日杂店|综合超市";
const clean = (value: unknown) => String(value ?? "").trim();
type SnackPoi = {name?:unknown;amap_name?:unknown;type?:unknown;poi_type?:unknown;typecode?:unknown;tag?:unknown;business?:unknown};
export function snackTags(row: SnackPoi) {
  const business = row.business && typeof row.business === "object" ? row.business as {tag?:unknown;rectag?:unknown;keytag?:unknown} : {};
  return [...new Set([clean(row.tag), clean(business.tag), clean(business.rectag), clean(business.keytag)].filter(Boolean))].join(";");
}

export function isTargetSnackBrandName(value: unknown) {
  return suspectedTargetBrand.test(clean(value).replace(/\s/g, "").split(/[（(]/)[0]);
}

export function hasClearlyNonSnackEvidence(row: SnackPoi) {
  const name = clean(row.name ?? row.amap_name).replace(/\s/g, "").split(/[（(]/)[0];
  // Category labels alone are not reliable enough to delete an existing shop.
  return nonSnackName.test(name);
}

export function hasCategoryConflict(row: SnackPoi) {
  const codes = clean(row.typecode).replace(/\s/g, "");
  if (codes.split(/[|;,]/).some(code => /^\d{6}$/.test(code) && !/^(06\d{4}|070000)$/.test(code))) return true;
  // Amap also files verified snack shops under this generic service category.
  const type = clean(row.type ?? row.poi_type).replaceAll("生活服务;生活服务场所;生活服务场所", "");
  return nonRetailType.test(type);
}

export function isSnackRetailStore(row: SnackPoi) {
  const name = clean(row.name ?? row.amap_name).replace(/\s/g, "").split(/[（(]/)[0];
  if (!name || hasClearlyNonSnackEvidence(row) || hasCategoryConflict(row)) return false;
  const type = clean(row.type ?? row.poi_type);
  const tags = `${type};${snackTags(row)}`;
  return /零食/.test(tags) || (targetBrand.test(name) && new RegExp(BROAD_RETAIL_TAG).test(tags));
}

export function canRetainSnackStore(row: SnackPoi, requestedBrand = "") {
  if (hasClearlyNonSnackEvidence(row)) return false;
  const name = clean(row.name ?? row.amap_name).replace(/\s/g, "").split(/[（(]/)[0];
  return isSnackRetailStore(row) || isTargetSnackBrandName(name) ||
    Boolean(requestedBrand && name.startsWith(requestedBrand.replace(/\s/g, "")));
}

export function snackReviewStatus(row: SnackPoi) {
  return isSnackRetailStore(row) ? "已核验" : "待核验";
}

// Existing library entries with insufficient tags remain selectable/exportable.
// Exclude only explicit unrelated evidence, consistently across all library views.
// Only internal aliases are accepted; no user input is interpolated into SQL.
export function snackRetailSql(alias = "") {
  if (alias && !/^[a-z_]+$/.test(alias)) throw new Error("Invalid SQL alias");
  const prefix = alias ? `${alias}.` : "";
  const retired = RETIRED_SNACK_BRANDS.map(name=>`'${name.replace(/'/g,"''")}'`).join(",");
  return `(${prefix}brand_name NOT IN (${retired})
    AND NOT (${prefix}brand_name ~ '[、，,]' AND ${prefix}brand_name ~ '零食优选|零食好能嗨|零食很能嗨')
    AND split_part(split_part(regexp_replace(${prefix}amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> ''
    AND split_part(split_part(regexp_replace(${prefix}amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '${NON_SNACK_NAME}')`;
}
