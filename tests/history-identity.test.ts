import assert from "node:assert/strict";
import test from "node:test";
import {duplicateEventRows,duplicateSourceStoreRows,identityMismatch} from "../server/history-routes.js";

const event=(row_number:number,start_date="2025-10-01")=>({row_number,column_index:3,start_date,end_date:"2025-10-07"});
const store=(row_number:number,name:string,poi_id:string,more:Record<string,unknown>={})=>({row_number,name,brand:"好想来",province:"湖北省",city:"武汉市",poi_id,address:"",history_store_id:undefined,brand_store_id:undefined,...more});

test("同一唯一 POI 的不同原始店名，同日期活动不得重复累计",()=>{
  const rows=[store(2,"湖北武汉一店","P-123"),store(3,"湖北武汉新店名","P-123")];
  const match=new Map([["P-123",{id:42,count:1,brand_name:"好想来",province:"湖北省",city:"武汉市"}]]);
  assert.equal(duplicateEventRows([event(2),event(3)] as never,rows as never,match).length,1);
  assert.equal(duplicateEventRows([event(2),event(3,"2026-10-01")] as never,rows as never,match).length,0);
});

test("人工指向同一个历史门店或同一个品牌门店，也按真实身份判重",()=>{
  const rows=[store(2,"一店","",{history_store_id:20}),store(3,"一店新名称","",{history_store_id:20})];
  assert.equal(duplicateEventRows([event(2),event(3)] as never,rows as never,new Map()).length,1);
  const linked=[store(2,"一店","",{brand_store_id:42}),store(3,"一店新名称","",{brand_store_id:42})];
  assert.equal(duplicateEventRows([event(2),event(3)] as never,linked as never,new Map()).length,1);
});

test("人工历史档案必须与品牌、地区及双方非空 POI ID 一致",()=>{
  const row=store(2,"湖北武汉一店","P-NEW");
  assert.equal(identityMismatch(row,{brand_name:"好想来",province:"湖北省",city:"武汉市",poi_id:"P-OLD"},"poi_id"),true);
  assert.equal(identityMismatch(row,{brand_name:"别的品牌",province:"湖北省",city:"武汉市",poi_id:"P-NEW"},"poi_id"),true);
  assert.equal(identityMismatch(row,{brand_name:"好想来",province:"湖北省",city:"武汉市",poi_id:"P-NEW"},"poi_id"),false);
});

test("同一 POI 分散在不同原始行，即使日期不同也不能建立两个历史身份",()=>{
  const rows=[store(2,"湖北武汉一店","P-123"),store(3,"湖北武汉改名店","P-123")];
  assert.equal(duplicateSourceStoreRows(rows as never).length,1);
  const confirmed=rows.map(row=>({...row,history_store_id:9}));
  assert.equal(duplicateSourceStoreRows(confirmed as never).length,0);
});
