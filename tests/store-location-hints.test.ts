import assert from "node:assert/strict";
import test from "node:test";
import {parseStoreLocationHints,resolveStoreLocationHints} from "../server/store-location-hints.js";

const realShareRedirect="http://wb.amap.com/?p=B0M17UF52A%2C30.913213%2C113.910898%2C%E9%9B%B6%E9%A3%9F%E5%BE%88%E5%BF%99%28%E6%B9%96%E5%8C%97%E5%AD%9D%E6%84%9F%E5%AE%9E%E9%AA%8C%E5%B0%8F%E5%AD%A6%E5%BA%97%29%2C%E5%AD%9D%E6%84%9F%E5%B8%82%E5%AD%9D%E5%8D%97%E5%8C%BA%E6%96%B0%E5%8D%8E%E8%A1%97%E9%81%93%E7%8E%AF%E5%9F%8E%E8%B7%AF%E6%BE%B4%E5%B7%9D%E5%85%AC%E5%9B%AD%2C420900";

test("官方 marker 坐标与名称只作为位置线索，不生成 POI ID",()=>{
 const hints=parseStoreLocationHints({locationShare:"https://uri.amap.com/marker?position=113.914087,30.914736&name=%E9%9B%B6%E9%A3%9F%E5%BE%88%E5%BF%99&coordinate=gaode"});
 assert.equal(hints.poiId,"");assert.equal(hints.longitude,113.914087);assert.equal(hints.latitude,30.914736);assert.equal(hints.name,"零食很忙");assert.equal(hints.source,"amap_share");assert.match(hints.warnings.join(),/未提供真实 POI ID/);
});
test("官方 marker 与详情长链可取精确 ID，手填冲突明确提示",()=>{
 for(const locationShare of ["https://uri.amap.com/marker?poiid=B0VALID001","https://www.amap.com/detail/B0VALID001"]){assert.equal(parseStoreLocationHints({locationShare}).poiId,"B0VALID001")}
 const hints=parseStoreLocationHints({poiId:"B0OTHER001",locationShare:"https://uri.amap.com/marker?poiid=B0VALID001"});assert.equal(hints.poiId,"B0OTHER001");assert.match(hints.warnings.join(),/不同/);
});
test("GPS 坐标不冒充高德坐标，缺失半边坐标不当成有效位置",()=>{
 assert.equal(parseStoreLocationHints({locationShare:"https://uri.amap.com/marker?position=113.9,30.9&coordinate=wgs84"}).longitude,null);
 assert.equal(parseStoreLocationHints({longitude:114}).longitude,null);assert.equal(parseStoreLocationHints({longitude:"",latitude:30}).latitude,null);
});
test("短分享只跟随官方跳转头，不读取页面内容",async()=>{
 const calls:string[]=[];const fake:typeof fetch=async(url,init)=>{calls.push(String(url));assert.equal(init?.redirect,"manual");return new Response("not executed",{status:302,headers:{location:"https://uri.amap.com/marker?position=113.914087,30.914736&name=%E9%9B%B6%E9%A3%9F%E5%BE%88%E5%BF%99"}})};
 const hints=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/example"},fake);assert.equal(calls.length,1);assert.equal(hints.longitude,113.914087);assert.equal(hints.poiId,"");
});
test("非官方域名、用户信息、非标准端口、HTTP 均不发起请求",async()=>{
 let calls=0;const fake:typeof fetch=async()=>{calls++;return new Response(null)};
 for(const locationShare of ["https://127.0.0.1/x","https://surl.amap.com.evil.test/x","https://user@surl.amap.com/x","https://surl.amap.com:8443/x","http://surl.amap.com/x"]){const hints=await resolveStoreLocationHints({locationShare},fake);assert.ok(hints.warnings.length)}
 assert.equal(calls,0);
});
test("每一跳重新检查域名，拒绝内网、HTTP 降级和伪装官方域名",async()=>{
 for(const target of ["http://169.254.169.254/latest","https://127.0.0.1/","https://surl.amap.com.evil.test/","http://uri.amap.com/marker?poiid=B0VALID001"]){let calls=0;const hints=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/example"},async()=>{calls++;return new Response(null,{status:302,headers:{location:target}})});assert.equal(calls,1);assert.match(hints.warnings.join(),/停止/)}
});
test("最多四次跳转，循环有明确反馈",async()=>{
 let calls=0;const hints=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/0"},async()=>new Response(null,{status:302,headers:{location:`https://surl.amap.com/${++calls}`}}));assert.equal(calls,5);assert.match(hints.warnings.join(),/跳转过多/);
 calls=0;const loop=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/loop"},async()=>{calls++;return new Response(null,{status:302,headers:{location:"/loop"}})});assert.equal(calls,1);assert.match(loop.warnings.join(),/循环/);
});
test("短链解析总预算为五秒，挂起请求可终止",async(t)=>{
 t.mock.timers.enable({apis:["setTimeout"]});let signal:AbortSignal|null|undefined;
 const pending=resolveStoreLocationHints({locationShare:"https://surl.amap.com/slow"},async(_url,init)=>{signal=init?.signal;return new Promise<Response>(()=>{})});
 t.mock.timers.tick(5000);const hints=await pending;assert.equal(signal?.aborted,true);assert.match(hints.warnings.join(),/超过 5 秒/);
});
test("只返回HTML页面且没有跳转时不尝试抓取脚本中的 ID",async()=>{
 const hints=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/page"},async()=>new Response('<script>poiid="B0VALID001"</script>'));assert.equal(hints.poiId,"");assert.match(hints.warnings.join(),/未提供可用/);
});

test("真实高德短分享的 HTTP wb p 跳转仅按数据解析并升级规范 HTTPS 位置",async()=>{
 const calls:string[]=[];const hints=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/1BZdA15s1B2vw"},async(url)=>{calls.push(String(url));return new Response(null,{status:302,headers:{location:realShareRedirect}})});
 assert.deepEqual(calls,["https://surl.amap.com/1BZdA15s1B2vw"]);assert.equal(hints.poiId,"B0M17UF52A");assert.equal(hints.longitude,113.910898);assert.equal(hints.latitude,30.913213);assert.equal(hints.name,"零食很忙(湖北孝感实验小学店)");assert.equal(hints.address,"孝感市孝南区新华街道环城路澴川公园");assert.ok(hints.shareUrl?.startsWith("https:"));
 const direct=parseStoreLocationHints({locationShare:realShareRedirect.replace("http:","https:")});assert.equal(direct.poiId,hints.poiId);assert.equal(direct.longitude,hints.longitude);assert.ok(direct.shareUrl?.startsWith("https://uri.amap.com/marker?"));
});

test("wb 分享特例不发送 HTTP 请求，也不接受反转坐标或非官方伪装",async()=>{
 for(const target of [realShareRedirect.replace("wb.amap.com","wb.amap.com.evil.test"),realShareRedirect.replace("wb.amap.com","user@wb.amap.com"),realShareRedirect.replace("30.913213%2C113.910898","113.910898%2C30.913213"),realShareRedirect.replace("wb.amap.com/","wb.amap.com/other")]){let calls=0;const hints=await resolveStoreLocationHints({locationShare:"https://surl.amap.com/example"},async()=>{calls++;return new Response(null,{status:302,headers:{location:target}})});assert.equal(calls,1);assert.equal(hints.poiId,"");assert.match(hints.warnings.join(),/停止/)}
});
