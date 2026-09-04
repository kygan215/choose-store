import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";
import { analyzeImportMapping, detectImportMapping, parseImportRows } from "../server/import-reader.js";
import { classifyResolutionCandidates, prepareStoreResolutionInput } from "../server/store-resolution.js";

const matrix=[["门店名称","城市","区县","详细地址"],["测试门店","武汉市","洪山区","珞喻路1号"]];

for(const bookType of ["xlsx","xls"] as const){
  test(`可以解析 ${bookType} 门店表格`,()=>{
    const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(matrix);XLSX.utils.book_append_sheet(workbook,sheet,"门店");
    const buffer=XLSX.write(workbook,{type:"buffer",bookType});
    assert.deepEqual(parseImportRows(buffer,`门店.${bookType}`),[{门店名称:"测试门店",城市:"武汉市",区县:"洪山区",详细地址:"珞喻路1号"}]);
  });
}

test("可以解析带 BOM 的 UTF-8 CSV",()=>{
  const buffer=Buffer.from("\uFEFF门店名称,城市\r\n测试门店,武汉市","utf8");
  assert.deepEqual(parseImportRows(buffer,"门店.csv"),[{门店名称:"测试门店",城市:"武汉市"}]);
});

test("损坏文件返回可理解的中文提示",()=>{
  assert.throws(()=>parseImportRows(Buffer.from("not-an-excel-file"),"损坏.xlsx"),/无法读取该表格/);
});

test("活动报名表的报名门店列会被识别为门店名称",()=>{
  const headers=["序号","主管","指导","城市","报名门店","姓名","电话","地址"];
  assert.equal(detectImportMapping(headers).name,"报名门店");
});

test("非标准表头会结合前十条内容识别门店名称和详细地址",()=>{
  const rows=[
    {"活动终端":"零食很忙光谷店","落地位置":"湖北省武汉市洪山区珞喻路88号"},
    {"活动终端":"零食有鸣南湖店","落地位置":"湖北省武汉市洪山区南湖大道10号"},
    {"活动终端":"赵一鸣零食江汉路店","落地位置":"湖北省武汉市江汉区江汉路20号"},
  ];
  const result=analyzeImportMapping(Object.keys(rows[0]),rows);
  assert.equal(result.mapping.name,"活动终端");
  assert.equal(result.mapping.address,"落地位置");
  assert.ok(result.detections.find(item=>item.field==="name")?.samples.length);
});

test("标准表头保持高置信度且只有省市不能构成门店定位信息",()=>{
  const analysis=analyzeImportMapping(["门店名称","详细地址"],[{"门店名称":"","详细地址":""}]);
  assert.equal(analysis.detections.find(item=>item.field==="name")?.confidence,"高");
  assert.equal(prepareStoreResolutionInput({甲:"湖北省",乙:"武汉市"},{}).hasLocator,false);
});

test("每一行都能从地址或备注提取门店并组合行政区",()=>{
  const prepared=prepareStoreResolutionInput({"省":"湖北省","市":"黄冈市","终端位置":"蕲春县管窑镇南征街道131号","补充":"零食很忙管窑镇店"},{province:"省",city:"市",address:"终端位置",remark:"补充"});
  assert.equal(prepared.searchName,"零食很忙管窑镇店");
  assert.match(prepared.address,/湖北省黄冈市.*南征街道131号/);
  assert.equal(prepared.hasLocator,true);
});

test("候选分差不足八分或存在城市冲突时不会自动确认",()=>{
  const candidate=(id:string,score:number,conflicts:string[]=[])=>({id,name:`门店${id}`,address:"测试路",location:[114,30] as [number,number],score,status:"",reasons:[],conflicts,auto_confirm:false});
  const close=classifyResolutionCandidates([candidate("A",90),candidate("B",84)]);
  assert.equal(close.autoConfirm,false);
  assert.match(close.status,/候选相近/);
  const conflict=classifyResolutionCandidates([candidate("A",95,["城市冲突：期望武汉市"])]);
  assert.equal(conflict.autoConfirm,false);
});

test("待确认流程具备迁移字段和人工处理端点",()=>{
  const migration=fs.readFileSync(new URL("../server/migrations/005_smart_store_resolution.sql",import.meta.url),"utf8");
  const server=fs.readFileSync(new URL("../server/index.ts",import.meta.url),"utf8");
  for(const field of ["match_candidates_json","search_input_json","confirmation_method"])assert.match(migration,new RegExp(field));
  for(const endpoint of ["confirm-match","confirm-best","research","skip-match"])assert.match(server,new RegExp(endpoint));
});
