import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {createLogBuffer,requestTelemetry,safeLogText,closeOpsLog,type OpsEvent} from "../server/ops-log.js";
import {logFilters} from "../server/ops-log-query.js";
import {requireAdmin} from "../server/auth.js";

test("请求日志使用同一请求编号关联错误且不采集正文、Cookie 和查询参数",async()=>{
  const events:OpsEvent[]=[],app=express();app.use(requestTelemetry(e=>events.push(e)));app.use(express.json());
  app.use((req,_res,next)=>{req.user={id:1,tenantId:7,email:"test@example.invalid",displayName:"tester",role:"admin"};next()});
  app.post("/api/jobs/42",(_req,res)=>res.status(500).json({success:false}));app.get("/api/admin/ops/logs",(_req,res)=>res.json({items:[]}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  try{const response=await fetch(`${base}/api/jobs/42?token=topsecret&sales=1999`,{method:"POST",headers:{"Content-Type":"application/json",Cookie:"session=private"},body:JSON.stringify({password:"private",sales:1999})});await response.text();await fetch(`${base}/api/admin/ops/logs`);
    assert.equal(events.length,1);const event=events[0];assert.equal(event.level,"error");assert.equal(event.tenantId,7);assert.equal(event.taskId,"42");assert.equal(event.requestId,response.headers.get("x-request-id"));assert.equal(event.taskType,"analysis");assert.ok(!JSON.stringify(events).match(/topsecret|1999|private|session=/));
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});
test("管理员入口拒绝普通账号，并允许管理员",async()=>{
  const app=express();app.use((req,_res,next)=>{req.user={id:1,tenantId:1,email:"x@invalid",displayName:"test",role:req.headers["x-test-role"]==="admin"?"admin":"member"};next()});app.get("/ops",requireAdmin,(_req,res)=>res.json({ok:true}));
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");
  try{const base=`http://127.0.0.1:${address.port}/ops`;assert.equal((await fetch(base)).status,403);assert.equal((await fetch(base,{headers:{"x-test-role":"admin"}})).status,200)}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
test("日志失败与积压不能无限占用内存或重试阻塞业务",async()=>{
  const writes:OpsEvent[][]=[],buffer=createLogBuffer(async rows=>{writes.push(rows);throw new Error("db offline")},2);
  for(let i=0;i<3;i++)buffer.add({service:"api",level:"info",module:"test",event:"fixture",message:String(i)});
  assert.equal(buffer.stats().pending,2);assert.equal(buffer.stats().dropped,1);await buffer.flush();assert.equal(buffer.stats().failed,2);assert.equal(buffer.stats().pending,0);assert.equal(writes[0][0].message,"1");
});
test("关键凭据、嵌套明细和外部接口查询参数在入队前脱敏",async()=>{
  const message=safeLogText('password=private token=private https://example.com/path?key=secret&password=private postgresql://user:secret@db/name');
  assert.ok(!message.includes("private"));assert.ok(!message.includes("secret"));
  let rows:OpsEvent[]=[];const buffer=createLogBuffer(async batch=>{rows=batch});buffer.add({service:"api",level:"error",module:"test",event:"fixture",message,details:{password:"secret",sales:100,body:{password:"secret"},path:"/api/foo",error:"token=secret"}});await buffer.flush();assert.deepEqual(Object.keys(rows[0].details||{}),["path","error"]);assert.ok(!JSON.stringify(rows).includes("secret"));
});
test("集中日志筛选限定组织、使用参数化SQL，分页保留微秒时间精度",()=>{
  const cursor="2026-10-19T03:00:00.123456Z|runtime:88",filters=logFilters({q:"' OR true--",task_id:"1 OR true",cursor,from:"bad input"},7);
  assert.match(filters.where,/tenant_id=\$1 OR tenant_id IS NULL/);assert.ok(!filters.where.includes("OR true--"));assert.equal(filters.values[0],7);assert.ok(filters.values.includes("1 OR true"));assert.ok(filters.values.includes("2026-10-19T03:00:00.123456Z"));assert.ok(filters.values.includes("runtime:88"));
});
test.after(async()=>closeOpsLog());
