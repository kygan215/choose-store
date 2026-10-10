import { assessBrandStore } from "../shared/brand-store-policy.js";
import assert from "node:assert/strict";
import test from "node:test";
import { assessAilingshi, normalizeAilingshiName } from "../shared/ailingshi.js";
import { discoverBrandStores } from "../server/store-search.js";
import { canRetainSnackStore } from "../server/snack-retail.js";

export const ailingshiCases = [
  ...["爱零食的喵(科技大学西门店)","我爱零食","我爱零食屋","最爱零食","爱零食小屋","爱零食硬折扣超市(横州新福店)","爱零食便利店(文岭街店)","爱零食超市(中心店)","爱零食(超市店)"].map(name=>({name,decision:"排除"})),
  ...["爱零食","爱零食(中心店)","爱零食（中心店）","爱零食量贩零食(中心店)","爱零食量贩零食店(中心店)","　爱零食（中心店）　"].map(name=>({name,decision:"接受"})),
  ...["爱零食中心店","爱零食·特卖","爱零食()","爱零食(店)","爱零食(中心)","爱零食(中心店)特卖","爱零食量贩零食","爱零食量贩零食店","爱零食旗舰(中心店)","爱零食((中心店))","爱零食(中心店)(分店)","其他名称"].map(name=>({name,decision:"待核实"})),
];
test("爱零食按排除优先和完整名称规则判断用户示例及边界",()=>{
  for(const {name,decision} of ailingshiCases){const result=assessAilingshi(name,"POI1");assert.equal(result.decision,decision,name);assert.equal(result.original_name,name);assert.ok(result.decision_reason);assert.equal(canRetainSnackStore({id:"POI1",name},"爱零食"),decision==="接受")}
  assert.equal(normalizeAilingshiName("　爱零食（Ａ店），。；：！　"),"爱零食(A店),.;:!");
  assert.equal(assessAilingshi("爱零食","").decision,"待核实");
  assert.equal(assessAilingshi("爱零食小屋","POI1","accept").decision,"接受");
  assert.equal(assessAilingshi("爱零食","POI1","exclude").decision,"排除");
  assert.equal(assessAilingshi("爱零食","","accept").decision,"待核实");
  assert.equal(assessAilingshi("爱零食(  店)","B").decision,"待核实");
});
test("关键词保持爱零食、同POI去重，输出所有判断但默认门店只有接受结果",async()=>{
  const queries:string[]=[];
  const raw=ailingshiCases.map((item,i)=>({id:`B${i}`,name:item.name,address:`地址${i}`,location:"114,30",cityname:"测试市",business:{keytag:"零食"}}));
  const result=await discoverBrandStores(async(_path,params)=>{queries.push(String(params.keywords));return {pois:[...raw.slice(0,12),raw[0],{id:"NOLOC",name:"爱零食·特卖",address:"无坐标"}]};},"爱零食","测试市","测试区",{aliases:["我爱零食"]});
  assert.deepEqual(queries,["爱零食"]);
  assert.equal(result.assessments?.length,13);
  assert.equal(result.assessments?.find(row=>row.id==="NOLOC")?.decision,"待核实");
  assert.equal(result.stores.length,7);
  assert.ok(result.stores.every(row=>assessBrandStore("爱零食",row).decision==="接受"));
});
test("后续检索严格沿用POI白黑名单，不扩大到同名其他POI",async()=>{
  const rows=[{id:"WHITE",name:"未确认前缀爱零食·特卖"},{id:"OTHER",name:"未确认前缀爱零食·特卖"},{id:"BLACK",name:"爱零食(中心店)"}].map(row=>({...row,location:"114,30",type:"购物服务"}));
  const result=await discoverBrandStores(async()=>({pois:rows}),"爱零食","测试市","测试区",{overrides:{WHITE:"accept",BLACK:"exclude"}});
  assert.deepEqual(result.stores.map(row=>row.id),["WHITE"]);
  assert.deepEqual(result.assessments?.map(row=>row.decision),["接受","待核实","排除"]);
});
test("同一POI重复结果的名称发生变化时，默认门店与判断记录一致",async()=>{
 const result=await discoverBrandStores(async()=>({pois:[{id:"B",name:"爱零食",location:"114,30"},{id:"B",name:"爱零食小屋",location:"114,30"}]}),"爱零食","测试市","测试区");
 assert.equal(result.assessments?.length,1);assert.equal(result.assessments?.[0].decision,"排除");assert.equal(result.stores.length,0);
});
