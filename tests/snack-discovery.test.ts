import assert from "node:assert/strict";
import test from "node:test";
import { discoverBrandStores, searchStoreCandidates, type AmapSearch } from "../server/store-search.js";
import { isSnackRetailStore } from "../server/snack-retail.js";
import { classifyResolutionCandidates } from "../server/store-resolution.js";
import { searchPois } from "../server/services.js";

test("高德将有零食标签的门店归入通用生活服务时仍保留，缺标签或明确餐饮仍排除", () => {
  const poi={name:"陆小馋量贩零食(南京高淳区固城镇人民南路店)",type:"生活服务;生活服务场所;生活服务场所",typecode:"070000",business:{keytag:"零食",rectag:"解馋小零食"}};
  assert.equal(isSnackRetailStore(poi),true);
  assert.equal(isSnackRetailStore({...poi,business:{}}),false);
  assert.equal(isSnackRetailStore({...poi,name:"好想来酱卤"}),false);
  assert.equal(isSnackRetailStore({...poi,type:"餐饮服务;中餐厅",typecode:"050100"}),false);
});

test("高德实际返回的 rectag 和 keytag 零食标签可用于搜索及再次入库核验",async()=>{
  for(const business of [{rectag:"零食",rating:"3.9"},{keytag:"零食",rating:"3.9"}]){
    const poi={id:"B0MAVM5HIX",name:"零食很忙(湖北武汉洪山武大工学部店)",location:"114.3,30.5",type:"购物服务;专卖店;专营店",typecode:"061200",cityname:"武汉市",business};
    const result=await searchStoreCandidates(async()=>({pois:[poi]}),poi.name,"武汉市");
    assert.equal(result[0]?.id,poi.id);
    assert.equal(result[0]?.rating,3.9);
    assert.equal(isSnackRetailStore(result[0]),true);
    assert.equal(isSnackRetailStore({...poi,name:"好想来酱卤"}),false);
  }
});

test("品牌发现排除好想来酱卤，保留正常零食店", async () => {
  const rows = [
    { id: "bad", name: "好想来酱卤", type: "餐饮服务;中餐厅", typecode: "050100" },
    { id: "good", name: "好想来零食乐园(中心店)", type: "购物服务;零食店", typecode: "061200" },
  ].map(row => ({ ...row, location: "114.3,30.5", cityname: "武汉市" }));
  const amap: AmapSearch = async () => ({ status: "1", pois: rows });
  const result = await discoverBrandStores(amap, "好想来零食", "武汉市", "洪山区");
  assert.deepEqual(result.stores.map(store => store.id), ["good"]);
});

test("品牌别名召回仍需排除熟食、餐饮和非零售 POI", async () => {
  const names = ["好想来酱卤", "好像来熟食", "好想来卤味店", "好想来饭店", "好想来食品公司"];
  const rows = names.map((name,index) => ({id:`bad-${index}`,name,location:"114.3,30.5"}));
  const amap:AmapSearch = async () => ({pois:rows});
  const result = await discoverBrandStores(amap,"好想来零食","武汉市","洪山区",{aliases:["好像来"]});
  assert.equal(result.stores.length,0);
});

test("购物分类不能使酱卤店通过，餐饮分类不能仅凭品牌名通过", () => {
  assert.equal(isSnackRetailStore({name:"好想来酱卤",typecode:"061200"}),false);
  assert.equal(isSnackRetailStore({name:"好想来",typecode:"050100"}),false);
  assert.equal(isSnackRetailStore({name:"好想来",type:"餐饮服务;小吃快餐店"}),false);
  assert.equal(isSnackRetailStore({name:"好想来",typecode:"061200|050100"}),false);
});

test("正常品牌简称、多个购物分类和包含餐饮地标的分店名仍保留", () => {
  for (const name of ["好想来", "好想来零食乐园(酱卤街店)", "好想来（饭店路店）", "好像来零食"])
    assert.equal(isSnackRetailStore({name,typecode:"061200|060200",type:"购物服务;零食店"}),true,name);
  assert.equal(isSnackRetailStore({name:"好想来(中心店)"}),false);
});

test("名称中的零食不能代替高德分类或标签，缺失标签时不收录", () => {
  assert.equal(isSnackRetailStore({name:"好想来零食",type:"购物服务;专卖店",typecode:"061200"}),false);
  assert.equal(isSnackRetailStore({name:"好想来",type:"购物服务",business:{tag:"休闲零食"}}),true);
  assert.equal(isSnackRetailStore({name:"好想来酱卤",type:"购物服务",business:{tag:"零食"}}),false);
});

test("发现结果保留高德商业标签供入库和历史筛选再次核验", async () => {
  const amap:AmapSearch=async()=>({pois:[{id:"TAG",name:"好想来(中心店)",location:"114.3,30.5",type:"购物服务",business:{tag:"零食"}}]});
  const result=await discoverBrandStores(amap,"好想来零食","武汉市","洪山区");
  assert.equal(result.brand,"好想来");
  assert.equal(result.stores[0]?.tag,"零食");
  assert.equal(isSnackRetailStore(result.stores[0]),true);
});

test("单店关键词搜索保留疑似目标品牌并要求人工确认",async()=>{
  const amap:AmapSearch=async()=>({pois:[{id:"NO_TAG",name:"好想来零食",location:"114.3,30.5",type:"购物服务"}],tips:[]});
  const result=await searchStoreCandidates(amap,"好想来零食");
  assert.equal(result[0]?.id,"NO_TAG");
  assert.equal(result[0]?.auto_confirm,false);
  assert.match(result[0]?.warnings.join(";"),/核验/);
  assert.equal(classifyResolutionCandidates(result).autoConfirm,false);
});

test("竞品搜索也强制核验高德零食标签",async(context)=>{
  const previousKey=process.env.AMAP_WEB_SERVICE_KEY;
  process.env.AMAP_WEB_SERVICE_KEY="test-only-key";
  context.after(()=>{if(previousKey===undefined)delete process.env.AMAP_WEB_SERVICE_KEY;else process.env.AMAP_WEB_SERVICE_KEY=previousKey});
  context.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({status:"1",pois:[
    {id:"BAD",name:"好想来酱卤",type:"购物服务",business:{tag:"零食"}},
    {id:"NO_TAG",name:"好想来零食",type:"购物服务"},
    {id:"GOOD",name:"好想来",type:"购物服务",business:{tag:"零食"}},
  ].map(row=>({...row,location:"114.31234,30.52345",distance:"200"}))}),{headers:{"Content-Type":"application/json"}}));
  const result=await searchPois({longitude:114.311,latitude:30.521,brand:"零食悦"},["竞品门店"],[500]);
  assert.deepEqual(result.map(row=>row.id),["GOOD"]);
  assert.equal(result[0].brand,"好想来");
});
