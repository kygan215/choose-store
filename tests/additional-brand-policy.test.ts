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
test("新增品牌搜索使用品牌本名、去重，并应用各品牌确认的标签边界",async()=>{
 for(const brand of CONFIRMED_ADDITIONAL_BRANDS){
  const rows=[{id:"SHOP",name:`${brand}量贩零食(中心店)`,tag:"零食",location:"114,30"},{id:"CAKE",name:`${brand}(河西店)`,tag:"蛋糕店",location:"114,30"},{id:"WRONG",name:"普通便利店",tag:"超市",location:"114,30"}];
  const keywords:string[]=[];
  const r=await discoverBrandStores(async(_path,params)=>{keywords.push(String(params.keywords));return {pois:[...rows,rows[0]]}},brand,"测试市","测试区");
  assert.deepEqual(keywords,[brand]);assert.deepEqual(r.stores.map(s=>s.id).sort(),brand==="优味多"?["CAKE","SHOP"]:["SHOP"]);
  assert.equal(r.assessments?.length,3);assert.equal(r.assessments?.find(s=>s.id==="CAKE")?.decision,brand==="优味多"?"接受":"待核实");
  assert.equal(r.assessments?.find(s=>s.id==="WRONG")?.decision,"排除");
 }
});
test("优味多标准分店名优先于普通餐饮标签，保留明显异业、无证据及无关名称边界",()=>{
 for(const name of ["优味多橡树湾店","优味多郧阳滨江花园店","优味多(柳林沟口店)","优味多（芳华里小区店）","优味多鄂西北批发市场店"]){
  for(const tag of ["早餐","小吃快餐","西式糕点","农副产品"]){assert.equal(assessBrandStore("优味多",{id:"PRIORITY",name,type:"餐饮服务;糕饼店;糕饼店",tag}).decision,"接受",`${name}/${tag}`);}
  for(const tag of ["按摩","中医馆","公司","住宅区"]){assert.equal(assessBrandStore("优味多",{id:"PRIORITY",name,tag}).decision,"待核实",`${name}/${tag}`);}
  assert.equal(assessBrandStore("优味多",{id:"PRIORITY",name}).decision,"待核实");
  assert.equal(assessBrandStore("优味多",{id:"PRIORITY",name,tag:"早餐"},"exclude").decision,"排除");
 }
 for(const name of ["优味多(火车站广场店30)","优味多(俊发家居)","山水龙城优味多","优味多陌生后缀","优味多(店)"]){assert.notEqual(assessBrandStore("优味多",{id:"ODD",name,tag:"早餐"}).decision,"接受",name);}
 for(const name of ["优味多蛋糕店","优味多按摩店","优味多(配送仓库)","优味多(中心店)(装修中)","优味多(中心店)(暂停营业)"]){assert.equal(assessBrandStore("优味多",{id:"WRONG",name,tag:"零食"}).decision,"排除",name);}
 assert.notEqual(assessBrandStore("优味多",{id:"CROSS",name:"优味多吃货基地中心店",tag:"早餐"}).decision,"接受");
 assert.equal(assessBrandStore("优味多",{id:"CODE",name:"优味多(中心店)",typecode:"050800"}).decision,"接受");
 assert.equal(assessBrandStore("优味多",{id:"CODE",name:"优味多(中心店)",typecode:"090000"}).decision,"待核实");
 assert.equal(assessBrandStore("优味多",{name:"优味多(中心店)",tag:"早餐"}).decision,"待核实");
});
