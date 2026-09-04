export type AggregateCircle = {
  radius: number;
  total: number;
  counts: Record<string, number>;
};

export type AggregateStore = {
  label: string;
  circles: AggregateCircle[];
  environment_proxies?: Record<string, unknown>;
};

export type AiProfileResult = {
  report_title: string;
  summary: string;
  primary_users: string[];
  age_segments: Array<{ label: string; estimated_share: string; rationale: string }>;
  consumption_power: { level: string; score: number; rationale: string };
  radius_insights: string[];
  evidence: string[];
  confidence: { level: string; score: number; rationale: string };
  limitations: string[];
  parent_child_activity?: {
    fit_level: string; fit_score: number; audience_level: string; audience_score: number;
    core_child_age: string; touch_scenes: string[]; evidence: string[];
  };
  activity_plan?: { theme: string; format_steps: string[]; suggested_timing: string; resources_notes: string[] };
};

type DeepSeekOptions = {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  scope: "single" | "comparison";
  stores: AggregateStore[];
  activityConfig?: Record<string,string>;
  ruleMetrics?: Record<string,unknown>;
};

export const CHILDREN_DRINK_PRODUCT_CONTEXT = "本项目产品是儿童健康饮品，业务方提供的产品卖点为清热下火、口感好喝；核心活动触达人群是妈妈带孩子家庭。";
export const LEGACY_PROMPT_VERSION = "children-drink-audience-v2";
export const ACTIVITY_PROMPT_VERSION = "parent-child-drink-activity-v4";

function normalizeResult(value: unknown,stores:AggregateStore[]): AiProfileResult | null {
  if (!value || typeof value !== "object") return null;
  const row=value as Record<string,unknown>,strings=(item:unknown)=>Array.isArray(item)?item.map(String).filter(Boolean):[],consumption=(row.consumption_power&&typeof row.consumption_power==="object"?row.consumption_power:{}) as Record<string,unknown>,confidence=(row.confidence&&typeof row.confidence==="object"?row.confidence:{}) as Record<string,unknown>;
  if(typeof row.summary!=="string"||!row.summary.trim())return null;
  const segments=Array.isArray(row.age_segments)?row.age_segments.map(item=>{const segment=(item&&typeof item==="object"?item:{}) as Record<string,unknown>;return {label:String(segment.label||"潜在人群"),estimated_share:String(segment.estimated_share||"估算比例待校验"),rationale:String(segment.rationale||"基于聚合 POI 结构推断")}}):[];
  const circleFallback=stores.flatMap(store=>store.circles.map(circle=>`${store.label} ${circle.radius}米圈共 ${circle.total} 个 POI，主要分类为 ${Object.entries(circle.counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,count])=>`${name}${count}个`).join("、")||"暂无有效样本"}`));
  const parent=(row.parent_child_activity&&typeof row.parent_child_activity==="object"?row.parent_child_activity:{}) as Record<string,unknown>,plan=(row.activity_plan&&typeof row.activity_plan==="object"?row.activity_plan:{}) as Record<string,unknown>;
  return {report_title:String(row.report_title||"AI 亲子活动人群分析"),summary:row.summary,primary_users:strings(row.primary_users).length?strings(row.primary_users):segments.slice(0,3).map(item=>item.label),age_segments:segments,consumption_power:{level:String(consumption.level||"无法可靠判断"),score:Math.max(0,Math.min(100,Number(consumption.score)||0)),rationale:String(consumption.rationale||"样本不足")},radius_insights:strings(row.radius_insights).length?strings(row.radius_insights):circleFallback,evidence:strings(row.evidence).length?strings(row.evidence):circleFallback,confidence:{level:String(confidence.level||"低"),score:Math.max(0,Math.min(100,Number(confidence.score)||0)),rationale:String(confidence.rationale||"仅依据聚合 POI 代理推断")},limitations:strings(row.limitations).length?strings(row.limitations):["结论仅由聚合 POI 设施结构推断，不是人口、收入、客流或订单统计。"],parent_child_activity:{fit_level:String(parent.fit_level||"偏低"),fit_score:Math.max(0,Math.min(100,Number(parent.fit_score)||0)),audience_level:String(parent.audience_level||"偏低"),audience_score:Math.max(0,Math.min(100,Number(parent.audience_score)||0)),core_child_age:String(parent.core_child_age||"暂无明确儿童年龄证据"),touch_scenes:strings(parent.touch_scenes),evidence:strings(parent.evidence)},activity_plan:{theme:String(plan.theme||"待补充活动信息"),format_steps:strings(plan.format_steps),suggested_timing:String(plan.suggested_timing||"待结合活动时间确认"),resources_notes:strings(plan.resources_notes)}};
}

export function buildAudiencePrompt(scope: "single" | "comparison", stores: AggregateStore[]) {
  const task = scope === "single"
    ? "分析一个门店周边的潜在人群画像"
    : "横向比较多个匿名门店周边的潜在人群画像，指出差异";
  return `你是一名严谨的儿童健康饮品活动研究与商业地理分析师。${CHILDREN_DRINK_PRODUCT_CONTEXT}请${task}，用于活动前筛选，不用于开店选址。\n
输入只包含匿名门店在不同半径内的聚合 POI 数量，不包含门店名称、地址、坐标和真实人口数据。\n
要求：\n
1. 只分析潜在人群、动态年龄段、消费环境和圈层差异；禁止判断是否适合开店。不得把产品写成零食，不得扩展为治疗、治愈、预防疾病等医疗承诺。\n
2. 正文 summary 使用专业研究报告风格，约 300 个中文字符。\n
3. 年龄和比例都只能是估算，estimated_share 必须包含“估算”二字，不得伪装成人口统计。\n
4. evidence 必须引用输入中的半径、分类和数量；confidence 必须说明可信度依据。\n
5. 多店比较只能使用匿名标签（例如门店A），不得推测真实地点。\n
6. 只返回一个 JSON 对象，不要 Markdown。字段必须为：report_title、summary、primary_users、age_segments[{label,estimated_share,rationale}]、consumption_power{level,score,rationale}、radius_insights、evidence、confidence{level,score,rationale}、limitations。score 为 0-100 整数。\n
聚合数据：${JSON.stringify({ scope, stores })}`;
}

export function buildActivityPrompt(stores:AggregateStore[],activityConfig:Record<string,string>,ruleMetrics:Record<string,unknown>){
  return `你是一名严谨的儿童健康饮品活动策划与商业地理分析师。${CHILDREN_DRINK_PRODUCT_CONTEXT}请为活动前门店筛选生成“儿童健康饮品亲子活动分析”。核心目标人群是妈妈带孩子，核心儿童年龄为3–12岁，中学12–15岁只作补充。\n
严禁判断门店是否适合开店，也不得给选址结论。输入只有匿名门店的聚合POI、活动配置和系统确定的规则分，不是人口、收入、客流、订单或会员事实。\n
规则分由系统计算，你必须原样返回，不得修改：${JSON.stringify(ruleMetrics)}。\n
要求：summary为150–300个中文字符，说明亲子客群、儿童年龄、住宅活跃度、消费环境、渠道竞争、儿童健康饮品触达场景及数据限制；证据重点引用住宅小区、幼儿园、小学、中学、公园、购物中心和周边折扣零食渠道门店的数量与距离。周边零食渠道只是活动承载与渠道竞争环境，不等同于儿童饮品产品竞品。住宅活跃度不是入住率，消费环境不是房价、租金、收入或真实客单价；严禁编造这些数值。\n
活动方案只能围绕儿童健康饮品形成执行框架，可使用亲子品饮、儿童饮品试饮、产品信息讲解、亲子互动与家庭反馈收集等形式。禁止写“零食试吃”“散装试吃”“零食试吃区”或把产品称为零食。可以原样使用“清热下火、口感好喝”这两个业务卖点，但必须明确它们是业务方提供的产品表达，不得扩展为药品疗效、治疗、治愈或疾病预防承诺。没有预算、赠品、SKU或折扣数据时明确写“未提供”，不得编造具体商品、折扣、销量或销售预测。\n
只返回合法JSON，字段：report_title、summary、primary_users、age_segments[{label,estimated_share,rationale}]、consumption_power{level,score,rationale}、radius_insights、evidence、confidence{level,score,rationale}、limitations、parent_child_activity{fit_level,fit_score,audience_level,audience_score,core_child_age,touch_scenes,evidence}、activity_plan{theme,format_steps,suggested_timing,resources_notes}。estimated_share必须含“估算”。\n
活动配置：${JSON.stringify(activityConfig)}\n聚合POI：${JSON.stringify(stores)}`;
}

export async function callDeepSeek(options: DeepSeekOptions) {
  const endpoint = `${options.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  let lastError = "DeepSeek 返回为空";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: "严格依据用户提供的聚合数据完成研究报告，并严格输出合法 JSON。" },
            { role: "user", content: options.scope==="single"&&options.activityConfig&&options.ruleMetrics?buildActivityPrompt(options.stores,options.activityConfig,options.ruleMetrics):buildAudiencePrompt(options.scope, options.stores) },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          temperature: 0.2,
          max_tokens: 2400,
        }),
      });
      const raw = await response.text();
      if (!response.ok) {
        let message = `DeepSeek 服务返回 ${response.status}`;
        try { message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message || message; } catch {}
        lastError = message;
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
          continue;
        }
        throw new Error(message);
      }
      const envelope = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      const content = envelope.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek 返回了空内容");
      const result = normalizeResult(JSON.parse(content) as unknown,options.stores);
      if (!result) throw new Error("DeepSeek 返回的画像结构不完整");
      return { result, usage: envelope.usage || {}, promptVersion: options.scope==="single"&&options.activityConfig?ACTIVITY_PROMPT_VERSION:LEGACY_PROMPT_VERSION };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "DeepSeek 请求失败";
      if (attempt < 2 && /空内容|JSON|结构不完整/.test(lastError)) continue;
      if (attempt >= 2 || !/空内容|JSON|结构不完整/.test(lastError)) throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}
