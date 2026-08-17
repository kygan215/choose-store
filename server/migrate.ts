import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { pool, query } from "./db.js";

async function main(){
  const migrationDir=path.resolve("server/migrations"),files=(await fs.readdir(migrationDir)).filter(file=>file.endsWith(".sql")).sort();
  for(const file of files){const sql=await fs.readFile(path.join(migrationDir,file),"utf8");await pool.query(sql)}
  const email=(process.env.ADMIN_EMAIL||"").trim().toLowerCase(),password=process.env.ADMIN_PASSWORD||"",name=process.env.ADMIN_NAME||"系统管理员",tenantName=process.env.TENANT_NAME||"店界 POI";
  if(!email||password.length<10)throw new Error("ADMIN_EMAIL 必填，ADMIN_PASSWORD 至少 10 位");
  const client=await pool.connect();try{await client.query("BEGIN");let tenant=(await client.query<{id:number}>("SELECT id FROM tenants ORDER BY id LIMIT 1")).rows[0];if(!tenant)tenant=(await client.query<{id:number}>("INSERT INTO tenants(name) VALUES($1) RETURNING id",[tenantName])).rows[0];const exists=(await client.query("SELECT 1 FROM users WHERE tenant_id=$1 AND lower(email)=lower($2)",[tenant.id,email])).rowCount;if(!exists){const passwordHash=await bcrypt.hash(password,12);await client.query("INSERT INTO users(tenant_id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,'admin')",[tenant.id,email,name,passwordHash])}await client.query("COMMIT")}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
  await query("DELETE FROM sessions WHERE expires_at<=NOW()");console.log("Database migration completed");await pool.end();
}
main().catch(error=>{console.error(error);process.exit(1)});
