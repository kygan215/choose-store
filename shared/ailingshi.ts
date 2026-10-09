export type AilingshiDecision = "接受" | "排除" | "待核实";
export type AilingshiOverride = "accept" | "exclude" | "";

// Keep the original name for display. Do not strip arbitrary suffixes or spaces.
export function normalizeAilingshiName(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim()
    .replace(/[。]/g, ".").replace(/[、]/g, ",").replace(/[•∙・]/g, "·");
}

export const AILINGSHI_SIMILAR = "^(爱零食的喵|我爱零食|最爱零食|爱零食小屋)";
export const AILINGSHI_OTHER_FORMAT = "硬折扣超市|超市|便利店|蛋糕|糕饼|西饼";
export const AILINGSHI_ACCEPTED = "^(爱零食|爱零食(量贩零食|量贩零食店)?\\((?!\\s*店\\))[^()]+店\\))$";
export const AILINGSHI_REASONS = {
  manualAccept: "按 POI ID 人工加入白名单",
  manualExclude: "按 POI ID 人工加入黑名单",
  similar: "相似品牌或普通店名，不按爱零食品牌收录",
  format: "统计范围排除：超市、便利店或蛋糕等其他业态，不代表否认品牌归属",
  accepted: "完整名称符合已确认结构，仅通过名称初筛，未验证品牌归属",
  pending: "名称不符合已确认结构，需人工核实",
  noId: "缺少 POI ID，需补充后人工核实",
} as const;

export function assessAilingshi(name: unknown, poiId: unknown, override: AilingshiOverride = "") {
  const original_name = String(name ?? ""), normalized_name = normalizeAilingshiName(name);
  const poi_id = String(poiId ?? "").trim();
  let decision: AilingshiDecision, decision_reason: string;
  if (poi_id && override === "exclude") { decision = "排除"; decision_reason = AILINGSHI_REASONS.manualExclude; }
  else if (poi_id && override === "accept") { decision = "接受"; decision_reason = AILINGSHI_REASONS.manualAccept; }
  else if (new RegExp(AILINGSHI_SIMILAR).test(normalized_name)) { decision = "排除"; decision_reason = AILINGSHI_REASONS.similar; }
  else if (new RegExp(AILINGSHI_OTHER_FORMAT).test(normalized_name)) { decision = "排除"; decision_reason = AILINGSHI_REASONS.format; }
  else if (!poi_id) { decision = "待核实"; decision_reason = AILINGSHI_REASONS.noId; }
  else if (new RegExp(AILINGSHI_ACCEPTED).test(normalized_name)) { decision = "接受"; decision_reason = AILINGSHI_REASONS.accepted; }
  else { decision = "待核实"; decision_reason = AILINGSHI_REASONS.pending; }
  return { original_name, normalized_name, poi_id, decision, decision_reason };
}
