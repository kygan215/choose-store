import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {parseHistoryExportOptions} from "../server/history-export-options.js";
import {resolveTaskBrandStoreIds} from "../server/history-export-resolve.js";
import {addHistoricalDetailSheet,historyRefundBasisByStore,historySummaryCells} from "../server/history-export-workbook.js";
import {buildBatchExportWorkbook} from "../server/batch-export.js";

test("历史导出日期范围只在勾选时启用，拒绝不可能日期和逆序范围",()=>{
  assert.deepEqual(parseHistoryExportOptions({include_history:false,history_start_date:"2026-02-30"}),{includeHistory:false});
  assert.deepEqual(parseHistoryExportOptions({include_history:true,history_start_date:"2026-10-01",history_end_date:"2026-10-07"}),{includeHistory:true,historyStartDate:"2026-10-01",historyEndDate:"2026-10-07"});
  assert.throws(()=>parseHistoryExportOptions({include_history:true,history_start_date:"2026-02-30"}),/日期无效/);
  assert.throws(()=>parseHistoryExportOptions({include_history:true,history_start_date:"2026-10-08",history_end_date:"2026-10-07"}),/不能晚于/);
});

test("任务门店历史只通过租户内直接链接或唯一且品牌地区兼容的 POI 关联",async()=>{
  const rows=[
    {id:1,brand_store_id:101,amap_poi_id:"DIRECT"},
    {id:2,amap_poi_id:"UNIQUE",brand:"好想来",province:"湖北省",city:"武汉市"},
    {id:3,amap_poi_id:"UNIQUE",brand:"来优品",province:"湖北省",city:"武汉市"},
    {id:4,amap_poi_id:"UNIQUE",brand:"好想来",province:"湖南省",city:"武汉市"},
    {id:5,amap_poi_id:"DUPLICATE",brand:"好想来",province:"湖北省",city:"武汉市"},
    {id:6,input_name:"好想来某店",brand:"好想来",province:"湖北省",city:"武汉市"},
  ];
  const lookup=async()=>[
    {id:101,amap_poi_id:"DIRECT",brand_name:"好想来",province:"湖北省",city:"武汉市"},
    {id:102,amap_poi_id:"UNIQUE",brand_name:"好想来",province:"湖北省",city:"武汉市"},
    {id:103,amap_poi_id:"DUPLICATE",brand_name:"好想来",province:"湖北省",city:"武汉市"},
    {id:104,amap_poi_id:"DUPLICATE",brand_name:"好想来",province:"湖北省",city:"武汉市"},
  ];
  const matched=await resolveTaskBrandStoreIds(1,rows,lookup);
  assert.deepEqual([...matched.entries()],[[1,101],[2,102]]);
});

test("历史汇总区分未匹配、无活动、零销售与金额缺失",()=>{
  assert.equal(historySummaryCells(undefined,false)[5],"历史数据未匹配");
  assert.equal(historySummaryCells(undefined,true)[5],"未找到已关联历史活动");
  assert.deepEqual(historySummaryCells({activity_count:1,latest_activity_start:"2026-10-01",sales_amount:"0.00",known_amount_count:1,missing_amount_count:0},true,false,["已扣退款"]),[1,"2026-10-01",0,0,"已扣退款","已匹配"]);
  const unknown=historySummaryCells({activity_count:1,latest_activity_start:"2026-10-01",sales_amount:null,known_amount_count:0,missing_amount_count:1},true);
  assert.equal(unknown[2],"");assert.equal(unknown[3],1);assert.match(String(unknown[5]),/销售额缺失/);
  const mixed=historySummaryCells({activity_count:2,latest_activity_start:"2026-10-07",sales_amount:"1000.00",known_amount_count:1,missing_amount_count:1},true);
  assert.equal(mixed[2],1000);assert.match(String(mixed[5]),/仅含已填金额/);
});

test("逐场明细使用活动时快照并保持数值 0 与空白不同",()=>{
  const workbook=new ExcelJS.Workbook();const sheet=addHistoricalDetailSheet(workbook,[
    {brand_store_id:7,history_store_id:4,activity_id:20,brand_name:"好想来",store_name:"旧店名",province:"湖北省",city:"武汉市",address:"旧地址",start_date:"2026-10-01",end_date:"2026-10-07",activity_name:"=危险公式",sales_amount:"0.00",refund_basis:"未知",calendar_tags:["含周末"],source_import_id:3,source_sheet:"Sheet1",source_cell:"B2"},
    {brand_store_id:7,history_store_id:4,activity_id:21,brand_name:"好想来",store_name:"旧店名",province:"湖北省",city:"武汉市",address:"旧地址",start_date:"2026-10-08",end_date:"2026-10-09",activity_name:"未填金额",sales_amount:null,refund_basis:"未知",calendar_tags:[],source_import_id:null,source_sheet:null,source_cell:null},
  ]);
  assert.equal(sheet.getCell("E2").value,"旧店名");
  assert.equal(sheet.getCell("I2").value,"'=危险公式");
  assert.equal(sheet.getCell("L2").value,0);
  assert.equal(sheet.getCell("L3").value,"");
  assert.equal(sheet.getCell("M2").value,"未知");
  assert.equal(sheet.getCell("Q2").value,"B2");
});

test("同店退款口径混合时明确提示，不能把原值当作同口径净额",()=>{
  const bases=historyRefundBasisByStore([
    {brand_store_id:8,refund_basis:"refunded"},
    {brand_store_id:8,refund_basis:"not_refunded"},
  ] as Parameters<typeof historyRefundBasisByStore>[0]);
  const row=historySummaryCells({activity_count:2,latest_activity_start:"2026-10-08",sales_amount:"3000.00",known_amount_count:2,missing_amount_count:0},true,false,bases.get(8));
  assert.equal(row[4],"口径混合：已扣退款、未扣退款");
});

test("批量工作簿按活动开始日范围附加一店一行汇总与逐场明细",async()=>{
  let requestedRange:unknown;
  const buffer=await buildBatchExportWorkbook(
    [{id:1,input_name:"已关联店",address:"现地址"},{id:2,input_name:"未关联店",address:"另地址"}],[],
    {jobIds:[9],storeIds:[],fields:[],radii:[],categories:[],includePoiDetails:false,includeFailures:false,includeNotes:false,includeHistory:true,historyStartDate:"2026-10-01",historyEndDate:"2026-10-07"},
    {tenantId:3,userEmail:"tester@example.com",jobNames:["任务#9"]},
    {
      resolveTaskBrandStoreIds:async()=>new Map([[1,81]]),
      getHistoricalExportData:async(tenantId,ids,start,end)=>{
        requestedRange={tenantId,ids,start,end};
        return {summaries:new Map([[81,{activity_count:1,latest_activity_start:"2026-10-01",sales_amount:"0.00",known_amount_count:1,missing_amount_count:0,refund_basis_values:["unknown"]}]]),details:[{brand_store_id:81,history_store_id:11,activity_id:55,brand_name:"活动时品牌",store_name:"活动时店名",province:"湖北省",city:"武汉市",address:"活动时地址",start_date:"2026-10-01",end_date:"2026-10-07",activity_name:"国庆活动",sales_amount:"0.00",refund_basis:"unknown",calendar_tags:["含官方假期"],source_import_id:2,source_sheet:"原表",source_cell:"B2"}]};
      },
    },
  );
  assert.deepEqual(requestedRange,{tenantId:3,ids:[81],start:"2026-10-01",end:"2026-10-07"});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const main=workbook.getWorksheet("门店汇总")!,details=workbook.getWorksheet("历史活动明细")!;
  assert.equal(main.getCell("E2").value,0);
  assert.equal(main.getCell("G2").value,"未知");
  assert.equal(main.getCell("H2").value,"已匹配");
  assert.equal(main.getCell("E3").value,"");
  assert.equal(main.getCell("H3").value,"历史数据未匹配");
  assert.equal(details.rowCount,2);
  assert.equal(details.getCell("E2").value,"活动时店名");
  assert.equal(details.getCell("L2").value,0);
});
