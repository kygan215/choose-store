import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DEFAULT_BRANDS, effectivePoiCount, estimateAnalysis, evaluateConditions, normalizePoiConditions, PROVINCES, quotaResumeDelay, type PoiCondition } from "../server/brand-library.js";
import type { Poi } from "../server/services.js";

const poi=(name:string,category:string,distance:number,id=name):Poi=>({id,name,category,type:"",typecode:"",address:"",distance,location:[114,30],distance_bucket:"≤500米"});

test("品牌门店库取消全国入口并提供完整省级入口",()=>{
  assert.equal(PROVINCES.includes("湖北省"),true);
  assert.equal(PROVINCES.includes("全国"),false);
  assert.ok(PROVINCES.length>=31);
});

test("首批零食系统品牌库包含需求确认的主要品牌",()=>{
  const names=DEFAULT_BRANDS.map(item=>item.name);
  for(const expected of ["零食很忙","零食有鸣","赵一鸣零食","好想来零食","爱零食","来优品","戴永红","糖巢","老婆大人","良品铺子","来伊份"])assert.ok(names.includes(expected),expected);
  assert.ok(DEFAULT_BRANDS.find(item=>item.name==="好想来零食")?.aliases.includes("好像来"));
});

test("学校有效数量会合并同一学校的入口而保留独立校区",()=>{
  const rows=[poi("育才小学","小学",120,"a"),poi("育才小学东门","小学",130,"b"),poi("育才小学停车场","小学",140,"c"),poi("育才小学（光谷校区）","小学",180,"d"),poi("范围外小学","小学",800,"e")];
  const count=effectivePoiCount(rows,"小学",500);
  assert.equal(count.raw,4);
  assert.equal(count.effective,2);
});

test("POI反查支持并且、或者及区间条件且保留原始和有效数量",()=>{
  const rows=[...Array.from({length:6},(_,index)=>poi(`小学${index}`,"小学",100+index)),...Array.from({length:5},(_,index)=>poi(`中学${index}`,"中学",200+index))];
  const conditions:PoiCondition[]=[{category:"小学",radius:500,operator:"gte",value:6},{category:"中学",radius:500,operator:"gte",value:6}];
  const andResult=evaluateConditions(rows,conditions,"and"),orResult=evaluateConditions(rows,conditions,"or");
  assert.equal(andResult.passed,false);
  assert.equal(orResult.passed,true);
  assert.deepEqual(andResult.details.map(item=>item.effective_count),[6,5]);
  assert.deepEqual(andResult.details.map(item=>item.raw_count),[6,5]);
});

test("启动分析前按门店、分类和最大分页估算高德调用量",()=>{
  const result=estimateAnalysis(100,[{category:"小学",radius:500,operator:"gte",value:6},{category:"中学",radius:500,operator:"gte",value:6}]);
  assert.equal(result.stores,100);
  assert.deepEqual(result.categories,["小学","中学"]);
  assert.ok(result.estimated_calls>=200);
});

test("POI筛选条件会限制分类、半径和数量范围",()=>{
  assert.deepEqual(normalizePoiConditions([{category:"小学",radius:500,operator:"gte",value:6}]),[{category:"小学",radius:500,operator:"gte",value:6}]);
  assert.throws(()=>normalizePoiConditions([{category:"任意SQL",radius:500,operator:"gte",value:1}]),/条件无效/);
  assert.throws(()=>normalizePoiConditions([{category:"小学",radius:500000,operator:"gte",value:1}]),/条件无效/);
});

test("额度耗尽后的自动续跑时间指向下一次北京日切之后",()=>{
  assert.ok(quotaResumeDelay()>=60_000);
  assert.ok(quotaResumeDelay()<=24*3600_000+10*60_000);
});

test("独立品牌门店库页面包含后台任务、跨页选择、导出和POI反查入口",()=>{
  const source=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8"),server=fs.readFileSync(new URL("../server/index.ts",import.meta.url),"utf8");
  for(const text of ["品牌门店库","查询任务","跨页全选筛选结果","后台生成Excel","POI条件反查","核算调用量并继续"])assert.match(source,new RegExp(text));
  assert.match(source,/用本次结果做POI反查/);
  assert.match(server,/brand-library\/jobs\/:id\/store-ids/);
  assert.doesNotMatch(source,/全量品牌门店查询/);
});

test("品牌门店导出采用后台任务并在API与Worker之间共享文件卷",()=>{
  const migration=fs.readFileSync(new URL("../server/migrations/004_brand_store_library.sql",import.meta.url),"utf8"),worker=fs.readFileSync(new URL("../server/worker.ts",import.meta.url),"utf8"),compose=fs.readFileSync(new URL("../docker-compose.yml",import.meta.url),"utf8"),library=fs.readFileSync(new URL("../server/brand-library.ts",import.meta.url),"utf8");
  assert.match(migration,/CREATE TABLE IF NOT EXISTS brand_export_jobs/);
  assert.match(worker,/brand-library-export/);
  assert.match(compose,/brand_export_files:\/app\/outputs\/brand-exports/g);
  assert.match(library,/file_expires_at<=NOW\(\)/);
  assert.match(library,/INTERVAL '180 days'/);
});
