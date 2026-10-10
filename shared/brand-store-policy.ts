import { normalizeAilingshiName, type AilingshiOverride } from "./ailingshi.js";

// Brand identities come from the catalog, user confirmations and brand sites.
// Full-name patterns below are our screening policy, not official certification.
export const BRAND_IDENTITIES: Record<string, string[]> = {
  "吖嘀吖嘀": ["吖嘀吖嘀"], "好想来": ["好想来", "好想来品牌零食", "好想来零食乐园", "好想来全食优选"],
  "戴永红": ["戴永红"], "来伊份": ["来伊份"], "来优品": ["来优品", "来优品品牌零食", "来优品零食乐园"],
  "爱零食": ["爱零食"], "糖巢": ["糖巢"], "老婆大人": ["老婆大人"],
  "赵一鸣零食": ["赵一鸣零食", "赵一鸣省钱超市"], "陆小馋": ["陆小馋"],
  "零食很忙": ["零食很忙"], "零食悦": ["零食悦"], "零食有鸣": ["零食有鸣"],
};
export const RETAIL_SUFFIX = "零食|零食店|零食铺|零食超市|零食省钱超市|量贩零食|量贩零食店|量贩零食超市|零食量贩|零食量贩店|零食专卖店|新一代国民零食|休闲食品|超市|批发超市|硬折扣超市|省钱超市|折扣超市|购物超市|生活超市|便利店|便利超市|量贩便利店";
export const UNRELATED_NAME = "蛋糕|糕饼|西饼|酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|浇面|米粉|足道|足疗|足浴|按摩|推拿|生鲜超市|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|甜品|烘焙|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站|铁锅炖|农家饭馆|钓鱼|垂钓|钓场|台球(俱乐部|店)?$|棋牌(俱乐部|室)?$|洗衣(店)?$|果业$|眼镜店$";
export const RETAIL_TAG = "零食|超市|购物";
export const CAKE_TAG = "蛋糕|糕饼|西饼|烘焙|甜品";
// Concrete non-target POI labels override broad shopping evidence. Generic major
// categories stay reviewable because Amap can misclassify genuine brand stores.
export const NON_TARGET_CATEGORY_TAG = "中餐厅|西餐厅|快餐厅|小吃店|面馆|粉面店|火锅店|烧烤店|奶茶店|咖啡厅|茶馆|洗浴|足疗|足道|足浴|按摩|推拿|养生馆|美容院|美发店|理发店|药店|药房|生鲜超市|生鲜店|生鲜市场|农贸市场|菜市场|水果店|蔬菜店|酒店|宾馆|民宿|仓库|物流";
export const HARD_NON_RETAIL_TAG = "棋牌室|台球厅|垂钓园|钓场|快餐厅|小吃店|面馆|粉面店|洗浴|足疗|足道|足浴|按摩|推拿|生鲜超市|生鲜店";
export const CONFLICT_TAG = "餐饮|住宿|医疗|公司企业|交通设施|科教文化|商务住宅";
export const GENERIC_CATERING_TYPE = "餐饮服务;餐饮相关场所;餐饮相关";
export const SHOPPING_TYPE_FOR_CONFLICT = "购物服务;(购物相关场所;购物相关场所|专卖店;专营店|便民商店/便利店;便民商店/便利店|超级市场;(超市|综合超市))";
export const SIMILAR_NAME = "(^爱零食的喵|我爱零食|最爱零食|爱零食小屋|吾爱零食|嘴爱零食|唯爱零食|喜爱零食|久爱零食|伍爱零食|几分爱零食)";
export const EXPLICIT_UNRELATED = "娱乐馆|资产$|控股集团|网络$|信息中心|种植场|冷冻大全|冰社$|家具|家纺|文具店|培训中心|旅馆|青年旅舍|客栈|家庭农场|骨科|运营中心|总部$|凉菜|把子肉|攀爬乐园|服饰鞋帽|煎饼|猪脚饭|游泳健身|烟酒|锅贴|老年俱乐部|茶馆|茶府|蒸包|鲜肉|果蔬|糖水|茶饮|饮品|冷饮|冰糖葫芦|居酒屋|餐酒馆|拖鞋|电子厂|清洁用品|鲜花店|加工厂|装修(店)?$|休闲娱乐馆|健康生活馆|仓储物流中心|仓储中心|物流中心|共配中心|营销中心|业务中心|收货区|食品包装|专业音响|音响设备|童装|内衣|饰界|五金|电脑|数码|烟花爆竹|代买|代购|仓$";
export const NON_STORE_BRANCH = "\\([^()]*(办事处|营销中心|收货区|业务中心|仓储物流中心|运营中心|总部)\\)";
export const NON_STORE_TAIL = "\\)[^()]*(停车场|自动售货机)$";
export const CLEAR_RETAIL_LABEL = "零食|超市|综合超市|大型超市|折扣超市";
export const RELATED_STORE_TAG = "零食|超市|购物|餐饮|便利店|中式快餐|专营店|专卖店";
// Match evidence labels, never words in store names or branch landmarks.
export const EXCLUDED_STORE_LABEL = "(^|[;,|])[[:space:]]*(公司|公司企业|培训机构|农副产品|农副产品市场|住宅区|住宅小区|化妆品|化妆品店|日杂店|住宿服务|住宿服务相关)[[:space:]]*([;,|]|$)";
export const HXL_NON_BRAND_NAME = "好想来[^()]*(副食|奶站|官方)";
export const EXTREME_STORE_TAG = "按摩|推拿|洗浴|足疗|足道|足浴|中医|医疗|医院|诊所|药房|药店|棋牌|台球|垂钓|钓场|美容|美发|化妆品|服饰|服装|金店|珠宝|保健|桌游|茶业|烟酒|雪茄";
export const AMBIGUOUS_STORE_NAME = "奶站|驿站|官方$|服务中心|体验馆|生活馆|工厂|前台|内部专用|融合店|的喵|小屋";
export const HXL_REVIEW_NAME = "驿站|服务|体验|生活馆|前台|内部专用|融合店|旅游|旅行|汽车服务|汽修|维修|科技馆|科技公司|教育|工作室|咨询|文化馆";
export const HXL_PRIMARY_PATTERN = `^好想来(?:[·-]?(?:${RETAIL_SUFFIX}|全食优选|品牌零食|品牌零食乐园|品牌乐园|零食乐园|零食可乐园|零食小镇|零食屋|零食工厂|零食优品|零食连锁|优选零食店|食品|食品店|百货|百货超市|百货日用超市|购物中心|省钱))?(?:[·-]?[一-龥A-Za-z0-9·,－-]{2,60}(?:店|路|街|巷|道|弄|广场|小区|社区|花园|公馆|路口|城|村|苑|府|大厦|号|学院|学校|大学|西站))?$`;
export const OTHER_SHOP_TAG = "鞋店|金店|珠宝|服饰鞋包|内衣|童装|视听影音|数码|电脑销售|五金|礼品店";
export const REVIEW_CONVENIENCE = "^零食有鸣便利(\\(|$)";
export const SOFT_UNRELATED_NAME = "台球|棋牌|游乐|洗衣|家纺|家具|烟花|文具|眼镜|培训|果业|喜铺|喜礼|婚品|拖鞋|直播|代买|代购|朱砂";
export const LOCATION_BRANCH_BLOCK = "暂停营业|装修中|停业|歇业|已关闭|仓库|仓$|客服|公司|总部|配送|办公|招商|面试";
export const INACTIVE_STATUS = "暂停营业|装修中|正在装修|装修店铺|停业|歇业|已关闭|未开业|即将开业|待开业|筹备中|施工中";
export const WAREHOUSE_BRANCH = "\\([^()]*(仓库|仓)\\)";
export const POLICY_REASONS = {
  blacklist: "按 POI ID 人工排除", unrelated: "名称主体明确为餐饮、足浴、生鲜、仓库等非目标业态",
  inactive: "标注暂停营业、装修中或未开业，非当前营业门店",
  warehouse: "名称明确为仓库，非营业门店",
  similar: "相似名称，不按目标品牌收录", cake: "分类或标签明确为蛋糕／烘焙等非目标业态",
  category: "高德具体分类或标签明确为餐饮、足浴、生鲜等非目标业态",
  hardCategory: "高德具体分类或标签明确为棋牌、垂钓、面馆、足浴或生鲜等非目标业态",
  noId: "缺少 POI ID，待核验", name: "名称未匹配品牌完整结构，待核验",
  convenience: "零食有鸣便利名称按用户要求待核验",
  related: "品牌主体明确，购物／餐饮／便利店等相关证据通过初筛，未验证品牌归属",
  extreme: "名称疑似品牌门店，但分类或标签明显不相关，待核验",
  missing: "缺少分类、标签及有效分类编码，待核验",
  excludedLabel: "分类或标签为公司、培训机构、农副产品、住宅区、化妆品、日杂店或住宿服务，按用户规则排除",
  hxlNonBrand: "好想来副食／副食品、奶站或官方名称按用户要求排除",
  hxlSuffix: "好想来后缀无法识别为零售名称或分店地址，待核验",
  conflict: "高德分类或标签证据冲突，待核验", tags: "缺少零食／超市／购物分类或标签证据，待核验",
  accepted: "品牌名称与零食／超市／购物证据通过初筛，未验证品牌归属",
  chain: "规范连锁门店名称通过初筛；高德分类或标签未证实，尚未核验品牌归属及营业状态",
  manual: "按 POI ID 人工确认名称，零食／超市／购物证据通过初筛",
} as const;
export const isPolicyBrand = (brand: string) => Object.hasOwn(BRAND_IDENTITIES, brand);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Repairs only mechanical formatting; original_name remains untouched. Keep
// these ordered replacements shared with PostgreSQL to avoid divergent results.
export const NAME_REPAIRS: Array<[string, string]> = [
  ["^([^()]+\\([^()]+)\\)([^()]+店)\\)$", "$1$2)"],
  ["品牌品牌零食", "品牌零食"],
  ["省钱省钱超市", "省钱超市"],
  ["^([^()]+)\\[省钱超市\\]$", "$1省钱超市"],
  ["^([^()]+\\([^()]+)[}〕］]$", "$1)"],
  ["^([^()]+\\([^()]+)$", "$1)"],
  ["^([^()]+\\([^()]+\\))\\)+$", "$1"],
  ["^([^()]+\\([^()]+\\))[^()]{1,30}(路|街|道|巷|弄)[0-9]+号?$", "$1"],
];
export function brandGeoPrefixPattern(brand: string) {
  return `^(?:[一-龥]{1,12}(?:省|市|县|区|镇|乡|村)){1,3}(${(BRAND_IDENTITIES[brand] || [brand]).map(escapeRegex).join("|")})`;
}
export function brandMatchName(brand: string, name: string) {
  let result = name;
  for (const [pattern, replacement] of NAME_REPAIRS) result = result.replace(new RegExp(pattern), replacement);
  return result.replace(new RegExp(brandGeoPrefixPattern(brand)), "$1");
}
export function brandNamePattern(brand: string) {
  const names = BRAND_IDENTITIES[brand] || [brand];
  const branch = "\\((?!\\s*店\\))[^()]+店\\)";
  const branches = `(?:\\s*${branch}){1,2}`;
  const max = brand === "零食有鸣" ? `|MAX${branches}` : "";
  // Match recurrent chain formats, not arbitrary brand-keyword hits.
  return `^(${names.map(escapeRegex).join("|")})(?:(?:·?(${RETAIL_SUFFIX}))(?:${branches}|[^()·,]{2,}店(?:${branches})?)?|${branches}|店(?:${branches})?|[-－][^()]+店${max})?$`;
}
export function brandBareBranchPattern(brand: string) {
  const names = BRAND_IDENTITIES[brand] || [brand];
  return `^(${names.map(escapeRegex).join("|")})[^()·,]{2,}店$`;
}
export function brandLocationPrimaryPattern(brand: string) {
  const names = BRAND_IDENTITIES[brand] || [brand];
  return `^(${names.map(escapeRegex).join("|")})(?:·?(${RETAIL_SUFFIX}))?$`;
}
// Only used with explicit snack/supermarket evidence; search keywords stay unchanged.
// Accept location spelling/layout variants, not arbitrary text after a brand.
export function brandSnackNamePattern(brand: string) {
  const identities = brand === "赵一鸣零食" ? [...BRAND_IDENTITIES[brand], "赵一鸣"] : BRAND_IDENTITIES[brand] || [brand];
  const base = `(?:${identities.map(escapeRegex).join("|")})`;
  const suffix = `(?:${RETAIL_SUFFIX}|量版零食|贩量零食|量贩零食连锁|零食连锁|糖果超市|量贩店|量贩零食优品|零食优品|品牌零食乐园|品牌零食|零食乐园|零食屋|零食小镇|食品店|休闲食品店|购物中心|百货超市|生活批发超市|省钱零食超市|零食商店|优选零食店|零食量贩|量贩|省钱|批发超市店)`;
  const branch = "\\((?:[^()]|\\([^()]+\\))+\\)";
  const location = "[一-龥A-Za-z0-9·,－-]{2,40}(?:店|路|街|巷|道|弄|广场|小区|社区|花园|公馆|路口|城|村|苑|府|大厦|号|学院|学校|西站)";
  const ending = `(?:${branch}{1,2}|[·,-]?${location}(?:${branch}{1,2})?)?(?:[·-]?${suffix})?`;
  // Prefix relaxation requires an explicit retail descriptor. For 爱零食,
  // arbitrary prefixes often form another brand (吾爱零食/小可爱零食).
  const prefixed = brand === "爱零食" ? "" : `|(?:古现|厦门|合肥|屏南|德化|[一-龥]{2,20}(?:路|街|巷|镇|县|市|村|区|学院|学校|市场))·?${base}[·-]?${suffix}${ending}`;
  return `^(?:${base}(?:[·-]?${suffix})?${ending}${prefixed})$`;
}
// Relax layout only after recognizing the selected brand at the start. Do not
// turn arbitrary keyword hits or parenthesized landmarks into brand identity.
export function brandRelatedNamePattern(brand: string) {
  const names = brand === "赵一鸣零食" ? [...BRAND_IDENTITIES[brand], "赵一鸣"] : BRAND_IDENTITIES[brand] || [brand];
  const branch = "\\((?!店\\))[^()]+\\)";
  return `^(?:${names.map(escapeRegex).join("|")})[^()]*(?:${branch}){0,2}$`;
}
export type BrandPolicyPoi = { name?: unknown; amap_name?: unknown; id?: unknown; amap_poi_id?: unknown; type?: unknown; poi_type?: unknown; typecode?: unknown; tag?: unknown; business?: unknown };
export function retailTags(row: BrandPolicyPoi) {
  const business = row.business && typeof row.business === "object" ? row.business as Record<string, unknown> : {};
  return [row.type ?? row.poi_type, row.tag, business.tag, business.rectag, business.keytag].map(v => String(v ?? "").trim()).join(";");
}
export function assessBrandStore(brand: string, row: BrandPolicyPoi, override: AilingshiOverride = "") {
  const original_name = String(row.name ?? row.amap_name ?? ""), sourceName = normalizeAilingshiName(original_name);
  const normalized_name = brandMatchName(brand, sourceName);
  const poi_id = String(row.id ?? row.amap_poi_id ?? "").trim(), primary = normalized_name.split("(")[0];
  const tags = retailTags(row), codes = String(row.typecode ?? "").replace(/\s/g, "").split(/[|;,]/);
  const category = String(row.type ?? row.poi_type ?? "");
  const business = row.business && typeof row.business === "object" ? row.business as Record<string, unknown> : {};
  const businessSnack = [row.tag, business.tag, business.rectag, business.keytag]
    .some(value => String(value ?? "").split(/[;,]/).some(label => label.trim() === "零食"));
  const businessCategories = [row.tag, business.tag, business.rectag, business.keytag].map(value => String(value ?? "")).join(";");
  const exclusionLabels = businessCategories.replace(/;/g, "").trim() ? businessCategories : category;
  const retail = new RegExp(RETAIL_TAG).test(tags) || codes.some(c => /^06\d{4}$/.test(c));
  const snackEvidence = /零食/.test(tags);
  const cake = new RegExp(CAKE_TAG).test(tags);
  const nonTargetCategory = new RegExp(NON_TARGET_CATEGORY_TAG).test(tags);
  const conflict = cake || nonTargetCategory || new RegExp(CONFLICT_TAG).test(tags) || codes.some(c => /^\d{6}$/.test(c) && !/^(06\d{4}|070000)$/.test(c));
  const shoppingType = new RegExp(`^${SHOPPING_TYPE_FOR_CONFLICT}$`);
  const genericCatering = category.split("|").every(item => item === GENERIC_CATERING_TYPE || shoppingType.test(item)) && category.includes(GENERIC_CATERING_TYPE);
  const cakeWithRetailProof = cake && businessSnack && !nonTargetCategory
    && !new RegExp(CAKE_TAG).test(businessCategories)
    && category.split("|").every(item => item.includes("糕饼店") || shoppingType.test(item));
  const resolvedConflict = businessSnack && ((genericCatering && !nonTargetCategory && !cake) || cakeWithRetailProof);
  const namedRetailBranch = businessSnack && category !== ""
    && category.split("|").every(item => shoppingType.test(item))
    && !new RegExp(SOFT_UNRELATED_NAME).test(primary)
    && new RegExp(brandBareBranchPattern(brand)).test(normalized_name);
  const locationBranch = normalized_name.match(/^([^()]+)\(([^()]+)\)$/);
  const namedRetailLocation = retail && category !== ""
    && category.split("|").every(item => shoppingType.test(item))
    && locationBranch && new RegExp(brandLocationPrimaryPattern(brand)).test(locationBranch[1])
    && !new RegExp(LOCATION_BRANCH_BLOCK).test(locationBranch[2]);
  const strictName = new RegExp(brandNamePattern(brand)).test(normalized_name);
  const chainBranch = /(?:\([^()]+店\)|[-－][^()]+店|店)$/.test(normalized_name);
  const genericLifeCategory = category === "生活服务;生活服务场所;生活服务场所" && codes.includes("070000");
  const retailDescriptor = /品牌零食|零食乐园|量贩零食|省钱超市|批发超市|零食店|零食超市|硬折扣超市/.test(primary);
  const namedChain = strictName && chainBranch && !new RegExp(SOFT_UNRELATED_NAME).test(primary)
    && !new RegExp(CAKE_TAG).test(businessCategories)
    && (!nonTargetCategory || (category.includes("中餐厅") && businessSnack))
    && (businessSnack || retail || retailDescriptor || genericLifeCategory);
  const clearRetail = [row.tag, business.tag, business.rectag, business.keytag, category]
    .some(value => String(value ?? "").split(/[;,|]/).some(label => new RegExp(`^(?:${CLEAR_RETAIL_LABEL})$`).test(label.trim())));
  const snackNamed = clearRetail && new RegExp(brandSnackNamePattern(brand)).test(normalized_name)
    && !new RegExp(`${SOFT_UNRELATED_NAME}|${LOCATION_BRANCH_BLOCK}`).test(primary)
    && !new RegExp(CAKE_TAG).test(businessCategories)
    && !new RegExp(LOCATION_BRANCH_BLOCK).test(normalized_name.slice(primary.length));
  const identities = BRAND_IDENTITIES[brand] || [brand];
  const otherShopLandmark = !identities.some(name => primary.includes(name))
    && identities.some(name => normalized_name.includes(name)) && new RegExp(OTHER_SHOP_TAG).test(tags);
  const relatedName = (strictName || new RegExp(brandSnackNamePattern(brand)).test(normalized_name) || new RegExp(brandRelatedNamePattern(brand)).test(normalized_name))
    && !/\(\s*店\)/.test(normalized_name)
    && !new RegExp(`${SOFT_UNRELATED_NAME}|${LOCATION_BRANCH_BLOCK}|${AMBIGUOUS_STORE_NAME}`).test(primary)
    && !new RegExp(LOCATION_BRANCH_BLOCK).test(normalized_name.slice(primary.length))
    && !Object.entries(BRAND_IDENTITIES).some(([other, names]) => other !== brand && names.some(name => primary.includes(name)));
  const relatedEvidence = new RegExp(RELATED_STORE_TAG).test(tags) || codes.some(c => /^(05|06)\d{4}$/.test(c));
  const extremeEvidence = new RegExp(EXTREME_STORE_TAG).test(tags);
  const missingEvidence = !tags.replace(/;/g, "").trim() && !codes.some(c => /^\d{6}$/.test(c));
  const hxlUnknownSuffix = brand === "好想来" && primary.includes("好想来")
    && (!new RegExp(HXL_PRIMARY_PATTERN).test(primary.slice(primary.indexOf("好想来")).trim()) || new RegExp(HXL_REVIEW_NAME).test(primary.slice(primary.indexOf("好想来")+3)));
  // User-approved HXL relaxation: retail prefixes and unusual branch layout do
  // not require a format whitelist. The brand must be in the primary name,
  // never merely a parenthesized landmark of another business.
  const hxlRetailName = brand === "好想来" && primary.includes("好想来")
    && !/\(\s*(店)?\)/.test(normalized_name)
    && !new RegExp(`${SOFT_UNRELATED_NAME}|${LOCATION_BRANCH_BLOCK}|${HXL_REVIEW_NAME}`).test(primary)
    && !Object.entries(BRAND_IDENTITIES).some(([other,names]) => other !== brand && names.some(name => primary.includes(name)))
    && !(normalized_name.includes(")") && new RegExp(`${UNRELATED_NAME}|${EXPLICIT_UNRELATED}`).test(normalized_name.slice(normalized_name.lastIndexOf(")")+1)));
  const hxlRetailEvidence = new RegExp(RELATED_STORE_TAG).test(exclusionLabels)
    && !extremeEvidence && !conflictingRelatedTags(tags, businessCategories);
  let decision: "接受" | "排除" | "待核实" = "待核实", decision_reason: string;
  if (poi_id && override === "exclude") { decision = "排除"; decision_reason = POLICY_REASONS.blacklist; }
  else if (new RegExp(INACTIVE_STATUS).test(sourceName)) { decision = "排除"; decision_reason = POLICY_REASONS.inactive; }
  else if (new RegExp(WAREHOUSE_BRANCH).test(normalized_name)) { decision = "排除"; decision_reason = POLICY_REASONS.warehouse; }
  else if (new RegExp(`${UNRELATED_NAME}|${EXPLICIT_UNRELATED}`).test(primary) || otherShopLandmark || new RegExp(NON_STORE_BRANCH).test(normalized_name) || new RegExp(NON_STORE_TAIL).test(sourceName)) { decision = "排除"; decision_reason = POLICY_REASONS.unrelated; }
  else if ((brand === "爱零食" && new RegExp(SIMILAR_NAME).test(primary)) || (brand === "好想来" && /^好像来/.test(normalized_name))) { decision = "排除"; decision_reason = POLICY_REASONS.similar; }
  else if (brand === "好想来" && new RegExp(HXL_NON_BRAND_NAME).test(primary)) { decision = "排除"; decision_reason = POLICY_REASONS.hxlNonBrand; }
  else if (new RegExp(EXCLUDED_STORE_LABEL.replaceAll("[[:space:]]", "\\s")).test(exclusionLabels)) { decision = "排除"; decision_reason = POLICY_REASONS.excludedLabel; }
  else if (relatedName && extremeEvidence) decision_reason = POLICY_REASONS.extreme;
  else if (new RegExp(HARD_NON_RETAIL_TAG).test(tags)) { decision = "排除"; decision_reason = POLICY_REASONS.hardCategory; }
  else if (cake && !snackEvidence) { decision = "排除"; decision_reason = POLICY_REASONS.cake; }
  else if (nonTargetCategory && !snackEvidence) { decision = "排除"; decision_reason = POLICY_REASONS.category; }
  else if (!poi_id) decision_reason = POLICY_REASONS.noId;
  else if (override !== "accept" && brand === "零食有鸣" && new RegExp(REVIEW_CONVENIENCE).test(normalized_name)) decision_reason = POLICY_REASONS.convenience;
  else if (missingEvidence) decision_reason = POLICY_REASONS.missing;
  else if (override !== "accept" && hxlUnknownSuffix) decision_reason = POLICY_REASONS.hxlSuffix;
  else if (hxlRetailName && hxlRetailEvidence) { decision = "接受"; decision_reason = POLICY_REASONS.related; }
  else if (relatedName && relatedEvidence && !conflictingRelatedTags(tags, businessCategories)) { decision = "接受"; decision_reason = POLICY_REASONS.related; }
  else if (snackNamed) { decision = "接受"; decision_reason = POLICY_REASONS.accepted; }
  else if (override !== "accept" && !strictName && !namedRetailBranch && !namedRetailLocation) decision_reason = POLICY_REASONS.name;
  else if (namedChain) { decision = "接受"; decision_reason = POLICY_REASONS.chain; }
  else if (conflict && !resolvedConflict) decision_reason = POLICY_REASONS.conflict;
  else if (!retail) decision_reason = POLICY_REASONS.tags;
  else { decision = "接受"; decision_reason = override === "accept" ? POLICY_REASONS.manual : POLICY_REASONS.accepted; }
  return { original_name, normalized_name, poi_id, decision, decision_reason };
}

function conflictingRelatedTags(tags: string, businessTags: string) {
  // Broad catering/shopping is allowed, but it cannot erase a concrete cake,
  // company, lodging or school label without the existing explicit snack proof.
  return new RegExp(`${CAKE_TAG}|${NON_TARGET_CATEGORY_TAG}|住宿|医疗|公司|科教|商务住宅`).test(tags)
    && !( /(^|[;,])零食([;,]|$)/.test(businessTags) && !new RegExp(CAKE_TAG).test(businessTags));
}
