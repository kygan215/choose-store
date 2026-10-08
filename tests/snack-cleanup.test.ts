import assert from "node:assert/strict";
import test from "node:test";
import { verifiedSnackDecision } from "../tools/reconcile-snack-library.js";
import { serializeBrandStore } from "../server/brand-library.js";

test("标签不足或详情缺失的已有门店保留待核验，不能仅凭标签删除",()=>{
  const poi={name:"好想来零食乐园",type:"购物服务;专卖店;专营店",typecode:"061200"};
  for(const candidate of [poi,null,{...poi,typecode:"未知"}]) {
    const result=verifiedSnackDecision("好想来",candidate);
    assert.equal(result.keep,true);
    assert.match(result.reason,/待核验/);
  }
  assert.equal(verifiedSnackDecision("好想来零食",{...poi,business:{keytag:"零食"}}).keep,true);
  assert.equal(verifiedSnackDecision("零食优选",{...poi,business:{keytag:"零食"}}).keep,true);
});

test("用户确认的日杂店及综合超市目标门店全部保留",()=>{
  for(const branch of ["苍溪城郊中学店","苍溪县汉水秀城店","苍溪元坝镇店","东城转盘店","东溪县店","红滨路店","江南半岛店","龙王沟店"]) {
    const poi={name:`零食有鸣批发超市(${branch})`,type:"购物服务;购物相关场所",typecode:"060000",business:{keytag:branch==="江南半岛店"?"综合超市":"日杂店"}};
    assert.equal(verifiedSnackDecision("零食有鸣",poi).keep,true,branch);
    assert.equal(serializeBrandStore({amap_name:poi.name,poi_type:poi.type,typecode:poi.typecode,raw_json:poi}).review_status,"已核验");
  }
});

test("仅明确无关证据允许清理，分店地标中的餐饮词不算证据",()=>{
  const poi={name:"好想来零食乐园",type:"购物服务;专卖店;专营店",typecode:"061200",business:{keytag:"零食"}};
  assert.equal(verifiedSnackDecision("好想来",{...poi,name:"好想来酱卤"}).keep,false);
  assert.equal(verifiedSnackDecision("好想来",{...poi,type:"餐饮服务;中餐厅",typecode:"050100"}).keep,true);
  assert.equal(verifiedSnackDecision("好想来",{...poi,name:"好想来(酱卤街店)"}).keep,true);
  assert.equal(verifiedSnackDecision("陆小馋",{...poi,name:"陆小馋量贩零食",type:"生活服务;生活服务场所;生活服务场所",typecode:"070000"}).keep,true);
});

test("历史标签缺失门店序列化显示待核验",()=>{
  assert.equal(serializeBrandStore({amap_name:"零食有鸣批发超市",poi_type:"购物服务",typecode:"060000",raw_json:{}}).review_status,"待核验");
});

test("品牌门店高德分类与商业标签冲突时保留待核验",()=>{
  for(const tag of ["零食","日杂店","综合超市","中餐",""]) {
    const poi={name:"陆小馋(南京浦口区花漾紫郡店)",type:"餐饮服务;中餐厅;中餐厅",typecode:"050100",business:{keytag:tag}};
    assert.equal(verifiedSnackDecision("陆小馋",poi).keep,true);
    assert.equal(serializeBrandStore({amap_name:poi.name,poi_type:poi.type,typecode:poi.typecode,raw_json:poi}).review_status,"待核验");
  }
});

test("地理位置在品牌名前或名称含公寓地标及公司全称时不误删",()=>{
  for(const name of ["厦门糖巢漳州高新区上街店","达埔五中糖巢店","好想来苏州昆山市锦溪镇惠峰公寓店","糖巢省钱超市集美珩崎公寓店","零食很能嗨昆明万达H公寓店","来伊份食品有限公司宜兴丁蜀镇宝龙广场(白宕北路店)"]) {
    assert.equal(verifiedSnackDecision("目标品牌",{name,type:"住宿服务;宾馆酒店",typecode:"100100"}).keep,true,name);
  }
});
