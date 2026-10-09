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
export const RETAIL_SUFFIX = "零食|零食店|量贩零食|量贩零食店|零食量贩|零食量贩店|零食专卖店|休闲食品|超市|批发超市|硬折扣超市|省钱超市|便利店|量贩便利店";
export const UNRELATED_NAME = "蛋糕|糕饼|西饼|酱卤|卤味|卤菜|熟食|餐厅|餐馆|饭店|小吃|快餐|火锅|烧烤|麻辣烫|炸鸡|汉堡|奶茶|咖啡|面馆|浇面|米粉|足道|足疗|足浴|按摩|推拿|生鲜超市|酒店|宾馆|药房|药店|服装|理发|美容|公司$|仓库|配送中心|仓配中心|供应链中心|办事处|甜品|烘焙|民宿|公寓$|外卖柜|网吧|KTV|停车场|充电站|动物医院|物流基地|面试中心|菜鸟驿站";
export const RETAIL_TAG = "零食|超市|购物";
export const CAKE_TAG = "蛋糕|糕饼|西饼|烘焙|甜品";
// Concrete non-target POI labels override broad shopping evidence. Generic major
// categories stay reviewable because Amap can misclassify genuine brand stores.
export const NON_TARGET_CATEGORY_TAG = "中餐厅|西餐厅|快餐厅|小吃店|面馆|粉面店|火锅店|烧烤店|奶茶店|咖啡厅|茶馆|洗浴|足疗|足道|足浴|按摩|推拿|养生馆|美容院|美发店|理发店|药店|药房|生鲜超市|生鲜店|生鲜市场|农贸市场|菜市场|水果店|蔬菜店|酒店|宾馆|民宿|仓库|物流";
export const CONFLICT_TAG = "餐饮|住宿|医疗|公司企业|交通设施|科教文化|商务住宅";
export const SIMILAR_NAME = "^(爱零食的喵|我爱零食|最爱零食|爱零食小屋)";
export const POLICY_REASONS = {
  blacklist: "按 POI ID 人工排除", unrelated: "名称主体明确为餐饮、足浴、生鲜、仓库等非目标业态",
  similar: "相似名称，不按目标品牌收录", cake: "分类或标签明确为蛋糕／烘焙等非目标业态",
  category: "高德具体分类或标签明确为餐饮、足浴、生鲜等非目标业态",
  noId: "缺少 POI ID，待核验", name: "名称未匹配品牌完整结构，待核验",
  conflict: "购物与其他业态证据冲突，待核验", tags: "缺少零食／超市／购物分类或标签证据，待核验",
  accepted: "品牌名称与零食／超市／购物证据通过初筛，未验证品牌归属",
  manual: "按 POI ID 人工确认名称，零食／超市／购物证据通过初筛",
} as const;
export const isPolicyBrand = (brand: string) => Object.hasOwn(BRAND_IDENTITIES, brand);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function brandNamePattern(brand: string) {
  const names = BRAND_IDENTITIES[brand] || [brand];
  return `^(${names.map(escapeRegex).join("|")})(${RETAIL_SUFFIX})?(\\((?!\\s*店\\))[^()]+店\\))?$`;
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
  const retail = new RegExp(RETAIL_TAG).test(tags) || codes.some(c => /^06\d{4}$/.test(c));
  const snackEvidence = /零食/.test(tags);
  const cake = new RegExp(CAKE_TAG).test(tags);
  const nonTargetCategory = new RegExp(NON_TARGET_CATEGORY_TAG).test(tags);
  const conflict = cake || nonTargetCategory || new RegExp(CONFLICT_TAG).test(tags) || codes.some(c => /^\d{6}$/.test(c) && !/^(06\d{4}|070000)$/.test(c));
  let decision: "接受" | "排除" | "待核实" = "待核实", decision_reason: string;
  if (poi_id && override === "exclude") { decision = "排除"; decision_reason = POLICY_REASONS.blacklist; }
  else if (new RegExp(UNRELATED_NAME).test(primary)) { decision = "排除"; decision_reason = POLICY_REASONS.unrelated; }
  else if (brand === "爱零食" && override !== "accept" && new RegExp(SIMILAR_NAME).test(normalized_name)) { decision = "排除"; decision_reason = POLICY_REASONS.similar; }
  else if (cake && !snackEvidence) { decision = "排除"; decision_reason = POLICY_REASONS.cake; }
  else if (nonTargetCategory && !snackEvidence) { decision = "排除"; decision_reason = POLICY_REASONS.category; }
  else if (!poi_id) decision_reason = POLICY_REASONS.noId;
  else if (override !== "accept" && !new RegExp(brandNamePattern(brand)).test(normalized_name)) decision_reason = POLICY_REASONS.name;
  else if (conflict) decision_reason = POLICY_REASONS.conflict;
  else if (!retail) decision_reason = POLICY_REASONS.tags;
  else { decision = "接受"; decision_reason = override === "accept" ? POLICY_REASONS.manual : POLICY_REASONS.accepted; }
  return { original_name, normalized_name, poi_id, decision, decision_reason };
}
