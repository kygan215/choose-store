import assert from "node:assert/strict";
import test from "node:test";
import React,{act,useState} from "react";
import type {Candidate} from "../app/HistoryCandidateLookup.js";
import {JSDOM} from "jsdom";

const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Event:dom.window.Event,MouseEvent:dom.window.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true,React});
const {createRoot}=await import("react-dom/client");
const {default:CandidateLookup}=await import("../app/HistoryCandidateLookup.js");
const library={id:3148,brand_name:"零食很忙",amap_name:"零食很忙(湖北襄阳襄州紫荆花园店)",province:"湖北省",city:"襄阳市",address:"紫荆花园 BX5幢",amap_poi_id:"B0J1SSSRR6"};
const poi={id:"B0J1SSSRR6",name:library.amap_name,province:library.province,city:library.city,district:"襄州区",address:library.address,type:"购物服务;专卖店;专营店",score:100,reasons:[],conflicts:[],warnings:[],library_candidates:[library]};

test("输入真实 POI ID 并查到唯一库中门店后，确认关联能够操作且显示所选店名",async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({success:true,data:{rows:[poi]}}),{status:200,headers:{"Content-Type":"application/json"}});
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 function Harness(){const [selected,setSelected]=useState<Candidate|null>(null);return React.createElement(React.Fragment,null,React.createElement(CandidateLookup,{api:"/api",brand:library.brand_name,province:library.province,city:library.city,initial:[],selectedId:selected?.id||null,onSelect:setSelected,label:"匹配候选",historyStoreId:541}),React.createElement("button",{"data-testid":"confirm",disabled:!selected},"确认关联"))}
 try{await act(async()=>root.render(React.createElement(Harness)));const input=container.querySelector("input")!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,poi.id);input.dispatchEvent(new Event("input",{bubbles:true}))});
  const find=[...container.querySelectorAll("button")].find(b=>b.textContent==="高德实时找")!;await act(async()=>find.click());
  assert.equal((container.querySelector('[data-testid="confirm"]') as HTMLButtonElement).disabled,false,"查到了正确的 POI 却没有选中，确认按钮仍然无响应");
  assert.equal((container.querySelector("select") as HTMLSelectElement).value,"3148");
 }finally{await act(async()=>root.unmount());container.remove();globalThis.fetch=originalFetch}
});

async function mounted(extra:Record<string,unknown>={}){
 const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
 function Harness(){const [selected,setSelected]=useState<Candidate|null>(null);return React.createElement(React.Fragment,null,React.createElement(CandidateLookup,{api:"/api",brand:library.brand_name,province:library.province,city:library.city,initial:[],selectedId:selected?.id||null,onSelect:setSelected,label:"匹配候选",historyStoreId:541,...extra}),React.createElement("output",{"data-testid":"selected"},selected?.amap_poi_id||""))}
 await act(async()=>root.render(React.createElement(Harness)));
 return {container,async input(value:string){const input=container.querySelector("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}))})},async click(text:string){const button=[...container.querySelectorAll("button")].find(b=>b.textContent===text);assert.ok(button,`missing button ${text}`);await act(async()=>button.click())},async close(){await act(async()=>root.unmount());container.remove()}};
}
test("已显示的高德候选可直接确认，双击只提交一次",async()=>{
 let calls=0,finish!:(value:boolean)=>void;const done=new Promise<boolean>(resolve=>{finish=resolve});
 const ui=await mounted({cachedCandidates:[poi],onConfirmCandidate:async(candidate:Candidate)=>{assert.equal(candidate.id,3148);calls++;return done}});
 try{const button=[...ui.container.querySelectorAll("button")].find(b=>b.textContent==="确认关联此门店")!;assert.ok(button);
  await act(async()=>{button.click();button.click()});assert.equal(calls,1);assert.equal(button.disabled,true);await act(async()=>finish(true));
 }finally{await ui.close()}
});
test("修改搜索词立即撤销旧选择，后返回的旧搜索不能覆盖新 POI",async()=>{
 const originalFetch=globalThis.fetch;let resolveOld!:(value:Response)=>void,calls=0;
 globalThis.fetch=async()=>{calls++;if(calls===1)return new Promise<Response>(resolve=>{resolveOld=resolve});return new Response(JSON.stringify({success:true,data:{rows:[{...poi,id:"B0NEW12345",library_candidates:[{...library,id:3149,amap_poi_id:"B0NEW12345"}]}]}}),{status:200})};
 const ui=await mounted();try{await ui.input(poi.id);await ui.click("高德实时找");await ui.input("B0NEW12345");await ui.click("高德实时找");assert.equal(ui.container.querySelector('output')?.textContent,"B0NEW12345");
  await act(async()=>resolveOld(new Response(JSON.stringify({success:true,data:{rows:[poi]}}),{status:200})));assert.equal(ui.container.querySelector('output')?.textContent,"B0NEW12345");
  await ui.input("另一个门店");assert.equal(ui.container.querySelector('output')?.textContent,"");
 }finally{await ui.close();globalThis.fetch=originalFetch}
});
test("缓存中的数字字符串候选可正常选择，跨品牌候选不能预选",async()=>{
 const stringCandidate={...library,id:"3148"} as unknown as Candidate;
 const ui=await mounted({cachedCandidates:[{...poi,library_candidates:[stringCandidate]}]});try{await ui.click("选择此门店");assert.equal(ui.container.querySelector('output')?.textContent,poi.id);assert.equal((ui.container.querySelector('select') as HTMLSelectElement).value,"3148")}finally{await ui.close()}
 const bad=await mounted({cachedCandidates:[{...poi,library_candidates:[{...library,brand_name:"其他品牌"}]}]});try{assert.ok([...bad.container.querySelectorAll('button')].filter(b=>b.textContent?.includes('此门店')).every(b=>b.disabled))}finally{await bad.close()}
});
test("保存被后端拒绝时在当前候选旁显示原因",async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({success:false,message:"同一 POI 已有相同日期活动，请核对重复记录",error:{code:"HISTORY_ACTIVITY_DUPLICATE"}}),{status:409});
 const ui=await mounted({cachedCandidates:[poi]});try{await ui.click("确认关联此门店");assert.match(ui.container.querySelector('[role="alert"]')?.textContent||"",/相同日期活动/)}finally{await ui.close();globalThis.fetch=originalFetch}
});
