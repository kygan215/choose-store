import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source=fs.readFileSync(new URL("../app/api/[...path]/route.ts",import.meta.url),"utf8");

test("Sites 云端实现完整登录会话接口",()=>{
  for(const route of ["login","logout","me","change-password"])assert.match(source,new RegExp(`path\\[1\\]===\\"${route}\\"`));
  assert.match(source,/CREATE TABLE IF NOT EXISTS users/);
  assert.match(source,/CREATE TABLE IF NOT EXISTS sessions/);
  assert.match(source,/HttpOnly; Secure; SameSite=Lax/);
});

test("管理员密码只从环境变量读取，不写入源码",()=>{
  assert.match(source,/runtimeEnv\.ADMIN_PASSWORD/);
  assert.doesNotMatch(source,/LocalTest_Admin_2026_ChangeMe/);
});
