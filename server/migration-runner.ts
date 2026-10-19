import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {pool} from "./db.js";

export async function runSchemaMigrations(){
 const directory=path.resolve("server/migrations"),files=(await fs.readdir(directory)).filter(f=>f.endsWith(".sql")).sort();
 const client=await pool.connect();
 try{
  await client.query("SELECT pg_advisory_lock(721119,1)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations(filename text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),baselined boolean NOT NULL DEFAULT false)");
  const applied=(await client.query<{filename:string;checksum:string}>("SELECT filename,checksum FROM schema_migrations")).rows;
  if(!applied.length){
   const existing=(await client.query("SELECT to_regclass('public.brand_stores') stores,to_regclass('public.operations_logs') ops,to_regclass('public.history_activities') history,to_regclass('public.brand_discovery_events') events")).rows[0];
   if(existing.stores){
    if(!existing.ops||!existing.history||!existing.events)throw new Error("已有旧库缺少 036 基线标记，须先明确迁移基线，禁止重放历史数据重算");
    for(const file of files.filter(f=>Number(f.slice(0,3))<=36)){const checksum=createHash("sha256").update((await fs.readFile(path.join(directory,file),"utf8")).replace(/\r\n/g,"\n")).digest("hex");await client.query("INSERT INTO schema_migrations(filename,checksum,baselined) VALUES($1,$2,true)",[file,checksum]);applied.push({filename:file,checksum})}
   }
  }
  const done=new Map(applied.map(row=>[row.filename,row.checksum]));
  for(const file of files){const sql=(await fs.readFile(path.join(directory,file),"utf8")).replace(/\r\n/g,"\n"),checksum=createHash("sha256").update(sql).digest("hex");if(done.has(file)){if(done.get(file)!==checksum)throw new Error(`已执行迁移内容发生变化：${file}`);continue}
   await client.query(sql);await client.query("INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)",[file,checksum]);console.log(`Applied ${file}`);
  }
 }finally{await client.query("SELECT pg_advisory_unlock(721119,1)").catch(()=>{});client.release()}
}
