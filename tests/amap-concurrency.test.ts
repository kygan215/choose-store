import assert from "node:assert/strict";
import test from "node:test";
import {forEachConcurrent} from "../server/concurrency.js";

test("并行池遵守上限并完成所有条目",async()=>{
 let active=0,peak=0;const completed:number[]=[];
 await forEachConcurrent(Array.from({length:17},(_,i)=>i),4,async item=>{active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>setImmediate(resolve));completed.push(item);active--});
 assert.equal(peak,4);assert.equal(active,0);assert.equal(new Set(completed).size,17);
});

test("并行池失败后停止派发并等待在途操作结束",async()=>{
 let active=0;const started:number[]=[];
 await assert.rejects(forEachConcurrent([0,1,2,3,4],2,async item=>{started.push(item);active++;try{if(item===0)throw new Error("probe failure");await new Promise<void>(resolve=>setImmediate(resolve))}finally{active--}}),/probe failure/);
 assert.equal(active,0);assert.ok(started.length<=2);
});
