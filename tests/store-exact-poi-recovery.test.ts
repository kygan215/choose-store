import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveStoreCandidates} from '../server/services.js';
const id='B0M1A9HM30';
const tip={id,name:'零食很忙(湖北襄阳园林小区店)',location:'112.220439,32.098094',typecode:'061200',district:'湖北省襄阳市襄州区',address:'古城街道建安小区(卉木林巷)'};
const source={poiId:id,searchName:id,originalName:'零食很忙湖北襄阳园林小区店',province:'湖北省',city:'襄阳市'};
test('详情为空但输入提示返回同一真实ID时保留候选，要求人工核对',async()=>{
 const calls:Array<{path:string;params:Record<string,unknown>}>=[];
 const rows=await resolveStoreCandidates(source,async(path,params)=>{calls.push({path,params});return path==='/v3/assistant/inputtips'?{tips:[tip]}:{pois:[]}});
 assert.equal(rows[0]?.id,id);assert.equal(rows[0]?.auto_confirm,false);assert.equal(rows[0]?.requires_review,true);assert.match(rows[0]?.warnings.join()||'',/详情|输入提示/);
 assert.ok(calls.some(c=>c.path==='/v3/assistant/inputtips'&&c.params.keywords===source.originalName));assert.equal(rows.diagnostics.location_hints?.poi_verified,false);assert.equal(rows.diagnostics.poi_lookup?.recovery_source,'inputtips');
});
test('精确ID回退不能以同品牌邻店或其他ID替换目标',async()=>{
 const rows=await resolveStoreCandidates(source,async(path)=>path==='/v3/assistant/inputtips'?{tips:[{...tip,id:'B0OTHER001'}]}:{pois:[]});
 assert.equal(rows.length,0);assert.equal(rows.diagnostics.poi_lookup?.requested_id,id);
});
test('v5详情为空时可使用v3返回的完全相同ID，不接受其他ID',async()=>{
 const raw={...tip,pname:'湖北省',cityname:'襄阳市',adname:'襄州区',type:'购物服务;零食店',tag:'零食'};
 const rows=await resolveStoreCandidates(source,async(path)=>({pois:path==='/v3/place/detail'?[raw]:[]}));
 assert.equal(rows[0]?.id,id);assert.equal(rows.diagnostics.location_hints?.poi_verified,true);assert.equal(rows.diagnostics.poi_lookup?.recovery_source,'v3_detail');
});
test('同ID详情缺坐标要明确诊断，不误报ID不存在',async()=>{
 const rows=await resolveStoreCandidates(source,async(path)=>path.includes('/place/detail')?{pois:[{...tip,location:'',type:'购物服务;零食店'}]}:{tips:[]});
 assert.equal(rows.length,0);assert.equal(rows.diagnostics.poi_lookup?.detail_status,'missing_location');
});
test('精确ID的输入提示回退必须同时有真实坐标，地标占位项不能冒充',async()=>{
 const rows=await resolveStoreCandidates(source,async(path)=>path==='/v3/assistant/inputtips'?{tips:[{...tip,location:[]}]}:{pois:[]});
 assert.equal(rows.length,0);
});
