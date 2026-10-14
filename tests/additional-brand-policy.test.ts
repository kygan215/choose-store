import assert from "node:assert/strict";
import test from "node:test";
import {CONFIRMED_ADDITIONAL_BRANDS,assessBrandStore} from "../shared/brand-store-policy.js";
import {DEFAULT_SNACK_BRANDS,isRetiredSnackBrand} from "../server/snack-brands.js";
import {discoverBrandStores} from "../server/store-search.js";
import {additionalBrandFixtures} from "./additional-brand-policy-fixtures.js";
test("十个新增品牌使用确认的名称、零售业态、异业待核验与硬性排除边界",()=>{
 assert.equal(DEFAULT_SNACK_BRANDS.length,24);
 for(const {brand,expected,...row} of additionalBrandFixtures){
  assert.equal(assessBrandStore(brand,{id:"ADDITIONAL",...row}).decision,expected,`${brand}/${row.name}/${row.tag}`);
  assert.equal(assessBrandStore(brand,{id:"ADDITIONAL",...row},"exclude").decision,"排除");
 }
 assert.equal(isRetiredSnackBrand("零食优选"),false);
 assert.equal(isRetiredSnackBrand("零食好能嗨"),true);
 for(const name of ["爱零食优选(市场街店)","爱零食优选(另一分店)","爱零食优选零食店"]){
  assert.equal(assessBrandStore("爱零食",{id:"OVERLAP",name,tag:"零食"}).decision,"待核实","按用户新确认保留优选系列名称核验");
 }
 assert.equal(assessBrandStore("来优品",{id:"OLD",name:"来优品(中心店)",tag:"蛋糕店"}).decision,"排除","已有品牌政策保持原有边界");
});
test("新增品牌真实搜索使用品牌本名，去重，并将异业标签候选保留待核验",async()=>{
 for(const brand of CONFIRMED_ADDITIONAL_BRANDS){
  const rows=[{id:"SHOP",name:`${brand}量贩零食(中心店)`,tag:"零食",location:"114,30"},{id:"CAKE",name:`${brand}(河西店)`,tag:"蛋糕店",location:"114,30"},{id:"WRONG",name:"普通便利店",tag:"超市",location:"114,30"}];
  const keywords:string[]=[];
  const r=await discoverBrandStores(async(_path,params)=>{keywords.push(String(params.keywords));return {pois:[...rows,rows[0]]}},brand,"测试市","测试区");
  assert.deepEqual(keywords,[brand]);assert.deepEqual(r.stores.map(s=>s.id),["SHOP"]);
  assert.equal(r.assessments?.length,3);assert.equal(r.assessments?.find(s=>s.id==="CAKE")?.decision,"待核实");
  assert.equal(r.assessments?.find(s=>s.id==="WRONG")?.decision,"排除");
 }
});
