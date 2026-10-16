import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {dateRangeHeader,guessRegion,parseHistoryWorkbook,salesAmount,validDate} from "../server/history-parse.js";

test("活动日期列选定年份，跨年按开始年份记录",()=>{
  assert.deepEqual(dateRangeHeader("10月1日-10月7日",2025),{start_date:"2025-10-01",end_date:"2025-10-07"});
  assert.deepEqual(dateRangeHeader("8月7号-8月9日",2026),{start_date:"2026-08-07",end_date:"2026-08-09"});
  assert.deepEqual(dateRangeHeader("12月29日-1月3日",2025),{start_date:"2025-12-29",end_date:"2026-01-03"});
  assert.equal(validDate("2025-02-29"),false);
  assert.equal(dateRangeHeader("2月29日-3月1日",2025),null);
});

test("透视表前置筛选行、总计和另一张活动明细不会重复导入",async()=>{
  const workbook=new ExcelJS.Workbook(),pivot=workbook.addWorksheet("城市数据透视");
  pivot.getRow(1).values=["城市","(全部)"];
  pivot.getRow(3).values=["求和项:销售额","活动时间"];
  pivot.getRow(4).values=["门店名称","8月7号-8月9日","10月1日-10月7日","总计"];
  pivot.getRow(5).values=["零食很忙湖北武汉天泽一方店",0,100,100];
  pivot.getRow(6).values=["湖北荆州洪湖汊河镇店（赵一鸣）",50,null,50];
  pivot.getRow(7).values=["总计",50,100,150];
  const detail=workbook.addWorksheet("数据表格");
  detail.addRow(["城市","门店名称","活动时间","活动天数","销售额"]);
  detail.addRow(["武汉","零食很忙湖北武汉天泽一方店","8月7号-8月9日","3天",0]);
  detail.addRow(["荆州","湖北荆州洪湖汊河镇店（赵一鸣）","8月7号-8月9日","3天",50]);
  const parsed=await parseHistoryWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()),2026,[{province:"湖北省",city:"武汉市"},{province:"湖北省",city:"荆州市"}]);
  assert.equal(parsed.sheet,"城市数据透视");
  assert.equal(parsed.rows.length,2);
  assert.equal(parsed.columns.length,2);
  assert.deepEqual(parsed.rows.map(row=>row.row_number),[5,6]);
  assert.deepEqual(parsed.rows.map(row=>row.brand),["零食很忙","赵一鸣零食"]);
  assert.deepEqual(parsed.rows.map(row=>row.city),["武汉市","荆州市"]);
  assert.equal(parsed.rows[0].values["2"],"0");
  assert.equal(parsed.rows[0].values["3"],"100");
  assert.deepEqual(parsed.rows[1].values,{"2":"50"});
});

test("空白无活动，0 是已完成零销售，错误金额须在预览暴露",async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("2025活动");
  sheet.addRow(["品牌","门店名称","10月1日-10月7日","4月29日-5月3日"]);
  sheet.addRow(["好想来","湖北武汉江汉路店",1000,null]);
  sheet.addRow(["好想来","湖北鄂州吾悦店",0,"1,250.50"]);
  sheet.addRow(["好想来","湖北武汉测试店","异常",""]);
  const parsed=await parseHistoryWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()),2025,[{province:"湖北省",city:"武汉市"},{province:"湖北省",city:"鄂州市"}]);
  assert.equal(parsed.rows.length,3);
  assert.deepEqual(parsed.rows[0].values,{"3":"1000"});
  assert.equal(parsed.rows[0].province,"湖北省");
  assert.equal(parsed.rows[0].city,"武汉市");
  assert.equal(parsed.rows[0].region_source,"name_prefix");
  assert.equal(parsed.rows[1].values["3"],"0");
  assert.equal(salesAmount(parsed.rows[1].values["3"]),"0.00");
  assert.equal(salesAmount(parsed.rows[1].values["4"]),"1250.50");
  assert.match(parsed.rows[2].issues[0],/无效/);
});

test("仅名称前缀可提示省市，不能从任意包含的地名作肯定匹配",()=>{
  const locations=[{province:"湖北省",city:"武汉市"}];
  assert.deepEqual(guessRegion("湖北武汉江汉路店",locations),{province:"湖北省",city:"武汉市"});
  assert.deepEqual(guessRegion("江汉路湖北武汉店",locations),{province:"",city:""});
});

test("缺门店名或空表头下有金额时，预览保留数据并提示修正",async()=>{
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("待修正");
  sheet.addRow(["门店名称","10月1日-10月7日",null]);
  sheet.addRow([null,1000,200]);
  sheet.addRow(["好想来湖北武汉店",null,0]);
  const parsed=await parseHistoryWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()),2025);
  assert.equal(parsed.rows.length,2);
  assert.equal(parsed.rows[0].values["2"],"1000");
  assert.equal(parsed.rows[0].values["3"],"200");
  assert.match(parsed.rows[0].issues.join("；"),/缺少门店名称/);
  assert.equal(parsed.rows[1].values["3"],"0");
  assert.match(parsed.issues.join("；"),/第 3 列.*指定起止年月日或明确忽略/);
});

test("销售额按十进制规范化，过大金额不发生 JS 浮点改写",()=>{
  assert.equal(salesAmount("99999999999999.99"),"99999999999999.99");
  assert.equal(salesAmount("100000000000000.00"),null);
});
