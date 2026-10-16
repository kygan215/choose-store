import assert from "node:assert/strict";
import test from "node:test";
import {discoveryConcurrency,processDiscoveryJob} from "../server/brand-library.js";
import {discoveryHealth,safeDiscoveryMessage} from "../server/discovery-monitor.js";

test("城市尚未完成时也上报入库阶段和已保存条数，避免进度看似停住",async()=>{
  const events:Array<{stage:string;details?:Record<string,unknown>}>=[];
  const job={id:1,tenant_id:1,created_by:1,province:"湖北省",cities_json:["武汉市"],brands_json:["零食有鸣"],control:"run",status:"等待执行",api_calls:0};
  let savingObserved=false;
  const monitor={event:async(_level:string,stage:string,_message:string,details?:Record<string,unknown>)=>{events.push({stage,details})},unit:async()=>{},finish:async()=>{}};
  await processDiscoveryJob(1,1,1,{
    monitor,
    query:async(sql:string)=>({rows:sql.startsWith("SELECT * FROM brand_discovery_jobs")?[job]:sql.startsWith("SELECT COUNT(*)")?[{count:2}]:[]}),
    discoverBrandStores:async()=>({stores:[{id:"B1"},{id:"B2"}],complete:true}),
    saveDiscoveredStores:async(...args:unknown[])=>{
      savingObserved=events.some(item=>item.stage==="saving");
      const progress=args[8] as ((saved:number,total:number)=>Promise<void>);
      if(progress)await progress(1,2);
    },
  } as never);
  assert.ok(savingObserved,"完成一个城市之前，应先上报正在入库");
  assert.ok(events.some(item=>item.stage==="save_progress"&&item.details?.saved===1));
  assert.ok(events.some(item=>item.stage==="unit_complete"));
});

test("有心跳但两分钟无新进展应提示排查，暂停和完成不误报卡住",()=>{
  const now=Date.parse("2026-10-16T08:00:00Z"),base={status:"正在查询",queueState:"active",heartbeatAt:new Date(now-10_000).toISOString(),lastActivityAt:new Date(now-180_000).toISOString(),now};
  assert.equal(discoveryHealth(base).state,"warning");
  assert.match(discoveryHealth(base).message,/仍在线/);
  assert.equal(discoveryHealth({...base,status:"已暂停"}).state,"paused");
  assert.equal(discoveryHealth({...base,status:"已完成"}).state,"finished");
  assert.equal(discoveryHealth({...base,queueState:"missing"}).state,"warning");
  assert.equal(discoveryHealth({...base,lastActivityAt:new Date(now-5_000).toISOString()}).state,"running");
});

test("日志不能暴露高德密钥、令牌或密码",()=>{
  const text=safeDiscoveryMessage("https://restapi.amap.com/v5?key=private-key&city=武汉 token=abc password=private-password Authorization=Bearer-abc");
  assert.ok(!text.includes("private-key"));assert.ok(!text.includes("private-password"));assert.ok(!text.includes("Bearer-abc"));
});

test("8组品牌查询不能挤占只有5个连接且同时运行2个任务的Worker连接池",()=>{
  assert.equal(discoveryConcurrency(8,5,2),1);
  assert.equal(discoveryConcurrency(8,10,2),4);
  assert.equal(discoveryConcurrency(1,10,2),1);
  assert.equal(discoveryConcurrency(8,1,5),1);
});
