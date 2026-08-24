import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseImportRows } from "../server/import-reader.js";

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
