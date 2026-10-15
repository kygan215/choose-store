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

test("好特卖 HotMaxx 完整主体按标准分店和购物证据初筛，服装子类错标不阻断",()=>{
 const accepted=[
  {name:"好特卖HotMaxx(保丽国际广场店)",type:"购物服务;便民商店/便利店;便民商店/便利店",tag:"零食"},
  {name:"好特卖 HotMaxx（凯德1818店）",type:"购物服务;超级市场;超市",tag:"零食"},
  {name:"好特卖 HOTMAXX(星汇维港购物中心店)",type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店",tag:"服饰鞋包"},
  {name:"好特卖HotMaxx",type:"购物服务;购物相关场所;购物相关场所",tag:"服饰鞋包"},
 ];
 for(const row of accepted)assert.equal(assessBrandStore("好特卖",{id:"HOTMAXX",...row}).decision,"接受",row.name);
 for(const row of [
  {name:"好特卖HotMaxx(中心店)",type:"购物服务;购物相关场所;购物相关场所",tag:"按摩"},
  {name:"好特卖HotMaxx(中心店)",type:"公司企业;公司;公司",tag:"公司"},
  {name:"好特卖HotMaxx(中心店)",type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店",tag:"医疗"},
 ])assert.equal(assessBrandStore("好特卖",{id:"CONFLICT",...row}).decision,"待核实",`${row.name}/${row.tag}`);
 for(const name of ["好特卖HotMaxx(配送仓库)","好特卖HotMaxx(中心店)(装修中)","好特卖HotMaxx按摩店"])
  assert.equal(assessBrandStore("好特卖",{id:"HARD",name,type:"购物服务",tag:"零食"}).decision,"排除",name);
 for(const name of ["某服装店好特卖HotMaxx(中心店)","其他HotMaxx(中心店)","好特卖HotMaxx随意后缀"])
  assert.notEqual(assessBrandStore("好特卖",{id:"LOOKALIKE",name,type:"购物服务",tag:"零食"}).decision,"接受",name);
 assert.equal(assessBrandStore("好特卖",{id:"REVERSE",name:"HotMaxx好特卖(万科未来中心店)",type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店",tag:"零食"}).decision,"待核实");
 assert.equal(assessBrandStore("好特卖",{id:"MANUAL",name:"好特卖HotMaxx(中心店)",type:"购物服务"},"exclude").decision,"排除");
 assert.equal(assessBrandStore("好特卖",{name:"好特卖HotMaxx(中心店)",type:"购物服务"}).decision,"待核实");
});

test("好特卖 HotMaxx 名称识别不扩大高德搜索关键词",async()=>{
 const keywords:string[]=[];
 await discoverBrandStores(async(_path,params)=>{keywords.push(String(params.keywords));return {pois:[]}},"好特卖","测试市","测试区");
 assert.deepEqual(keywords,["好特卖"]);
});

test("好特卖 HotMaxx 括号中纯异业店型优先排除，不误伤地标分店",()=>{
 for(const branch of ["按摩店","蛋糕店","医院店","女装店","按摩养生店","蛋糕烘焙店","女装折扣店"]){
  const name=`好特卖HotMaxx(${branch})`;
  const result=assessBrandStore("好特卖",{id:"WRONG-BRANCH",name,type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店",tag:"服饰鞋包"});
  assert.equal(result.decision,"排除",name);
  assert.match(result.decision_reason,/异业店型/,name);
 }
 for(const branch of ["人民医院店","总部公园店","物流园店","女装街店"]){
  const name=`好特卖HotMaxx(${branch})`;
  const result=assessBrandStore("好特卖",{id:"LANDMARK",name,type:"购物服务;购物相关场所;购物相关场所",tag:"零食"});
  assert.notEqual(result.decision,"排除",name);
 }
 assert.equal(assessBrandStore("好特卖",{id:"MANUAL",name:"好特卖HotMaxx(按摩店)",type:"购物服务",tag:"零食"},"accept").decision,"排除");
});

test("好特卖 HotMaxx 单层无店字商场地标须同时有购物大类与06编码",()=>{
 for(const landmark of ["万优汇","五月花商业广场","广州塔广场","广百展贸","新天泽国际广场","湾里·王府井WellTown"]){
  const name=`好特卖HotMaxx(${landmark})`;
  assert.equal(assessBrandStore("好特卖",{id:"MALL",name,type:"购物服务;购物相关场所;购物相关场所",typecode:"060000"}).decision,"接受",name);
 }
 for(const row of [
  {name:"好特卖HotMaxx(万优汇)",type:"购物服务;购物相关场所;购物相关场所",typecode:""},
  {name:"好特卖HotMaxx(万优汇)",type:"生活服务;生活服务场所;生活服务场所",typecode:"060000"},
  {name:"好特卖HotMaxx(普通居民楼)",type:"购物服务;购物相关场所;购物相关场所",typecode:"060000"},
  {name:"好特卖HotMaxx(万优汇)(分店)",type:"购物服务;购物相关场所;购物相关场所",typecode:"060000"},
  {name:"HotMaxx好特卖(万优汇)",type:"购物服务;购物相关场所;购物相关场所",typecode:"060000"},
 ])assert.notEqual(assessBrandStore("好特卖",{id:"NARROW",...row}).decision,"接受",row.name);
 assert.equal(assessBrandStore("好特卖",{name:"好特卖HotMaxx(万优汇)",type:"购物服务",typecode:"060000"}).decision,"待核实");
});

test("HotMaxx好特卖完整逆序双标识仅凭购物06自动纳入，错标仍待核",()=>{
 for(const row of [
  {name:"HotMaxx好特卖",type:"购物服务;超级市场;超市",typecode:"060400"},
  {name:"HotMaxx好特卖(恒越荣欣广场5号楼店)",type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店",typecode:"061100",business:{rectag:"超市"}},
  {name:"Hotmaxx好特卖",type:"购物服务;购物相关场所;购物相关场所",typecode:"060000"},
 ])assert.equal(assessBrandStore("好特卖",{id:"REVERSE-06",...row}).decision,"接受",row.name);
 assert.equal(assessBrandStore("好特卖",{id:"DAILY",name:"Hotmaxx好特卖(荃锦中心店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店",keytag:"日杂店"}}).decision,"待核实");
 for(const name of ["HotMax好特卖(中心店)","HatMaxx好特卖(中心店)","某HotMaxx好特卖(中心店)"])
  assert.notEqual(assessBrandStore("好特卖",{id:"WRONG",name,type:"购物服务;购物相关场所;购物相关场所",typecode:"060000"}).decision,"接受",name);
 assert.equal(assessBrandStore("好特卖",{id:"NO-CODE",name:"HotMaxx好特卖(中心店)",type:"购物服务",tag:"零食"}).decision,"待核实");
});

test("好特卖 HotMaxx 正序单个标准分店仅豁免日杂店误标",()=>{
 for(const row of [
  {name:"好特卖HotMaxx(万达广场店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店",keytag:"日杂店"}},
  {name:"好特卖HotMaxx(上海中信泰富万达广场店)",type:"购物服务;超级市场;超市",typecode:"060400",business:{rectag:"日杂店"}},
  {name:"好特卖HotMaxx(上海漫乐城店)",type:"购物服务;服装鞋帽皮具店;服装鞋帽皮具店|购物服务;便民商店/便利店;便民商店/便利店",typecode:"061100|060200",business:{rectag:"日杂店"}},
 ])assert.equal(assessBrandStore("好特卖",{id:"DAILY",...row}).decision,"接受",row.name);
 for(const row of [
  {name:"好特卖HotMaxx(密云国泰百货店)",type:"购物服务;化妆品店;化妆品店",typecode:"061400",business:{rectag:"化妆品"}},
  {name:"好特卖HotMaxx(中心店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店;按摩"}},
  {name:"好特卖HotMaxx(中心店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店;公司"}},
  {name:"好特卖HotMaxx(中心店)",type:"购物服务;购物相关场所;购物相关场所|公司;公司;公司",typecode:"060000",business:{rectag:"日杂店"}},
  {name:"好特卖HotMaxx(中心店)",type:"生活服务;生活服务场所;生活服务场所",typecode:"060200",business:{rectag:"日杂店"}},
  {name:"好特卖HotMaxx(中心店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"070000",business:{rectag:"日杂店"}},
  {name:"HotMaxx好特卖(中心店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店"}},
  {name:"好特卖HotMaxx(万优汇)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店"}},
  {name:"好特卖HotMaxx(中心店)(二店)",type:"购物服务;便民商店/便利店;便民商店/便利店",typecode:"060200",business:{rectag:"日杂店"}},
 ])assert.equal(assessBrandStore("好特卖",{id:"BOUNDARY",...row}).decision,"待核实",`${row.name}/${row.business.rectag}`);
 assert.equal(assessBrandStore("好特卖",{id:"HARD",name:"好特卖HotMaxx(按摩店)",type:"购物服务",typecode:"060200",business:{rectag:"日杂店"}}).decision,"排除");
});

test("好特卖折扣仓超市、折扣仓储超市及临期超市仅凭购物06加超市标签初筛",()=>{
 for(const name of ["好特卖折扣仓超市(兴隆路店)","好特卖折扣仓储超市","好特卖临期超市"]){
  assert.equal(assessBrandStore("好特卖",{id:"MARKET",name,type:"购物服务;超级市场;超市",typecode:"060400",business:{rectag:"超市"}}).decision,"接受",name);
  assert.equal(assessBrandStore("好特卖",{id:"NO-SUPER",name,type:"购物服务;超级市场;超市",typecode:"060400",business:{rectag:"服饰鞋包"}}).decision,"待核实",`${name}/无超市标签`);
  assert.equal(assessBrandStore("好特卖",{id:"NO-CODE",name,type:"购物服务;超级市场;超市",business:{rectag:"超市"}}).decision,"待核实",`${name}/无06编码`);
 }
 for(const name of ["好特卖折扣仓","好特卖折扣仓(万达广场店)"])
  assert.equal(assessBrandStore("好特卖",{id:"WAREHOUSE",name,type:"购物服务;超级市场;超市",typecode:"060400",business:{rectag:"超市"}}).decision,"排除",name);
});

test("零食优选只是其他店名的后缀时直接排除，疑似地名前缀保留核验",()=>{
 for(const name of [
  "三毛零食优选(船民新村店)",
  "乐购乐零食优选生活超市(虎尾街店)",
  "省钱超市零食优选(闸口乡店)",
  "百草味·零食优选(天阳小河路店)",
  "勐腊欣果铺子水果零食优选",
 ]){
  const result=assessBrandStore("零食优选",{id:"OTHER-SHOP",name,type:"购物服务;专卖店;专营店",tag:"零食"});
  assert.equal(result.decision,"排除",name);
  assert.match(result.decision_reason,/其他店名/,name);
 }
 for(const name of [
  "巩营乡李安村-零食优选",
  "沅陵县五强溪零食优选店",
  "衡阳零食优选金钟大雁城店",
  "重庆秀山零食优选时代帝都店",
  "滇南零食优选",
 ]){
  assert.equal(assessBrandStore("零食优选",{id:"PLACE",name,type:"购物服务;专卖店;专营店",tag:"零食"}).decision,"待核实",name);
 }
 assert.equal(assessBrandStore("零食优选",{id:"BRAND",name:"零食优选(中心店)",tag:"零食"}).decision,"接受");
 assert.equal(assessBrandStore("零食优选",{id:"PLACE-BRANCH",name:"古现零食优选量贩零食(中心店)",tag:"零食"}).decision,"接受");
 assert.equal(assessBrandStore("爱零食",{id:"OVERLAP",name:"爱零食优选(市场街店)",tag:"零食"}).decision,"待核实");
 assert.equal(assessBrandStore("零食优选",{id:"MANUAL",name:"三毛零食优选(船民新村店)",tag:"零食"},"accept").decision,"接受");
});

test("零食优选省钱便利的规范门店名称按购物证据初筛，硬冲突和非门店主体不放行",()=>{
 for(const tag of ["零食","便利店"]){
  assert.equal(assessBrandStore("零食优选",{id:"SAVE",name:"零食优选省钱便利(人民路店)",type:"购物服务;便民商店/便利店;便民商店/便利店",tag}).decision,"接受",tag);
 }
 for(const name of ["零食优选省钱便利", "零食优选省钱便利蛋糕店", "零食优选省钱便利(装修中店)"]){
  assert.notEqual(assessBrandStore("零食优选",{id:"ODD",name,type:"购物服务",tag:"零食"}).decision,"接受",name);
 }
 assert.equal(assessBrandStore("零食优选",{id:"LABEL",name:"零食优选省钱便利(人民路店)",type:"购物服务",tag:"日杂店"}).decision,"待核实");
 for(const name of ["零食优选(四川分公司)","零食优选(重庆分公司)","零食优选(北京)食品集团有限公司","零食优选工厂"]){
  assert.equal(assessBrandStore("零食优选",{id:"NONSTORE",name,type:"购物服务",tag:"零食"}).decision,"排除",name);
  assert.equal(assessBrandStore("零食优选",{id:"NONSTORE",name,type:"购物服务",tag:"零食"},"accept").decision,"排除",`${name}/人工纳入`);
 }
 for(const name of ["零食优选(电信分公司宿舍店)","零食优选(总部公园店)"]){
  assert.notEqual(assessBrandStore("零食优选",{id:"LANDMARK",name,type:"购物服务",tag:"零食"}).decision,"排除",name);
 }
});

test("零食优选招商花园城分店作为单个地标例外，仍须购物06且无冲突",()=>{
 const name="零食优选省钱超市(招商·花园城锦园店)";
 assert.equal(assessBrandStore("零食优选",{id:"MALL",name,type:"购物服务;专卖店;专营店",typecode:"061200",business:{rectag:"零食"}}).decision,"接受");
 assert.equal(assessBrandStore("零食优选",{id:"NO-CODE",name,type:"购物服务;专卖店;专营店",business:{rectag:"零食"}}).decision,"待核实");
 assert.equal(assessBrandStore("零食优选",{id:"DAILY",name,type:"购物服务;专卖店;专营店",typecode:"061200",business:{rectag:"日杂店"}}).decision,"待核实");
 assert.equal(assessBrandStore("零食优选",{id:"DIFFERENT",name:"零食优选省钱超市(招商办公室店)",type:"购物服务;专卖店;专营店",typecode:"061200",business:{rectag:"零食"}}).decision,"待核实");
});

test("前置括号地标不遮蔽真实主店名，加一加异业后缀直接排除",()=>{
 for(const row of [
  {name:"(太平洋房屋)南投加盟店",type:"生活服务;中介机构;中介机构",typecode:"071600"},
  {name:"(台塑)台亚汐止新台五一加油站",type:"汽车服务;加油站;加油站",typecode:"010100"},
  {name:"(一口香豆乳鸡加盟店)鸡排豆乳鸡炸物",type:"餐饮服务;餐饮相关场所;餐饮相关",typecode:"050000"},
 ]){
  const result=assessBrandStore("加一加",{id:"PAREN",...row});
  assert.equal(result.decision,"排除",row.name);
  assert.equal(result.decision_reason,"名称主体没有目标品牌依据；其他品牌、普通店名或仅地标命中，不按该品牌收录",row.name);
 }
 assert.equal(assessBrandStore("加一加",{id:"LANDMARK",name:"(商场名)加一加零食店",tag:"零食"}).decision,"待核实");
 for(const name of ["加一加水电","杭州萧山加一加卫浴工厂"]){
  assert.equal(assessBrandStore("加一加",{id:"UNRELATED",name,type:"生活服务",tag:"购物"}).decision,"排除",name);
 }
});
