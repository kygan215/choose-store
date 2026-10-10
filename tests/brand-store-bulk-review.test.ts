import assert from "node:assert/strict";
import test,{after} from "node:test";
import {pool} from "../server/db.js";
import {bulkReviewBrandStores,validateBulkReview} from "../server/brand-store-bulk-review.js";
import type {AuthUser} from "../server/auth.js";
const admin:AuthUser={id:1,tenantId:1,email:"a@test.local",displayName:"管理员",role:"admin"};
after(()=>pool.end());
test("批量名单校验去重、数量、依据和操作类型",()=>{
 assert.deepEqual(validateBulkReview(admin,{store_ids:[3,1,3],decision:"accept",reason:" 已核实 "}),{ids:[1,3],decision:"accept",reason:"已核实"});
 for(const store_ids of [[],[0],[1.5],["1"],Array(5001).fill(1)])assert.throws(()=>validateBulkReview(admin,{store_ids,decision:"accept",reason:"核实"}));
 for(const reason of [undefined," ","x".repeat(501)])assert.throws(()=>validateBulkReview(admin,{store_ids:[1],decision:"accept",reason}),/核实依据/);
 assert.throws(()=>validateBulkReview(admin,{store_ids:[1],decision:"reset",reason:"核实"}),/纳入或批量排除/);
});
test("非管理员批量核验在连接数据库前被拒绝",async()=>{
 await assert.rejects(bulkReviewBrandStores({...admin,role:"member"},{store_ids:[1],decision:"exclude",reason:"核实"},"",async()=>{throw new Error("不应连接")}),/管理员/);
});
