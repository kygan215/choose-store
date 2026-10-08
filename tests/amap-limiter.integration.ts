import assert from "node:assert/strict";
import test from "node:test";
import {Redis} from "ioredis";
import {createAmapRateLimiter} from "../server/amap-limiter.js";

test("两个独立进程连接共享同一速率预算",async()=>{
 const clients=[new Redis(process.env.REDIS_URL!),new Redis(process.env.REDIS_URL!)];
 const scope=`test:amap-rate:${process.pid}:${Date.now()}`;
 try {
  const limiters=clients.map(client=>createAmapRateLimiter(20,client,scope));
  const stamps:number[]=[];
  await Promise.all(Array.from({length:8},async(_,i)=>{await limiters[i%2]();stamps.push(Date.now())}));
  stamps.sort((a,b)=>a-b);
  assert.equal(stamps.length,8);assert.ok(stamps[7]-stamps[0]>=320,`8次共享20QPS预算实际跨度 ${stamps[7]-stamps[0]}ms`);
 } finally {await clients[0].del(scope);await Promise.all(clients.map(client=>client.quit()))}
});
