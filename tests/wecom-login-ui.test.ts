import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const server=fs.readFileSync(new URL("../server/index.ts",import.meta.url),"utf8");
const page=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const compose=fs.readFileSync(new URL("../docker-compose.yml",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../server/migrations/006_wecom_login.sql",import.meta.url),"utf8");

test("企业微信授权入口和回调在登录保护之前公开",()=>{
  const start=server.indexOf('app.get("/api/auth/wecom/start"');
  const callback=server.indexOf('app.get("/api/auth/wecom/callback"');
  const guard=server.indexOf('app.use("/api",authenticate)');
  assert.ok(start>0&&callback>start&&guard>callback);
});

test("登录页仅在服务端确认已启用时显示企业微信入口",()=>{
  assert.match(page,/\/auth\/wecom\/config/);
  assert.match(page,/企业微信扫码登录/);
  assert.match(page,/\/auth\/wecom\/start/);
  assert.doesNotMatch(page,/WECOM_CORP_SECRET|corpsecret/);
});

test("企业微信Secret只注入API容器且数据库身份有唯一约束",()=>{
  assert.equal(compose.split(/\r?\n/).filter(line=>line.includes("WECOM_CORP_SECRET")).length,1);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wecom_identity/);
});
