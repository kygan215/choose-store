import assert from "node:assert/strict";
import test, {after} from "node:test";
import {pool} from "../server/db.js";
import {manageBrandStores, validateRemovalInput} from "../server/brand-store-management.js";
import type {AuthUser} from "../server/auth.js";

const admin:AuthUser={id:1,tenantId:1,email:"admin@test.local",displayName:"管理员",role:"admin"};
after(()=>pool.end());
test("管理员删除严格校验原因和ID，重复选择去重",()=>{
  assert.deepEqual(validateRemovalInput(admin,[3,1,3],"delete"," 人工核实非目标门店 "),{ids:[1,3],reason:"人工核实非目标门店"});
  for(const ids of [[],[0],[-1],[1.5],["1"],[true],[Number.MAX_SAFE_INTEGER+1],Array(5001).fill(1)])assert.throws(()=>validateRemovalInput(admin,ids,"delete","误匹配"));
  for(const reason of [undefined," ","x".repeat(501)])assert.throws(()=>validateRemovalInput(admin,[1],"delete",reason));
});
test("普通成员绕过界面直接调用删除/恢复，也在连接数据库之前被拒绝",async()=>{
  const member:AuthUser={...admin,role:"member"};
  for(const action of ["delete","restore"] as const)await assert.rejects(manageBrandStores(member,action,{store_ids:[1],reason:"误匹配"},"",async()=>{throw new Error("不应连接数据库")}),error=>error instanceof Error&&error.message==="需要管理员权限");
});
