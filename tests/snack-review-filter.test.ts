import assert from "node:assert/strict";
import test from "node:test";
import {canRetainSnackStore,snackReviewStatus} from "../server/snack-retail.js";
import {storeFilterSql} from "../server/brand-library.js";

test("明确蛋糕分类、标签或主名称且没有零食/超市证据的目标同名店排除",()=>{
 for(const extra of [{type:"餐饮服务;糕饼店",typecode:"050800"},{business:{keytag:"蛋糕店"}},{tag:"西饼店"},{name:"糖巢蛋糕店"}]){
  assert.equal(canRetainSnackStore({name:"糖巢御品(三明店)",...extra},"糖巢"),false,JSON.stringify(extra));
 }
});
test("蛋糕地标不误删，零食及超市证据与蛋糕分类冲突保留待核验",()=>{
 assert.equal(canRetainSnackStore({name:"零食有鸣批发超市(幸福蛋糕店旁店)",business:{keytag:"综合超市"}},"零食有鸣"),true);
 for(const tag of ["零食","日杂店","综合超市"]){
  const poi={name:"糖巢(三明店)",type:"购物服务;购物相关场所",business:{keytag:`蛋糕店;${tag}`}};
  assert.equal(canRetainSnackStore(poi,"糖巢"),true);assert.equal(snackReviewStatus(poi),"待核验");
 }
});
test("待核验筛选进入数据库条件并与品牌筛选组合",()=>{
 const filter=storeFilterSql(1,{brands:["糖巢"],review_status:"pending"} as Parameters<typeof storeFilterSql>[1]);
 assert.match(filter.where,/bs\.needs_review\s*=\s*\$\d+/);assert.ok(filter.values.includes(true));assert.ok(filter.where.includes("bs.brand_name=ANY"));
 const verified=storeFilterSql(1,{review_status:"verified"} as Parameters<typeof storeFilterSql>[1]);assert.ok(verified.values.includes(false));
 assert.ok(!storeFilterSql(1,{}).where.includes("needs_review"));
});
