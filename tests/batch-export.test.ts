import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ExcelJS from "exceljs";
import { buildBatchExportWorkbook, countPois, poiColumnLabel, sanitizeExcelText } from "../server/batch-export.js";
import type { Poi, Row } from "../server/services.js";

const pois:Poi[]=[
  {id:"1",name:"小区A",category:"住宅小区",type:"",typecode:"",address:"",distance:320,location:[114.3,30.5],distance_bucket:"≤500米"},
  {id:"2",name:"小区B",category:"住宅小区",type:"",typecode:"",address:"",distance:720,location:[114.31,30.51],distance_bucket:"≤800米"},
  {id:"3",name:"小学A",category:"小学",type:"",typecode:"",address:"",distance:480,location:[114.32,30.52],distance_bucket:"≤500米"},
  {id:"4",name:"中学A",category:"中学",type:"科教文化服务;学校;中学",typecode:"141202",address:"",distance:450,location:[114.32,30.52],distance_bucket:"≤500米"},
];

test("圈层分类字段名称和累计数量口径正确",()=>{
  assert.equal(poiColumnLabel(500,"住宅小区"),"500米住宅小区数量");
  assert.equal(poiColumnLabel(1000,"小学"),"1公里小学数量");
  assert.equal(countPois(pois,500,"住宅小区"),1);
  assert.equal(countPois(pois,800,"住宅小区"),2);
  assert.equal(poiColumnLabel(500,"中学"),"500米中学数量");
  assert.equal(countPois(pois,500,"中学"),1);
});

test("Excel 文本会阻止公式注入",()=>{
  assert.equal(sanitizeExcelText("=HYPERLINK(\"bad\")"),"'=HYPERLINK(\"bad\")");
  assert.equal(sanitizeExcelText("普通门店"),"普通门店");
});

test("工作簿固定包含门店名称地址，并对未分析圈层留空",async()=>{
  const row:Row={id:1,input_name:"=用户原表门店",standard_name:"高德标准门店",address:"测试路1号",status:"分析完成",pois_json:pois,analysis_json:null,updated_at:new Date(),job_config:{radii:[500],categories:["住宅小区","小学"]}};
  const buffer=await buildBatchExportWorkbook([row],[],{jobIds:[1],storeIds:[1],fields:[],radii:[500,800],categories:["住宅小区"],includePoiDetails:false,includeFailures:false,includeNotes:true},{userEmail:"tester@example.com",jobNames:["任务#1"]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);const sheet=workbook.getWorksheet("门店汇总");assert.ok(sheet);
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1),["门店名称","门店地址","500米住宅小区数量","800米住宅小区数量"]);
  assert.equal(sheet.getRow(2).getCell(1).value,"'=用户原表门店");
  assert.equal(sheet.getRow(2).getCell(2).value,"测试路1号");
  assert.equal(sheet.getRow(2).getCell(3).value,1);
  assert.equal(sheet.getRow(2).getCell(4).value,"");
  assert.ok(workbook.getWorksheet("导出说明"));
});

test("亲子活动AI字段按用户勾选列导出",async()=>{
  const row:Row={id:1,input_name:"原表门店名",address:"测试路1号",status:"分析完成",pois_json:pois,analysis_json:{},updated_at:new Date(),job_config:{radii:[500],categories:["住宅小区"]}};
  const ai:Row={store_id:1,result_json:{summary:"妈妈带孩子家庭是主要活动客群。",parent_child_activity:{fit_level:"较高",fit_score:72,audience_level:"突出",audience_score:81,core_child_age:"3–12岁",touch_scenes:["放学后","周末"]},activity_plan:{theme:"亲子互动日",format_steps:["到店互动","领取权益"],suggested_timing:"周末下午",resources_notes:["预算未提供"]}}};
  const buffer=await buildBatchExportWorkbook([row],[ai],{jobIds:[1],storeIds:[1],fields:["ai_summary","ai_activity_fit_score","ai_parent_child_index","ai_activity_theme"],radii:[500],categories:["住宅小区"],includePoiDetails:false,includeFailures:false,includeNotes:false},{userEmail:"tester@example.com",jobNames:["任务#1"]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);const sheet=workbook.getWorksheet("门店汇总");assert.ok(sheet);
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1,7),["门店名称","门店地址","AI 活动摘要","AI 活动适配分","AI 亲子客群指数","AI 活动主题建议"]);
  assert.equal(sheet.getRow(2).getCell(4).value,72);assert.equal(sheet.getRow(2).getCell(5).value,81);
});

test("环境代理指标和各半径竞品数据可以导出",async()=>{
  const row:Row={id:1,input_name:"原表门店名",address:"测试路1号",status:"分析完成",pois_json:pois,updated_at:new Date(),job_config:{radii:[500],categories:["住宅小区","竞品门店"]},analysis_json:{environment_proxies:{primary_radius:500,residential_activity:{by_radius:{"500":{radius:500,level:"高",score:68,confidence:"中",evidence:["住宅小区8个"]}}},consumption_environment:{by_radius:{"500":{radius:500,level:"中高",score:66,confidence:"中",evidence:["餐饮12个"]}}},competition_dashboard:{by_radius:{"500":{radius:500,total:2,same_brand:1,other_brand:1,score:63,level:"高",nearest:{name:"赵一鸣零食店",brand:"赵一鸣零食",distance:180}}}}}}};
  const fields=["residential_activity_level","residential_activity_index","consumption_level","competitor_total","competitor_same_brand","nearest_competitor","nearest_competitor_distance","competition_level","competition_by_radius"];
  const buffer=await buildBatchExportWorkbook([row],[],{jobIds:[1],storeIds:[1],fields,radii:[500],categories:["住宅小区"],includePoiDetails:false,includeFailures:false,includeNotes:true},{userEmail:"tester@example.com",jobNames:["任务#1"]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);const sheet=workbook.getWorksheet("门店汇总");assert.ok(sheet);
  assert.equal(sheet.getRow(2).getCell(3).value,"高");assert.equal(sheet.getRow(2).getCell(4).value,68);assert.equal(sheet.getRow(2).getCell(5).value,"中高");assert.equal(sheet.getRow(2).getCell(6).value,2);assert.equal(sheet.getRow(2).getCell(9).value,180);assert.match(String(sheet.getRow(2).getCell(11).value),/500米：2家/);
});

test("任务列表和导出查询均包含当前账号归属条件",async()=>{
  const source=await fs.readFile(new URL("../server/index.ts",import.meta.url),"utf8");
  assert.match(source,/SELECT \* FROM jobs WHERE tenant_id=\$1 AND created_by=\$2 ORDER BY id DESC/);
  assert.match(source,/s\.tenant_id=\$1 AND s\.created_by=\$2 AND j\.created_by=\$2/);
  assert.match(source,/ai_analyses WHERE tenant_id=\$1 AND created_by=\$2/);
});
