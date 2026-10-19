import assert from "node:assert/strict";
import test from "node:test";
import {buildStoreSearchPlan,scoreUnverifiedInputTip,searchStoreCandidates} from "../server/store-search.js";

const input="零食很忙湖北襄阳园林小区店",address="襄阳市襄州区古城街道建安小区(卉木林巷)";
const tip={id:"B0M1A9HM30",name:"零食很忙(湖北襄阳园林小区店)",district:"湖北省襄阳市襄州区",address:"卉木林巷园林小区",location:"112.220439,32.098094",typecode:"061200"};

test("目标连锁输入提示的详情为空时仍保留相同 ID 与明确未核实证据",async()=>{
 const rows=await searchStoreCandidates(async(path)=>path==="/v3/assistant/inputtips"?{tips:[tip]}:{pois:[]},input,"襄阳市");
 const row=rows.find(row=>row.id===tip.id);assert.ok(row);assert.equal(row.auto_confirm,false);assert.equal(row.requires_review,true);assert.equal(row.source,"inputtips");assert.match(row.warnings.join(),/详情.*未返回|详情.*为空/);assert.equal(row.evidence?.verification,"unverified");assert.equal(row.evidence?.endpoint,"/v3/assistant/inputtips");assert.ok(Number.isFinite(Date.parse(row.evidence?.queried_at||"")));
});

test("地址-only 搜索发现目标连锁提示也核对详情并标记人工确认",async()=>{
 const calls:string[]=[];const rows=await searchStoreCandidates(async(path)=>{calls.push(path);return path==="/v3/assistant/inputtips"?{tips:[tip]}:{pois:[]}},"","襄阳市","",address);
 assert.ok(calls.includes("/v5/place/detail"));const row=rows.find(row=>row.id===tip.id);assert.ok(row);assert.equal(row.requires_review,true);assert.equal(row.auto_confirm,false);assert.equal(row.evidence?.verification,"unverified");
});

test("详情返回不同 ID 不能沿用输入提示原 ID，硬无关类型也不保留",async()=>{
 for(const detail of [{...tip,id:"B0OTHER001",type:"购物服务;零食店"},{...tip,type:"生活服务;洗浴推拿场所;足疗按摩"},{...tip,name:"普通面馆",type:"餐饮服务;面馆"}]){
  const rows=await searchStoreCandidates(async(path)=>path==="/v3/assistant/inputtips"?{tips:[tip]}:path==="/v5/place/detail"?{pois:[detail]}:{pois:[]},input,"襄阳市");assert.equal(rows.some(row=>row.id===tip.id),false);
 }
});

test("详情因预算未执行时可保留提示，但不能声称详情已查空",async()=>{
 let details=0;const rows=await searchStoreCandidates(async(path)=>{if(path==="/v5/place/detail")details++;return path==="/v3/assistant/inputtips"?{tips:[tip]}:{pois:[]}},input,"襄阳市","",address,6);
 const row=rows.find(row=>row.id===tip.id);assert.ok(row);assert.equal(details,0);assert.equal(row.auto_confirm,false);assert.match(row.warnings.join(),/详情未执行/);assert.doesNotMatch(row.evidence?.reason||"",/未返回|为空/);assert.equal(rows.diagnostics.budget_exhausted,true);
});

test("详情接口失败时保留待人工确认提示并保留失败诊断",async()=>{
 const rows=await searchStoreCandidates(async(path)=>{if(path==="/v5/place/detail")throw new Error("provider unavailable");return path==="/v3/assistant/inputtips"?{tips:[tip]}:{pois:[]}},input,"襄阳市");
 const row=rows.find(row=>row.id===tip.id);assert.ok(row);assert.equal(row.auto_confirm,false);assert.match(row.evidence?.reason||"",/失败|未完成/);assert.ok(rows.diagnostics.failed_stages.includes("提示门店详情"));
});

test("不把无坐标、无真实 ID 或其他品牌提示当作目标链条候选",async()=>{
 const rows=await searchStoreCandidates(async(path)=>path==="/v3/assistant/inputtips"?{tips:[{...tip,id:[]},{...tip,location:[]},{...tip,name:"好想来(园林小区店)"}]}:{pois:[]},input,"襄阳市");assert.equal(rows.length,0);
});

test("统一提示证据函数只使用原始省市，缺地区时不以搜索省市补造",()=>{
 const plan=buildStoreSearchPlan(input,"武汉市"),warning="详情未返回，待人工核实",at="2026-10-19T10:00:00.000Z";
 assert.equal(scoreUnverifiedInputTip({...tip,district:[]},plan,input,warning,at),null);
 const row=scoreUnverifiedInputTip({...tip,id:tip.id.toLowerCase()},plan,input,warning,at);assert.ok(row);assert.equal(row.id,tip.id);assert.equal(row.province,"湖北省");assert.equal(row.city,"襄阳市");assert.ok(row.conflicts.some(value=>value.includes("城市冲突")));assert.equal(row.evidence?.queried_at,at);assert.equal(row.auto_confirm,false);
});

test("泛餐饮分类仍需人工确认，硬无关分类和无效位置不作为提示证据",()=>{
 const plan=buildStoreSearchPlan(input,"襄阳市"),warning="详情核验未完成";
 const dining=scoreUnverifiedInputTip({...tip,type:"餐饮服务;餐饮相关场所"},plan,input,warning);assert.ok(dining);assert.equal(dining.auto_confirm,false);assert.equal(dining.requires_review,true);
 for(const raw of [{...tip,type:"医疗保健服务;中医馆"},{...tip,location:"0,0"},{...tip,location:"200,32"},{...tip,name:"好想来(园林小区店)"}])assert.equal(scoreUnverifiedInputTip(raw,plan,input,warning),null);
});

test("无分类文字时仍按有效类别码排除医疗住宿公司，只放宽餐饮购物及泛生活",()=>{
 const plan=buildStoreSearchPlan(input,"襄阳市"),warning="详情未返回";
 for(const typecode of ["090000","100000","170000","071200","061200|090000"])assert.equal(scoreUnverifiedInputTip({...tip,typecode},plan,input,warning),null,typecode);
 for(const typecode of ["050000","061200","070000"])assert.ok(scoreUnverifiedInputTip({...tip,typecode},plan,input,warning),typecode);
});

test("品牌主体的按摩后缀被排除，括号分店地标不作为无关业态证据",()=>{
 const plan=buildStoreSearchPlan("好想来园林小区店","襄阳市"),warning="详情未返回";
 assert.equal(scoreUnverifiedInputTip({...tip,name:"好想来按摩"},plan,plan.original,warning),null);
 assert.ok(scoreUnverifiedInputTip({...tip,name:"好想来(按摩街店)"},plan,plan.original,warning));
});
