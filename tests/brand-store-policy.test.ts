import assert from "node:assert/strict";
import test from "node:test";
import { assessBrandStore, BRAND_IDENTITIES } from "../shared/brand-store-policy.js";
import { discoverBrandStores } from "../server/store-search.js";

test("13个品牌统一接受零食、超市、购物分类，裸品牌名称仍须外部证据",()=>{
  for(const brand of Object.keys(BRAND_IDENTITIES))for(const name of [brand,`${brand}(中心店)`,`${brand}超市（中心店）`,`${brand}便利店(中心店)`]){
    for(const extra of [{type:"购物服务"},{typecode:"060200"},{business:{keytag:"零食"}},{tag:"综合超市"}])
      assert.equal(assessBrandStore(brand,{name,id:"B",...extra}).decision,"接受",name);
    if(name===brand || name===`${brand}(中心店)`)
      assert.equal(assessBrandStore(brand,{name,id:"B"}).decision,"待核实",name);
  }
});
test("相似名称不自动收录，蛋糕明确排除，冲突证据待核验",()=>{
  for(const name of ["爱零食的喵(科技大学西门店)","我爱零食","我爱零食屋","最爱零食","爱零食小屋"])
    assert.equal(assessBrandStore("爱零食",{name,id:"B",type:"购物服务"}).decision,"排除",name);
  for(const name of ["爱零食中心店","爱零食·特卖","爱零食()","爱零食(店)","爱零食(中心店)特卖"])
    assert.equal(assessBrandStore("爱零食",{name,id:"B",type:"购物服务"}).decision,"待核实",name);
  assert.equal(assessBrandStore("糖巢",{name:"糖巢御品(三明店)",id:"B",type:"餐饮服务;糕饼店"}).decision,"排除");
  assert.equal(assessBrandStore("糖巢",{name:"糖巢(三明店)",id:"B",type:"购物服务;糕饼店"}).decision,"排除");
  assert.equal(assessBrandStore("糖巢",{name:"糖巢(三明店)",id:"B",type:"购物服务;糕饼店",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("零食很忙",{name:"零食很忙(中心店)",id:"B",type:"餐饮服务",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{name:"好像来(中心店)",id:"B",type:"购物服务"}).decision,"排除");
  assert.equal(assessBrandStore("赵一鸣零食",{name:"赵一鸣省钱超市(中心店)",id:"B",type:"购物服务"}).decision,"接受");
  for (const name of ["来优品品牌零食(康乐街店)", "来优品零食乐园(双港老街店)"])
    assert.equal(assessBrandStore("来优品",{name,id:"B",type:"购物服务"}).decision,"接受",name);
});
test("零售后缀后的无括号分店名与零食标签可以完成初筛",()=>{
  assert.equal(assessBrandStore("糖巢",{id:"B0L3SN1A0K",name:"糖巢省钱超市东新六路店",type:"购物服务;便民商店/便利店",tag:"便利店;便利店"}).decision,"接受");
  assert.equal(assessBrandStore("戴永红",{id:"B",name:"戴永红量贩零食中天广场店",type:"购物服务",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来·省钱超市(横沥田坑店)",type:"购物服务",tag:"综合超市"}).decision,"接受");
  assert.equal(assessBrandStore("爱零食",{id:"B",name:"爱零食中心店",type:"购物服务",tag:"零食"}).decision,"待核实");
  assert.equal(assessBrandStore("爱零食",{id:"B",name:"爱零食小屋店",type:"购物服务",tag:"零食"}).decision,"排除");
});
test("零食商业标签与高德旧分类冲突时，仅放行有明确零售证据的门店",()=>{
  assert.equal(assessBrandStore("糖巢",{id:"B0LGF5RX34",name:"糖巢零食(三明学院店)",type:"餐饮服务;糕饼店;糕饼店",typecode:"050800",tag:"零食;零食",business:{rectag:"零食",keytag:"零食"}}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(中心店)",type:"餐饮服务;餐饮相关场所;餐饮相关",typecode:"050000",tag:"零食;零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来",type:"餐饮服务;餐饮相关场所;餐饮相关",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(中心店)",type:"购物服务;专卖店;眼镜店|餐饮服务;餐饮相关场所;餐饮相关",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢(中心店)",type:"餐饮服务;糕饼店;糕饼店",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢(中心店)",type:"餐饮服务;糕饼店;糕饼店",tag:"零食;蛋糕"}).decision,"待核实");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(中心店)",type:"餐饮服务;中餐厅;中餐厅",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(中心店)",type:"餐饮服务;餐饮相关场所;餐饮相关",tag:"零食;面馆"}).decision,"排除");
});
test("真实待核验样本：零食超市和准确零食标签不应卡在名称或旧糕饼分类",()=>{
  for(const row of [
    {id:"B0LKZCEXQM",name:"糖巢零食超市(泰禾红峪店)",type:"购物服务;专卖店;专营店",tag:"零食;零食"},
    {id:"B0LKS5INHP",name:"糖巢省钱超市学府壹号店(金学东路店)",type:"购物服务;超级市场;超市",tag:"零食;零食"},
    {id:"B0L12RU4SC",name:"糖巢",type:"餐饮服务;糕饼店;糕饼店",typecode:"050800",tag:"零食"},
    {id:"B0L2MMZDHI",name:"糖巢零食超市(金霞路店)",type:"餐饮服务;糕饼店;糕饼店",typecode:"050800",tag:"零食;零食"},
  ])assert.equal(assessBrandStore("糖巢",row).decision,"接受",row.name);
  assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢朱砂店",type:"购物服务;专卖店;专营店",tag:"零食;零食"}).decision,"待核实");
  assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢果业(中心店)",type:"购物服务;综合市场;果品市场",tag:"零食"}).decision,"排除");
});
test("零食标签和购物分类明确时识别品牌主体后的无括号地标分店",()=>{
  assert.equal(assessBrandStore("戴永红",{id:"B",name:"戴永红文星门路店",type:"购物服务;专卖店;专营店",tag:"零食;零食"}).decision,"接受");
  assert.equal(assessBrandStore("零食悦",{id:"B",name:"零食悦锦粼天序店",type:"购物服务;专卖店;专营店",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("爱零食",{id:"B",name:"爱零食中心店",type:"购物服务;专卖店;专营店",tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("戴永红",{id:"B",name:"戴永红文星门路店",type:"购物服务;专卖店;专营店"}).decision,"待核实");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来台球店",type:"购物服务;专卖店;专营店",tag:"零食"}).decision,"排除");
});
test("品牌名称后只有地址括号时，购物分类与零食标签可完成初筛",()=>{
  const shopping = "购物服务;购物相关场所;购物相关场所";
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(胜利北路)",type:shopping,tag:"零食;零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(广西南宁仓)",type:shopping,tag:"零食;零食"}).decision,"排除");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(暂停营业)",type:shopping,tag:"零食;零食"}).decision,"排除");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(凯升公馆店)(暂停营业)",type:shopping,tag:"零食;零食"}).decision,"排除");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(凯升公馆店)(装修中)",type:shopping,tag:"零食;零食"}).decision,"排除");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(即将开业)",type:shopping,tag:"零食;零食"}).decision,"排除");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(凯升公馆店)",type:shopping,tag:"零食;零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(暂停营业)",type:shopping,tag:"零食;零食"},"accept").decision,"排除");
  assert.equal(assessBrandStore("爱零食",{id:"B",name:"爱零食(胜利北路)",type:shopping,tag:"零食"}).decision,"接受");
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来品牌零食(胜利北路)",type:"餐饮服务;中餐厅;中餐厅",tag:"零食"}).decision,"待核实");
});

test("规范连锁名称优先于高德泛类或错类，明确异业和近似品牌仍排除",()=>{
  const examples: Array<[string,string,string,string,string,string,"接受"|"排除"]> = [
    ["好想来","B0KAFCIF0Y","好想来品牌零食店(恒太城店)","购物服务;专卖店;专营店","061200","零食;零食","接受"],
    ["好想来","B0LK0D7FD2","好想来省钱超市(保定定州东亭镇店)(保定定州市东亭镇店)","购物服务;购物相关场所;购物相关场所","060000","零食;零食","接受"],
    ["爱零食","B0IDUDSVCD","爱零食-花明楼店","购物服务;购物相关场所;购物相关场所","060000","零食;零食","接受"],
    ["赵一鸣零食","B0J6KHAXLO","赵一鸣零食店","购物服务;专卖店;专营店","061200","零食;零食","接受"],
    ["零食有鸣","B0KA3ZSKEJ","零食有鸣MAX(建设路店)","购物服务;购物相关场所;购物相关场所","060000","零食;零食","接受"],
    ["好想来","B0KDY7W906","好像来品牌零食(保定朝阳南大街店)","购物服务;购物相关场所;购物相关场所","060000","零食;零食","排除"],
    ["好想来","B0MG4SWQCD","(好想来钓鱼)休闲娱乐钓场","体育休闲服务;休闲场所;垂钓园","080502","垂钓园;垂钓园","排除"],
    ["好想来","B0MDVDNH0C","好想来(丘集店)","餐饮服务;中餐厅;中餐厅","050100","零食;零食","接受"],
    ["好想来","B0JDAZAI65","好想来零食乐园(临沂兰山区义堂镇店)","公司企业;工厂;工厂|购物服务;购物相关场所;购物相关场所","170300|060000","好想来;零食","接受"],
    ["好想来","B0L2JL7DBO","好想来品牌零食(保利·紫荆公馆店)","住宿服务;住宿服务相关;住宿服务相关","100000","住宿服务,住宿服务相关,住宿服务相关","接受"],
    ["好想来","B0MGBHTMCZ","好想来","体育休闲服务;娱乐场所;棋牌室","080306","棋牌室","排除"],
    ["好想来","B0K2JS5NT6","好想来(南通启东市东海镇店)","生活服务;生活服务场所;生活服务场所","070000","生活服务,生活服务场所,生活服务场所","接受"],
    ["好想来","B0K3J1GIHR","好想来(台州温岭市泽国镇牧南店)","生活服务;生活服务场所;生活服务场所","070000","生活服务,生活服务场所,生活服务场所","接受"],
    ["好想来","B0MUBR80KO","好想来省钱超市(咸阳秦都区福园巷子店)","生活服务;生活服务场所;生活服务场所","070000","","接受"],
    ["好想来","B0MDRZACY7","好想来零食乐园(威海环翠区华发新天地店)","生活服务;生活服务场所;生活服务场所","070000","","接受"],
    ["好想来","B0K16ZU8JN","好想来零食乐园(广州天河区凌塘村店)","生活服务;生活服务场所;生活服务场所","070000","","接受"],
    ["好想来","B0JKTS6029","好想来零食乐园(泉州安溪县特产城店)","生活服务;生活服务场所;生活服务场所","070000","","接受"],
    ["来优品","B0J0MZZE6N","来优品品牌零食(宿州泗县四洲步行街店)","生活服务;生活服务场所;生活服务场所","070000","","接受"],
    ["陆小馋","B0I1FHMVI8","陆小馋量贩零食(南京溧水区珍珠南路弯子口店)","生活服务;生活服务场所;生活服务场所","070000","","接受"],
  ];
  for(const [brand,id,name,type,typecode,tag,decision] of examples)
    assert.equal(assessBrandStore(brand,{id,name,type,typecode,tag}).decision,decision,`${id} ${name}`);
});
test("名称主体明确是台球、洗衣或果业时不留在待核验",()=>{
  for(const name of ["好想来台球","好想来台球俱乐部","好想来台球棋牌","好想来国际洗衣","糖巢果业"])
    assert.equal(assessBrandStore(name.startsWith("糖巢")?"糖巢":"好想来",{id:"B",name,type:"购物服务;专卖店;专营店",tag:"零食"}).decision,"排除",name);
  assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来(台球馆旁店)",type:"购物服务;专卖店;专营店",tag:"零食"}).decision,"接受");
});
test("明确的面馆、足浴和生鲜超市分类直接排除，普通购物仍可接受",()=>{
 const examples=[
  {brand:"好想来",name:"好想来肉浇面",type:"餐饮服务;中餐厅;中餐厅",typecode:"050100",tag:"面馆;面馆"},
  {brand:"好想来",name:"好想来足道",type:"生活服务;洗浴推拿场所;洗浴推拿场所",typecode:"071400",tag:"足疗;足疗"},
  {brand:"老婆大人",name:"老婆大人生鲜超市",type:"购物服务;专卖店;专营店",typecode:"061200",tag:"生鲜超市;生鲜超市"},
 ];
 for(const row of examples)assert.equal(assessBrandStore(row.brand,{...row,id:"B"}).decision,"排除",row.name);
 for(const row of examples)assert.equal(assessBrandStore(row.brand,{...row,id:"B"},"accept").decision,"排除",`人工白名单不可覆盖非目标业态：${row.name}`);
 for(const row of [
  {brand:"好想来",name:"好想来(中心店)",type:"餐饮服务;中餐厅;中餐厅",tag:"面馆"},
  {brand:"好想来",name:"好想来(中心店)",type:"购物服务",tag:"足疗"},
  {brand:"老婆大人",name:"老婆大人(中心店)",type:"购物服务",tag:"生鲜超市"},
 ])assert.equal(assessBrandStore(row.brand,{...row,id:"B"}).decision,"排除",`具体非目标标签优先：${row.tag}`);
 assert.equal(assessBrandStore("来优品",{id:"B",name:"来优品零食(泉山湖店)",type:"购物服务;综合市场;蔬菜市场|购物服务;专卖店;专营店",tag:"零食;零食"}).decision,"待核实","明确零食标签与蔬菜市场分类冲突时保留人工核验");
 assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来(中心店)",type:"购物服务;购物相关场所"}).decision,"接受");
 assert.equal(assessBrandStore("好想来",{id:"B",name:"好想来(中心店)",type:"购物服务;超级市场;综合超市"}).decision,"接受");
});
test("8家已确认零食有鸣超市和分店餐馆、公寓地标不误判",()=>{
 for(const branch of ["苍溪城郊中学店","苍溪县汉水秀城店","苍溪元坝镇店","东城转盘店","东溪县店","红滨路店","江南半岛店","龙王沟店","公寓店","幸福蛋糕店旁店"]){
  assert.equal(assessBrandStore("零食有鸣",{id:"B",name:`零食有鸣批发超市(${branch})`,typecode:"060000",tag:"日杂店"}).decision,"接受",branch);
 }
});
test("人工确认名称不能绕过标签门槛，黑名单优先，无ID仍待核验",()=>{
 assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢·特卖"},"accept").decision,"待核实");
 assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢·特卖",type:"购物服务"},"accept").decision,"接受");
 assert.equal(assessBrandStore("糖巢",{id:"B",name:"糖巢",type:"购物服务"},"exclude").decision,"排除");
 assert.equal(assessBrandStore("糖巢",{name:"糖巢",type:"购物服务"},"accept").decision,"待核实");
});
test("品牌发现统一保存候选、按POI去重、默认只输出接受，旧别名不能绕过规则",async()=>{
 const rows=[{id:"GOOD",name:"爱零食硬折扣超市(横州新福店)",type:"购物服务"},{id:"PENDING",name:"爱零食(中心店)"},{id:"CAKE",name:"爱零食蛋糕店",type:"购物服务"}].map(row=>({...row,location:"114,30"}));
 const result=await discoverBrandStores(async()=>({pois:[...rows,rows[0]]}),"爱零食","测试市","测试区");
 assert.deepEqual(result.stores.map(row=>row.id),["GOOD"]);assert.equal(result.assessments?.length,3);
 const alias=await discoverBrandStores(async()=>({pois:[{id:"OLD",name:"好像来(中心店)",type:"购物服务",location:"114,30"}]}),"好想来零食","测试市","测试区");
  assert.equal(alias.stores.length,0);assert.equal(alias.assessments?.[0]?.decision,"排除");
});
test("品牌库检索只使用系统确认的品牌主体名称，新增别名不绕过名称与标签筛选",async()=>{
 for(const [brand,names] of Object.entries(BRAND_IDENTITIES)){
  const keywords:string[]=[];
  await discoverBrandStores(async(path,params)=>{if(path==="/v5/place/text")keywords.push(String(params.keywords));return {pois:[]}},brand,"测试市","测试区",{aliases:["任意相似名称"],maxPagesPerRegion:1});
  assert.deepEqual(keywords,names,brand);
 }
});
