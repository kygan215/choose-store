import assert from "node:assert/strict";
import test from "node:test";
import {ApiProblem,callHistory,errorText,historyProblemDetails} from "../app/history-api.js";
import {historyLinkIdentityIssues} from "../server/history-linking.js";
test("历史关联冲突保留状态码、结构化原因和请求编号",async()=>{
 const before=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({success:false,message:"关联冲突",data:{store_conflicts:[{reason:"2026-10-01 同一 POI 两份活动"}]},error:{code:"HISTORY_ACTIVITY_DUPLICATE"}}),{status:409,headers:{"X-Request-ID":"request-1"}});
 try{await assert.rejects(()=>callHistory('/api','/history/stores/1/link',{method:'POST',body:'{}'}),error=>{assert.ok(error instanceof ApiProblem);assert.equal(error.status,409);assert.equal(error.code,'HISTORY_ACTIVITY_DUPLICATE');assert.deepEqual(historyProblemDetails(error),['2026-10-01 同一 POI 两份活动']);return true})}finally{globalThis.fetch=before}
});
test("历史请求有超时反馈，服务错误可用请求编号定位",async()=>{
 const before=globalThis.fetch;globalThis.fetch=async(_input,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 try{await assert.rejects(()=>callHistory('/api','/history/stores/1/link',{method:'POST',body:'{}',timeoutMs:5}),error=>{assert.ok(error instanceof ApiProblem);assert.equal(error.code,'REQUEST_TIMEOUT');assert.match(error.message,/刷新关联状态/);return true})}finally{globalThis.fetch=before}
 assert.match(errorText(new ApiProblem('服务器暂不可用',null,{status:500,requestId:'trace-1'})),/trace-1/);
});
test("关联校验拒绝品牌、省市、已有 POI 和已关联目标的冲突",()=>{
 const source={brand_name:'零食很忙',province:'湖北省',city:'武汉市',poi_id:null,brand_store_id:null},target={id:1,brand_name:'零食很忙',province:'湖北省',city:'武汉市',amap_poi_id:'B0HIST0001'};
 assert.deepEqual(historyLinkIdentityIssues(source,target),[]);
 assert.match(historyLinkIdentityIssues({...source,brand_name:'好想来'},target).join(''),/品牌/);
 assert.match(historyLinkIdentityIssues({...source,city:'宜昌市'},target).join(''),/城市/);
 assert.match(historyLinkIdentityIssues({...source,poi_id:'B0OTHER001'},target).join(''),/POI/);
 assert.match(historyLinkIdentityIssues({...source,brand_store_id:2},target).join(''),/已关联/);
});
