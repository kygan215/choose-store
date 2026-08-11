export type AggregateCircle = {
  radius: number;
  total: number;
  counts: Record<string, number>;
};

export type AggregateStore = {
  label: string;
  circles: AggregateCircle[];
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
};

type DeepSeekOptions = {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  scope: "single" | "comparison";
  stores: AggregateStore[];
};

const PROMPT_VERSION = "audience-profile-v1";

function normalizeResult(value: unknown,stores:AggregateStore[]): AiProfileResult | null {
  if (!value || typeof value !== "object") return null;
  const row=value as Record<string,unknown>,strings=(item:unknown)=>Array.isArray(item)?item.map(String).filter(Boolean):[],consumption=(row.consumption_power&&typeof row.consumption_power==="object"?row.consumption_power:{}) as Record<string,unknown>,confidence=(row.confidence&&typeof row.confidence==="object"?row.confidence:{}) as Record<string,unknown>;
  if(typeof row.summary!=="string"||!row.summary.trim())return null;
  const segments=Array.isArray(row.age_segments)?row.age_segments.map(item=>{const segment=(item&&typeof item==="object"?item:{}) as Record<string,unknown>;return {label:String(segment.label||"潜在人群"),estimated_share:String(segment.estimated_share||"估算比例待校验"),rationale:String(segment.rationale||"基于聚合 POI 结构推断")}}):[];
  const circleFallback=stores.flatMap(store=>store.circles.map(circle=>`${store.label} ${circle.radius}米圈共 ${circle.total} 个 POI，主要分类为 ${Object.entries(circle.counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,count])=>`${name}${count}个`).join("、")||"暂无有效样本"}`));
  return {report_title:String(row.report_title||"AI 潜在人群分析"),summary:row.summary,primary_users:strings(row.primary_users).length?strings(row.primary_users):segments.slice(0,3).map(item=>item.label),age_segments:segments,consumption_power:{level:String(consumption.level||"无法可靠判断"),score:Math.max(0,Math.min(100,Number(consumption.score)||0)),rationale:String(consumption.rationale||"样本不足")},radius_insights:strings(row.radius_insights).length?strings(row.radius_insights):circleFallback,evidence:strings(row.evidence).length?strings(row.evidence):circleFallback,confidence:{level:String(confidence.level||"低"),score:Math.max(0,Math.min(100,Number(confidence.score)||0)),rationale:String(confidence.rationale||"仅依据聚合 POI 代理推断")},limitations:strings(row.limitations).length?strings(row.limitations):["结论仅由聚合 POI 设施结构推断，不是人口、收入、客流或订单统计。"]};
}

function prompt(scope: "single" | "comparison", stores: AggregateStore[]) {
  const task = scope === "single"
    ? "分析一个门店周边的潜在人群画像"
    : "横向比较多个匿名门店周边的潜在人群画像，指出差异";
  return `你是一名严谨的商业地理与消费者研究分析师。请${task}。\n
输入只包含匿名门店在不同半径内的聚合 POI 数量，不包含门店名称、地址、坐标和真实人口数据。\n
要求：\n
1. 只分析潜在人群、动态年龄段、消费能力和圈层差异；禁止判断是否适合开店，禁止给商品、选品、营销或促销建议。\n
2. 正文 summary 使用专业研究报告风格，约 300 个中文字符。\n
3. 年龄和比例都只能是估算，estimated_share 必须包含“估算”二字，不得伪装成人口统计。\n
4. evidence 必须引用输入中的半径、分类和数量；confidence 必须说明可信度依据。\n
5. 多店比较只能使用匿名标签（例如门店A），不得推测真实地点。\n
6. 只返回一个 JSON 对象，不要 Markdown。字段必须为：report_title、summary、primary_users、age_segments[{label,estimated_share,rationale}]、consumption_power{level,score,rationale}、radius_insights、evidence、confidence{level,score,rationale}、limitations。score 为 0-100 整数。\n
聚合数据：${JSON.stringify({ scope, stores })}`;
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
            { role: "user", content: prompt(options.scope, options.stores) },
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
      return { result, usage: envelope.usage || {}, promptVersion: PROMPT_VERSION };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "DeepSeek 请求失败";
      if (attempt < 2 && /空内容|JSON|结构不完整/.test(lastError)) continue;
      if (attempt >= 2 || !/空内容|JSON|结构不完整/.test(lastError)) throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}
