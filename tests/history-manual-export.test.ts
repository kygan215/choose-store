import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {buildBatchExportWorkbook} from "../server/batch-export.js";
import {resolveTaskBrandStoreIds,resolveTaskHistoryStoreIds} from "../server/history-export-resolve.js";

test("历史导出拒绝直接品牌库链接与分析身份冲突，不因直接ID跳过核实",async()=>{
 const rows=await resolveTaskBrandStoreIds(1,[{id:9,brand_store_id:101,amap_poi_id:"B0TASK0001",brand:"优味多",province:"湖北省",city:"武汉市"}],async()=>[{id:101,amap_poi_id:"B0OTHER001",brand_name:"好想来",province:"湖南省",city:"长沙市"}]);
 assert.equal(rows.size,0);
});

test("内部档案缺原始POI时仍核对其已绑定品牌库的真实POI",async()=>{
 const rows=await resolveTaskHistoryStoreIds(1,[{id:9,history_store_id:501,amap_poi_id:"B0TASK0001",brand:"零食很忙",province:"湖北省",city:"孝感市"}],async()=>[{id:501,brand_store_id:101,brand_name:"零食很忙",province:"湖北省",city:"孝感市",poi_id:null,library_poi_id:"B0OTHER001",library_brand:"零食很忙",library_province:"湖北省",library_city:"孝感市"}]);
 assert.equal(rows.size,0);
});

test("内部人工关联不兼容时保持未匹配，不静默切换另一品牌库身份",async()=>{
 let requested:unknown;
 const buffer=await buildBatchExportWorkbook([{id:1,input_name:"需重新核对",history_store_id:501,brand_store_id:81}],[],
  {jobIds:[9],storeIds:[],fields:[],radii:[],categories:[],includePoiDetails:false,includeFailures:false,includeNotes:false,includeHistory:true},
  {tenantId:3,userEmail:"test@invalid.local",jobNames:[]},
  {resolveTaskBrandStoreIds:async()=>new Map([[1,81]]),resolveTaskHistoryStoreIds:async()=>new Map(),getHistoricalExportData:async(_tenant,ids,_start,_end,historyIds)=>{requested={ids,historyIds};return {summaries:new Map(),details:[]}}});
 assert.deepEqual(requested,{ids:[],historyIds:[]});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
 assert.equal(workbook.getWorksheet("门店汇总")!.getCell("H2").value,"历史数据未匹配");
});

test("无 POI 的分析记录经人工关联内部历史档案后，汇总和逐场明细均能导出",async()=>{
 let requestedIds:unknown;
 const buffer=await buildBatchExportWorkbook([{id:1,input_name:"人工核实店",history_store_id:501}],[],
  {jobIds:[9],storeIds:[],fields:[],radii:[],categories:[],includePoiDetails:false,includeFailures:false,includeNotes:false,includeHistory:true},
  {tenantId:3,userEmail:"test@invalid.local",jobNames:["人工核实"]},
  {
   resolveTaskBrandStoreIds:async()=>new Map(),
   resolveTaskHistoryStoreIds:async()=>new Map([[1,501]]),
   getHistoricalExportData:async(_tenant,_brandIds,_start,_end,historyIds)=>{
    requestedIds=historyIds;
    return {summaries:new Map(),historySummaries:new Map([[501,{activity_count:1,latest_activity_start:"2026-10-01",sales_amount:"100.00",known_amount_count:1,missing_amount_count:0,refund_basis_values:["unknown"]}]]),details:[{brand_store_id:null,history_store_id:501,activity_id:55,brand_name:"零食很忙",store_name:"活动时店名",province:"湖北省",city:"孝感市",address:"旧地址",start_date:"2026-10-01",end_date:"2026-10-07",activity_name:"国庆活动",sales_amount:"100.00",refund_basis:"unknown",calendar_tags:[],source_import_id:2,source_sheet:"原表",source_cell:"B2"}]};
   },
  });
 assert.deepEqual(requestedIds,[501]);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
 assert.equal(workbook.getWorksheet("门店汇总")!.getCell("E2").value,100);
 const details=workbook.getWorksheet("历史活动明细")!;
 assert.equal(details.getCell("A2").value,"");
 assert.equal(details.getCell("B2").value,501);
 assert.equal(details.getCell("E2").value,"活动时店名");
 assert.equal(details.getCell("L2").value,100);
});
