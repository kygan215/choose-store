import { createHash } from "node:crypto";
import type { AggregateStore, AiProfileResult } from "../app/api/deepseek.js";

export const ACTIVITY_PROMPT_VERSION = "parent-child-drink-activity-v4";
export const ACTIVITY_SCORE_VERSION = "parent-child-score-v2";

export type ActivityConfig = {
  activity_name: string;
  objective: string;
  activity_time: string;
  budget?: string;
  gifts?: string;
  allowed_formats?: string;
  notes?: string;
};

export const DEFAULT_ACTIVITY_CONFIG:ActivityConfig={
  activity_name:"门店亲子活动分析",
  objective:"识别妈妈带孩子家庭、活动触达场景与执行注意事项",
  activity_time:"按实际活动日期与门店营业时段安排",
  budget:"",gifts:"",allowed_formats:"亲子品饮、儿童饮品试饮、产品信息讲解、亲子互动、家庭反馈收集",notes:"",
};

export type ParentChildRuleMetrics = {
  activity_fit_score: number;
  activity_fit_level: string;
  audience_strength_score: number;
  audience_strength_level: string;
  core_child_age: string;
  evidence: string[];
};

const clean=(value:unknown)=>String(value??"").trim();
const clamp=(value:number)=>Math.max(0,Math.min(100,Math.round(value)));
const level=(score:number)=>score>=80?"突出":score>=60?"较高":score>=40?"一般":"偏低";

export function normalizeActivityConfig(value:unknown):ActivityConfig{
  const row=(value&&typeof value==="object"?value:{}) as Record<string,unknown>;
  return {activity_name:clean(row.activity_name),objective:clean(row.objective),activity_time:clean(row.activity_time),budget:clean(row.budget),gifts:clean(row.gifts),allowed_formats:clean(row.allowed_formats),notes:clean(row.notes)};
}

export function resolveActivityConfig(value:unknown):ActivityConfig{
  const input=normalizeActivityConfig(value);
  return {...DEFAULT_ACTIVITY_CONFIG,...input,activity_name:input.activity_name||DEFAULT_ACTIVITY_CONFIG.activity_name,objective:input.objective||DEFAULT_ACTIVITY_CONFIG.objective,activity_time:input.activity_time||DEFAULT_ACTIVITY_CONFIG.activity_time,allowed_formats:input.allowed_formats||DEFAULT_ACTIVITY_CONFIG.allowed_formats};
}

export function validateActivityConfig(value:unknown){
  const config=normalizeActivityConfig(value),errors:string[]=[];
  if(!config.activity_name)errors.push("活动名称不能为空");
  if(!config.objective)errors.push("活动目标不能为空");
  if(!config.activity_time)errors.push("活动时间不能为空");
  return {config,errors};
}

function maxCount(store:AggregateStore,category:string){return Math.max(0,...store.circles.map(circle=>Number(circle.counts[category]||0)))}

export function scoreParentChildActivity(store:AggregateStore):ParentChildRuleMetrics{
  const kindergarten=maxCount(store,"幼儿园"),primary=maxCount(store,"小学"),middle=maxCount(store,"中学"),residential=maxCount(store,"住宅小区"),parks=maxCount(store,"公园"),mall=maxCount(store,"购物中心"),retail=maxCount(store,"超市")+maxCount(store,"便利店"),transit=maxCount(store,"地铁站")+maxCount(store,"公交站");
  const childCore=Math.min(45,kindergarten*8+primary*9),familyBase=Math.min(25,residential*1.5),scene=Math.min(18,parks*5+mall*4+retail*0.8),access=Math.min(7,transit*1.2),supplement=Math.min(5,middle*2.5);
  const activityFit=clamp(childCore+familyBase+scene+access+supplement);
  const audienceStrength=clamp(Math.min(55,kindergarten*10+primary*11)+Math.min(30,residential*2)+Math.min(10,parks*3+mall*2)+Math.min(5,middle*2));
  const ages=kindergarten>0&&primary>0?"3–12岁":primary>0?"6–12岁":kindergarten>0?"3–6岁":middle>0?"12–15岁（补充）":"暂无明确儿童年龄证据";
  const evidence=[`幼儿园 ${kindergarten} 个、小学 ${primary} 个、中学 ${middle} 个`,`住宅小区 ${residential} 个、公园 ${parks} 个、购物中心 ${mall} 个`,`超市及便利店 ${retail} 个、公共交通站点 ${transit} 个`];
  return {activity_fit_score:activityFit,activity_fit_level:level(activityFit),audience_strength_score:audienceStrength,audience_strength_level:level(audienceStrength),core_child_age:ages,evidence};
}

function stable(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}

export function activityCacheKey(store:AggregateStore,config:ActivityConfig){
  return createHash("sha256").update(stable({store,config,prompt:ACTIVITY_PROMPT_VERSION,score:ACTIVITY_SCORE_VERSION})).digest("hex");
}

export function forceRuleMetrics(result:AiProfileResult,metrics:ParentChildRuleMetrics):AiProfileResult{
  return {...result,parent_child_activity:{...(result.parent_child_activity||{}),fit_level:metrics.activity_fit_level,fit_score:metrics.activity_fit_score,audience_level:metrics.audience_strength_level,audience_score:metrics.audience_strength_score,core_child_age:metrics.core_child_age,touch_scenes:result.parent_child_activity?.touch_scenes||[],evidence:metrics.evidence}};
}
