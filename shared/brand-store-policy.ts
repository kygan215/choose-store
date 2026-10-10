import { normalizeAilingshiName, type AilingshiOverride } from "./ailingshi.js";

// Brand identities come from the selected catalog and official brand sites.
// Full-name patterns below are our screening policy, not official certification.
export const BRAND_IDENTITIES: Record<string, string[]> = {
  "吖嘀吖嘀": ["吖嘀吖嘀"], "好想来": ["好想来", "好想来品牌零食", "好想来零食乐园"],
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
export const SIMILAR_NAME = "^(爱零食的喵|我爱零食|最爱零食|爱零食小屋)";
export const SOFT_UNRELATED_NAME = "台球|棋牌|游乐|洗衣|家纺|家具|烟花|文具|眼镜|培训|果业|喜铺|喜礼|婚品|拖鞋|直播|代买|代购|朱砂";
export const LOCATION_BRANCH_BLOCK = "暂停营业|装修中|停业|歇业|已关闭|仓库|仓$|客服|公司|总部|配送|办公|招商|面试";
export const INACTIVE_STATUS = "暂停营业|装修中|正在装修|停业|歇业|已关闭|未开业|即将开业|待开业|筹备中|施工中";
export const WAREHOUSE_BRANCH = "\\([^()]*(仓库|仓)\\)";
export const POLICY_REASONS = {
  blacklist: "按 POI ID 人工排除", unrelated: "名称主体明确为餐饮、足浴、生鲜、仓库等非目标业态",
  inactive: "标注暂停营业、装修中或未开业，非当前营业门店",
  warehouse: "名称明确为仓库，非营业门店",
  similar: "相似名称，不按目标品牌收录", cake: "分类或标签明确为蛋糕／烘焙等非目标业态",
  category: "高德具体分类或标签明确为餐饮、足浴、生鲜等非目标业态",
  hardCategory: "高德具体分类或标签明确为棋牌、垂钓、面馆、足浴或生鲜等非目标业态",
  noId: "缺少 POI ID，待核验", name: "名称未匹配品牌完整结构，待核验",
  conflict: "高德分类或标签证据冲突，待核验", tags: "缺少零食／超市／购物分类或标签证据，待核验",
  accepted: "品牌名称与零食／超市／购物证据通过初筛，未验证品牌归属",
  chain: "规范连锁门店名称通过初筛；高德分类或标签未证实，尚未核验品牌归属及营业状态",
  manual: "按 POI ID 人工确认名称，零食／超市／购物证据通过初筛",
} as const;
export const isPolicyBrand = (brand: string) => Object.hasOwn(BRAND_IDENTITIES, brand);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
export type BrandPolicyPoi = { name?: unknown; amap_name?: unknown; id?: unknown; amap_poi_id?: unknown; type?: unknown; poi_type?: unknown; typecode?: unknown; tag?: unknown; business?: unknown };
export function retailTags(row: BrandPolicyPoi) {
  const business = row.business && typeof row.business === "object" ? row.business as Record<string, unknown> : {};
  return [row.type ?? row.poi_type, row.tag, business.tag, business.rectag, business.keytag].map(v => String(v ?? "").trim()).join(";");
}
export function assessBrandStore(brand: string, row: BrandPolicyPoi, override: AilingshiOverride = "") {
  const original_name = String(row.name ?? row.amap_name ?? ""), normalized_name = normalizeAilingshiName(original_name);
  const poi_id = String(row.id ?? row.amap_poi_id ?? "").trim(), primary = normalized_name.split("(")[0];
  const tags = retailTags(row), codes = String(row.typecode ?? "").replace(/\s/g, "").split(/[|;,]/);
  const category = String(row.type ?? row.poi_type ?? "");
  const business = row.business && typeof row.business === "object" ? row.business as Record<string, unknown> : {};
  const businessSnack = [row.tag, business.tag, business.rectag, business.keytag]
    .some(value => String(value ?? "").split(/[;,]/).some(label => label.trim() === "零食"));
  const businessCategories = [row.tag, business.tag, business.rectag, business.keytag].map(value => String(value ?? "")).join(";");
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
  const namedRetailLocation = businessSnack && category !== ""
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
  let decision: "接受" | "排除" | "待核实" = "待核实", decision_reason: string;
  if (poi_id && override === "exclude") { decision = "排除"; decision_reason = POLICY_REASONS.blacklist; }
  else if (new RegExp(INACTIVE_STATUS).test(normalized_name)) { decision = "排除"; decision_reason = POLICY_REASONS.inactive; }
  else if (new RegExp(WAREHOUSE_BRANCH).test(normalized_name)) { decision = "排除"; decision_reason = POLICY_REASONS.warehouse; }
  else if (new RegExp(UNRELATED_NAME).test(primary)) { decision = "排除"; decision_reason = POLICY_REASONS.unrelated; }
  else if ((brand === "爱零食" && new RegExp(SIMILAR_NAME).test(normalized_name)) || (brand === "好想来" && /^好像来/.test(normalized_name))) { decision = "排除"; decision_reason = POLICY_REASONS.similar; }
  else if (new RegExp(HARD_NON_RETAIL_TAG).test(tags)) { decision = "排除"; decision_reason = POLICY_REASONS.hardCategory; }
  else if (cake && !snackEvidence) { decision = "排除"; decision_reason = POLICY_REASONS.cake; }
  else if (nonTargetCategory && !snackEvidence) { decision = "排除"; decision_reason = POLICY_REASONS.category; }
  else if (!poi_id) decision_reason = POLICY_REASONS.noId;
  else if (override !== "accept" && !strictName && !namedRetailBranch && !namedRetailLocation) decision_reason = POLICY_REASONS.name;
  else if (namedChain) { decision = "接受"; decision_reason = POLICY_REASONS.chain; }
  else if (conflict && !resolvedConflict) decision_reason = POLICY_REASONS.conflict;
  else if (!retail) decision_reason = POLICY_REASONS.tags;
  else { decision = "接受"; decision_reason = override === "accept" ? POLICY_REASONS.manual : POLICY_REASONS.accepted; }
  return { original_name, normalized_name, poi_id, decision, decision_reason };
}
