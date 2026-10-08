import { RETIRED_SNACK_BRANDS } from "./snack-brands.js";
// Brand aliases recall candidates; they do not prove that a POI is a snack shop.
// Ignore branch names (which can contain nearby restaurant/street names).
const NON_SNACK_NAME = "酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|饭庄|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|米粉|酒店|宾馆|药房|药店|生鲜|水果|烟酒|便利店|服装|理发|美容|公司|仓库|配送中心";
const NON_RETAIL_TYPE = "餐饮|住宿|医疗|公司企业|交通设施|生活服务|科教文化|商务住宅";
const nonSnackName = new RegExp(NON_SNACK_NAME);
const nonRetailType = new RegExp(NON_RETAIL_TYPE);
const clean = (value: unknown) => String(value ?? "").trim();
type SnackPoi = {name?:unknown;amap_name?:unknown;type?:unknown;poi_type?:unknown;typecode?:unknown;tag?:unknown;business?:unknown};
export function snackTags(row: SnackPoi) {
  const business = row.business && typeof row.business === "object" ? row.business as {tag?:unknown;rectag?:unknown;keytag?:unknown} : {};
  return [...new Set([clean(row.tag), clean(business.tag), clean(business.rectag), clean(business.keytag)].filter(Boolean))].join(";");
}

export function isSnackRetailStore(row: SnackPoi) {
  const name = clean(row.name ?? row.amap_name).replace(/\s/g, "").split(/[（(]/)[0];
  if (!name || nonSnackName.test(name)) return false;
  const codes = clean(row.typecode).replace(/\s/g, "");
  if (codes && !/^(06\d{4}|070000)([|;,](06\d{4}|070000))*$/.test(codes)) return false;
  // Amap also files verified snack shops under this generic service category.
  const type = clean(row.type ?? row.poi_type).replaceAll("生活服务;生活服务场所;生活服务场所", "");
  return !nonRetailType.test(type) && /零食/.test(`${type};${snackTags(row)}`);
}

// Same eligibility gate for historical rows, counts, selection and exports.
// Only internal aliases are accepted; no user input is interpolated into SQL.
export function snackRetailSql(alias = "") {
  if (alias && !/^[a-z_]+$/.test(alias)) throw new Error("Invalid SQL alias");
  const prefix = alias ? `${alias}.` : "";
  const retired = RETIRED_SNACK_BRANDS.map(name=>`'${name.replace(/'/g,"''")}'`).join(",");
  return `(${prefix}brand_name NOT IN (${retired})
    AND NOT (${prefix}brand_name ~ '[、，,]' AND ${prefix}brand_name ~ '零食优选|零食好能嗨|零食很能嗨')
    AND split_part(split_part(regexp_replace(${prefix}amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) <> ''
    AND split_part(split_part(regexp_replace(${prefix}amap_name, '[[:space:]]', '', 'g'), '(', 1), '（', 1) !~ '${NON_SNACK_NAME}'
    AND (regexp_replace(${prefix}typecode, '[[:space:]]', '', 'g') = '' OR regexp_replace(${prefix}typecode, '[[:space:]]', '', 'g') ~ '^(06[0-9]{4}|070000)([|;,](06[0-9]{4}|070000))*$')
    AND replace(${prefix}poi_type, '生活服务;生活服务场所;生活服务场所', '') !~ '${NON_RETAIL_TYPE}'
    AND concat_ws(';', ${prefix}poi_type, ${prefix}raw_json->>'tag', ${prefix}raw_json#>>'{business,tag}', ${prefix}raw_json#>>'{business,rectag}', ${prefix}raw_json#>>'{business,keytag}') LIKE '%零食%')`;
}
