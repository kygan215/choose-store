import assert from "node:assert/strict";
import test from "node:test";
import { verifiedSnackDecision } from "../tools/reconcile-snack-library.js";

test("清理依据回查到的高德标签，品牌名称不能替代标签",()=>{
  const poi={name:"好想来零食乐园",type:"购物服务;专卖店;专营店",typecode:"061200"};
  assert.equal(verifiedSnackDecision("好想来",poi).keep,false);
  assert.equal(verifiedSnackDecision("好想来零食",{...poi,business:{keytag:"零食"}}).keep,true);
  assert.equal(verifiedSnackDecision("好想来",{...poi,name:"好想来酱卤",business:{keytag:"零食"}}).keep,false);
  assert.equal(verifiedSnackDecision("零食优选",{...poi,business:{keytag:"零食"}}).keep,false);
  assert.equal(verifiedSnackDecision("好想来",null).keep,false);
});

test("清理保留带零食标签的通用生活服务门店，排除具体餐饮分类",()=>{
  const poi={name:"陆小馋量贩零食",type:"生活服务;生活服务场所;生活服务场所",typecode:"070000",business:{keytag:"零食"}};
  assert.equal(verifiedSnackDecision("陆小馋",poi).keep,true);
  assert.equal(verifiedSnackDecision("陆小馋",{...poi,type:"餐饮服务;中餐厅",typecode:"050100"}).keep,false);
});
