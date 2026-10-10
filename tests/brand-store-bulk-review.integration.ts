import assert from "node:assert/strict";
import test,{after} from "node:test";
import type {PoolClient} from "pg";
import {pool} from "../server/db.js";
import {bulkReviewBrandStores} from "../server/brand-store-bulk-review.js";
import type {AuthUser} from "../server/auth.js";
const admin:AuthUser={id:1,tenantId:1,email:"a@test.local",displayName:"管理员",role:"admin"};
after(()=>pool.end());
test("批量核验原子提交、租户隔离、实际分类、刷新持久化、审计与回滚",async()=>{
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  for(const t of ["brand_stores","ailingshi_poi_overrides","brand_region_cache","brand_dashboard_snapshots","audit_logs"])await c.query(`CREATE TEMP TABLE ${t}(LIKE public.${t} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES) ON COMMIT DROP`);
  await c.query("CREATE TRIGGER apply_ailingshi_override BEFORE INSERT OR UPDATE ON brand_stores FOR EACH ROW EXECUTE FUNCTION apply_ailingshi_override()");
  await c.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_poi_id,amap_name,poi_type,province,city,longitude,latitude) VALUES
  (1,1,'好想来','B1','B1','好想来露','购物服务','湖北省','武汉市',114,30),
  (2,1,'好想来','B2','B2','好想来奶站','购物服务','湖北省','武汉市',114,30),
  (3,1,'好想来','B3','B3','好想来(中心店)','','湖北省','武汉市',114,30),
  (4,2,'好想来','B1','B1','好想来露','购物服务','湖北省','武汉市',114,30),
  (5,1,'好想来','B5','B5','好想来(中心店)','购物服务','湖北省','武汉市',114,30),
  (6,1,'好想来','B6','','好想来(中心店)','购物服务','湖北省','武汉市',114,30)`);
  await c.query("UPDATE brand_stores SET deleted_at=NOW() WHERE id=5");
  const connect=async()=>({query:(sql:string,values?:unknown[])=>c.query(sql==="BEGIN"?"SAVEPOINT bulk":sql==="COMMIT"?"RELEASE SAVEPOINT bulk":sql==="ROLLBACK"?"ROLLBACK TO SAVEPOINT bulk":sql,values),release:()=>{}} as PoolClient);
  for(const ids of [[1,4],[1,5],[1,999]])await assert.rejects(bulkReviewBrandStores(admin,{store_ids:ids,decision:"accept",reason:"人工核实"},"",connect),/不存在|已删除|无权/);
  await assert.rejects(bulkReviewBrandStores(admin,{store_ids:[1,6],decision:"accept",reason:"人工核实"},"",connect),/POI ID/);
  assert.equal((await c.query("SELECT count(*) n FROM ailingshi_poi_overrides")).rows[0].n,"0");
  const accepted=await bulkReviewBrandStores(admin,{store_ids:[1,2,3,1],decision:"accept",reason:"已核实品牌"},"127.0.0.1",connect);
  assert.deepEqual(accepted,{selected:3,poi_count:3,affected:3,accepted:1,excluded:1,pending:1});
  assert.equal((await c.query("SELECT ailingshi_override FROM brand_stores WHERE id=4")).rows[0].ailingshi_override,"");
  assert.ok((await c.query("SELECT invalidated_at FROM brand_dashboard_snapshots WHERE tenant_id=1")).rows[0].invalidated_at);
  const excluded=await bulkReviewBrandStores(admin,{store_ids:[1,2,3],decision:"exclude",reason:"人工排除"},"",connect);
  assert.equal(excluded.excluded,3);
  await c.query("UPDATE brand_stores SET amap_name='好想来(新名称店)',poi_type='购物服务' WHERE id=1");
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"排除");
  assert.equal((await c.query("SELECT count(*) n FROM audit_logs WHERE action='bulk_review_brand_pois'")).rows[0].n,"2");
  const failConnect=async()=>({query:(sql:string,values?:unknown[])=>sql.startsWith('INSERT INTO audit_logs')?Promise.reject(new Error('模拟审计失败')):connect().then(x=>x.query(sql,values)),release:()=>{}} as PoolClient);
  await assert.rejects(bulkReviewBrandStores(admin,{store_ids:[1],decision:"accept",reason:"测试回滚"},"",failConnect),/审计失败/);
  assert.equal((await c.query("SELECT name_decision FROM brand_stores WHERE id=1")).rows[0].name_decision,"排除");
 }finally{await c.query("ROLLBACK");c.release()}
});
