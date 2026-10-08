import assert from "node:assert/strict";
import test from "node:test";
import { amapPlaceUrl, amapTel, matchedAmapTel } from "../app/amap-contact.js";
import { buildStoreSearchPlan, discoverBrandStores, scoreStoreCandidate } from "../server/store-search.js";
import { BRAND_EXPORT_FIELDS, serializeBrandStore } from "../server/brand-library.js";

const poi = {id:"B0JDDAXLEH",name:"陆小馋量贩零食(南京建邺区应天大街店)",location:"118.75,32.02",type:"购物服务;专卖店;专营店",typecode:"061200",cityname:"南京市",adname:"建邺区",business:{tel:"4000107777",keytag:"零食",rating:"3.8"}};

test("门店搜索和品牌库保留高德联系电话", async () => {
  const candidate = scoreStoreCandidate(poi, buildStoreSearchPlan(poi.name, "南京市", "建邺区"));
  assert.equal(candidate?.tel, "4000107777");
  const result = await discoverBrandStores(async (_path, params) => {
    assert.match(String(params.show_fields), /business/);
    return {pois:[poi]};
  }, "陆小馋", "南京市", "建邺区");
  assert.equal(result.stores[0].tel, "4000107777");
  assert.equal(serializeBrandStore({raw_json:JSON.parse(JSON.stringify(result.stores[0]))}).tel, "4000107777");
  assert.ok(BRAND_EXPORT_FIELDS.some(field => field.id === "tel" && field.label === "门店电话"));
});

test("空电话不变成字符串，多号码保留区号和分机，兼容旧版字段", () => {
  for (const tel of [undefined, null, [], {}, "", "[]", "--", "暂无", 0]) {
    assert.equal(amapTel({business:{tel}}), null);
  }
  assert.equal(amapTel({business:{tel:" 025-12345678转801 ; 4000107777;025-12345678转801 "}}), "025-12345678转801；4000107777");
  assert.equal(amapTel({business:{tel:[]},tel:"025-12345678"}), "025-12345678");
  assert.equal(serializeBrandStore({raw_json:{}}).tel, null);
});

test("确认其他候选后只能使用所选门店电话", () => {
  const candidates = [{id:"other",tel:"11111111"}, {id:poi.id,tel:"4000107777"}];
  assert.equal(matchedAmapTel(poi.id, candidates), "4000107777");
  assert.equal(matchedAmapTel("missing", candidates), null);
});

test("重复查询合并时不会丢失已有电话", async () => {
  for (const firstHasPhone of [true, false]) {
    let count = 0;
    const result = await discoverBrandStores(async () => {
      const hasPhone = (++count === 1) === firstHasPhone;
      return {pois:[{...poi,business:{keytag:"零食",...(hasPhone ? {tel:"4000107777"} : {})}}]};
    }, "陆小馋", "南京市", "建邺区", {aliases:["陆小馋零食"]});
    assert.ok(count > 1);
    assert.equal(result.stores[0].tel, "4000107777");
  }
});

test("评价入口绑定当前高德POI，缺少真实POI时不生成错误链接", () => {
  const url = new URL(amapPlaceUrl(poi.id)!);
  assert.equal(url.origin + url.pathname, "https://uri.amap.com/marker");
  assert.equal(url.searchParams.get("poiid"), poi.id);
  for (const id of [null, "", "本地门店|118.75,32.02", "javascript:alert(1)"]) assert.equal(amapPlaceUrl(id), null);
});
