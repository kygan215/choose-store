import assert from "node:assert/strict";
import test from "node:test";
import {processDiscoveryJob} from "../server/brand-library.js";
import {discoveryRequestKey,discoveryScopesOverlap} from "../server/discovery-state.js";
import {discoveryRows,saveDiscoveryBatchSql} from "../server/discovery-save.js";
import {nextWeeklyRefresh,validateRefreshSchedule} from "../server/refresh-time.js";
import {DEFAULT_SNACK_BRANDS,isRetiredSnackBrand} from "../server/snack-brands.js";
import {historyPreviewRow,validateExactHistoryLinks} from "../server/history-matching.js";
import {discoverBrandStores} from "../server/store-search.js";

test("全国或省市交叉查询同一品牌会冲突，不同品牌和互不相交城市可并存",()=>{
 const a={province:"全国",brands_json:["零食有鸣"]};assert.ok(discoveryScopesOverlap(a,{province:"湖北省",brands:["零食有鸣"],cities:["武汉市"]}));assert.ok(!discoveryScopesOverlap(a,{province:"全国",brands:["糖巢"]}));
 assert.ok(!discoveryScopesOverlap({province:"湖北省",cities:["武汉市"],brands:["糖巢"]},{province:"湖北省",cities:["宜昌市"],brands:["糖巢"]}));assert.ok(discoveryScopesOverlap({province:"湖北省",cities:[],brands:["糖巢"]},{province:"湖北省",cities:["宜昌市"],brands:["糖巢"]}));
});
test("继续强制刷新时跳过已完成城市，复用未完成城市已保存的分页",async()=>{
 const record={id:1,tenant_id:1,created_by:1,province:"湖北省",cities_json:["武汉市","宜昌市"],brands_json:["零食有鸣"],force_refresh:true,control:"run",status:"等待继续",api_calls:4,region_plan_json:[{province:"湖北省",city:"武汉市"},{province:"湖北省",city:"宜昌市"}]};
 const params={keywords:"零食有鸣",page_num:1},calls:string[]=[],saved:string[]=[],fresh:string[]=[],updates:Array<{sql:string;values:unknown[]}>=[];
 await processDiscoveryJob(1,1,1,{query:async(sql,values=[])=>{updates.push({sql,values});return {rows:sql.startsWith("SELECT * FROM brand_discovery_jobs")?[record]:sql.startsWith("SELECT province,city,brand,status")?[{province:"湖北省",city:"武汉市",brand:"零食有鸣",status:"complete"},{province:"湖北省",city:"宜昌市",brand:"零食有鸣",status:"running"}]:sql.startsWith("SELECT request_key,response_json")?[{request_key:discoveryRequestKey("/v5/place/text",params),response_json:{pois:[]}}]:sql.startsWith("SELECT COUNT(*)")?[{count:0}]:[]}},consumeBackgroundQuota:async()=>({used:0,unlimited:true,limit:null,background_limit:null,remaining:null}),discoverBrandStores:async(brand,city,_district,request)=>{calls.push(city);await request!("/v5/place/text",params);await request!("/v5/place/text",{...params,page_num:2});return {brand,city,district:"",regions:[],stores:[],complete:true,truncated:false,requests:2,page_size:25}},amapRequest:async(_path,p)=>{fresh.push(String(p.page_num));return {pois:[]}},saveDiscoveredStores:async(_t,_j,_b,_p,city)=>{saved.push(city)}});
 assert.deepEqual(calls,["宜昌市"]);assert.deepEqual(saved,["宜昌市"]);assert.deepEqual(fresh,["2"]);const initial=updates.find(x=>x.sql.startsWith("UPDATE brand_discovery_jobs SET cities_json"));assert.equal(initial?.values[4],1);
});
test("不完整城市缓存不能作为已完整更新直接跳过",async()=>{
 let searched=0;const record={id:2,tenant_id:1,created_by:1,province:"湖北省",cities_json:["武汉市"],brands_json:["糖巢"],control:"run",status:"等待执行",api_calls:0};
 await processDiscoveryJob(2,1,1,{query:async(sql)=>({rows:sql.startsWith("SELECT * FROM brand_discovery_jobs")?[record]:sql.startsWith("SELECT * FROM brand_region_cache")?[{complete:false}]:sql.startsWith("SELECT COUNT(*)")?[{count:0}]:[]}),consumeBackgroundQuota:async()=>({used:0,unlimited:true,limit:null,background_limit:null,remaining:null}),discoverBrandStores:async()=>{searched++;return {brand:"糖巢",city:"武汉市",district:"",regions:[],stores:[],complete:true,truncated:false,requests:0,page_size:25}},saveDiscoveredStores:async()=>{}});assert.equal(searched,1);
});
test("来优品和来伊份移出默认品牌并禁止再次发现入库，门店按 POI ID 去重",()=>{
 for(const brand of ["来优品","来伊份"]){assert.ok(!DEFAULT_SNACK_BRANDS.some(b=>b.name===brand));assert.ok(isRetiredSnackBrand(brand));assert.throws(()=>discoveryRows(brand,"湖北省","武汉市",[]),/已移除/)}
 const rows=discoveryRows("零食有鸣","湖北省","武汉市",[{id:"B0ABCDE123",name:"零食有鸣(中心店)",location:[114,30]},{id:"B0ABCDE123",name:"零食有鸣(中心店)",location:[114,30]}]);assert.equal(rows.length,1);assert.match(saveDiscoveryBatchSql,/touched AS/);assert.match(saveDiscoveryBatchSql,/IS NOT DISTINCT FROM/);
});
test("每周一中午12点按北京时间计算，已过时刻不补跑旧周次",()=>{
 assert.equal(nextWeeklyRefresh(1,12,0,new Date("2026-10-19T03:59:00Z")).toISOString(),"2026-10-19T04:00:00.000Z");assert.equal(nextWeeklyRefresh(1,12,0,new Date("2026-10-19T04:00:00Z")).toISOString(),"2026-10-26T04:00:00.000Z");assert.throws(()=>validateRefreshSchedule({enabled:true,weekday:8,hour:12,minute:0}));
});
test("历史唯一候选仅供预选，歧义和候选变化不能直接批量关联",async()=>{
 const source={id:1,candidates:[{id:2,amap_poi_id:"B0ABCDE123"}]};assert.equal(historyPreviewRow(source).state,"unique");assert.equal(historyPreviewRow({...source,candidates:[...source.candidates,...source.candidates]}).state,"review");assert.equal(historyPreviewRow({...source,candidates:[]}).state,"none");await assert.rejects(()=>validateExactHistoryLinks(1,[{history_store_id:1,brand_store_id:3}],async()=>({rows:[source]})),/候选已变化/);
});
test("密集区域达到200条上限后使用真实下级区划补查，不把多翻页当作全量",async()=>{
 const make=(n:number)=>({id:`B${String(n).padStart(9,"0")}`,name:`零食有鸣(${n}号店)`,type:"购物服务",tag:"零食",location:"114,30"});const requested:string[]=[];
 const result=await discoverBrandStores(async(path,p)=>{
  if(path==="/v3/config/district"){const value=String(p.keywords);return {districts:[{districts:value==="测试市"?[{name:"密集区",adcode:"A"}]:value==="A"?[{name:"第一片区",adcode:"A1"},{name:"第二片区",adcode:"A2"}]:[]}]}}
  requested.push(`${p.region}:${p.page_num}`);const offset=(Number(p.page_num)-1)*25,all=p.region==="A"?Array.from({length:200},(_,i)=>make(i+1)):p.region==="A1"?Array.from({length:101},(_,i)=>make(i+1)):Array.from({length:100},(_,i)=>make(i+102));return {pois:all.slice(offset,offset+25)};
 },"零食有鸣","测试市","",{maxRequests:40});
 assert.equal(result.complete,true);assert.equal(result.stores.length,201);assert.ok(requested.includes("A1:1"));assert.ok(!requested.includes("A:9"));
});

test("断点重放成功页不占新的请求预算，继续补查后面的区域",async()=>{
 const fresh:string[]=[];
 const request=Object.assign(async(path:string,p:Record<string,unknown>)=>{if(path.includes("district"))return {districts:[{districts:[{name:"一区",adcode:"A"},{name:"二区",adcode:"B"}]}]};if(p.region==="B")fresh.push("B");return {pois:[]}}, {isCached:(path:string,p:Record<string,unknown>)=>path.includes("district")||p.region==="A"});
 const result=await discoverBrandStores(request,"零食有鸣","测试市","",{maxRequests:1});assert.equal(result.complete,true);assert.equal(result.requests,1);assert.deepEqual(fresh,["B"]);
});
