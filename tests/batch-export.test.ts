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
  const row:Row={id:1,input_name:"=测试门店",standard_name:"",address:"测试路1号",status:"分析完成",pois_json:pois,analysis_json:null,updated_at:new Date(),job_config:{radii:[500],categories:["住宅小区","小学"]}};
  const buffer=await buildBatchExportWorkbook([row],[],{jobIds:[1],storeIds:[1],fields:[],radii:[500,800],categories:["住宅小区"],includePoiDetails:false,includeFailures:false,includeNotes:true},{userEmail:"tester@example.com",jobNames:["任务#1"]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);const sheet=workbook.getWorksheet("门店汇总");assert.ok(sheet);
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1),["门店名称","门店地址","500米住宅小区数量","800米住宅小区数量"]);
  assert.equal(sheet.getRow(2).getCell(1).value,"'=测试门店");
  assert.equal(sheet.getRow(2).getCell(2).value,"测试路1号");
  assert.equal(sheet.getRow(2).getCell(3).value,1);
  assert.equal(sheet.getRow(2).getCell(4).value,"");
  assert.ok(workbook.getWorksheet("导出说明"));
});

test("任务列表和导出查询均包含当前账号归属条件",async()=>{
  const source=await fs.readFile(new URL("../server/index.ts",import.meta.url),"utf8");
  assert.match(source,/SELECT \* FROM jobs WHERE tenant_id=\$1 AND created_by=\$2 ORDER BY id DESC/);
  assert.match(source,/s\.tenant_id=\$1 AND s\.created_by=\$2 AND j\.created_by=\$2/);
  assert.match(source,/ai_analyses WHERE tenant_id=\$1 AND created_by=\$2/);
});
