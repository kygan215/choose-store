// Run after migrations with DATABASE_URL set; all fixture rows are rolled back.
import assert from "node:assert/strict";
import fs from "node:fs";
import test, { after } from "node:test";
import { performance } from "node:perf_hooks";
import { pool } from "../server/db.js";
import { listBrandStores } from "../server/brand-library.js";
import { snackRetailSql } from "../server/snack-retail.js";

after(()=>pool.end());
test("6万门店筛选及深页查询低于500ms，保留规则与实时判定完全一致",async()=>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE brand_stores (LIKE public.brand_stores INCLUDING DEFAULTS INCLUDING INDEXES INCLUDING GENERATED) ON COMMIT DROP");
    await client.query("CREATE TEMP TABLE stores (LIKE public.stores INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT DROP");
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_name,province,city,district,address,longitude,latitude,raw_json)
      SELECT n,1,CASE WHEN n%2=0 THEN '零食有鸣' ELSE '好想来' END,'perf-'||n,
        CASE WHEN n%2=0 THEN '零食有鸣批发超市' ELSE '好想来' END||'('||n||'公寓店)',
        '湖北省','城市'||(n%300),'区县'||(n%20),'测试路'||n,114.3,30.5,
        jsonb_build_object('business',jsonb_build_object('rating','4.0','tel','4000000000','tag','日杂店'),'fixture',repeat('x',1000))
      FROM generate_series(1,60000) n`);
    await client.query(`INSERT INTO brand_stores(id,tenant_id,brand_name,source_uid,amap_name,longitude,latitude)
      SELECT 60000+n,2,'零食有鸣','excluded-'||n,name,114.3,30.5 FROM unnest(ARRAY[
        '零食有鸣酱卤店','零食有鸣(餐馆旁公寓店)','零食有鸣批发超市(苍溪城郊中学店)',
        '零食有鸣批发超市(苍溪县汉水秀城店)','零食有鸣批发超市(苍溪元坝镇店)',
        '零食有鸣批发超市(东城转盘店)','零食有鸣批发超市(东溪县店)',
        '零食有鸣批发超市(红滨路店)','零食有鸣批发超市(江南半岛店)',
        '零食有鸣批发超市(龙王沟店)']) WITH ORDINALITY names(name,n)`);
    await client.query("ANALYZE brand_stores");
    assert.equal(Number((await client.query(`SELECT count(*) count FROM brand_stores WHERE library_visible IS DISTINCT FROM ${snackRetailSql()}`)).rows[0].count),0);
    assert.equal(Number((await client.query("SELECT count(*) count FROM brand_stores WHERE tenant_id=2 AND library_visible")).rows[0].count),9);
    for(const filter of [{page:1},{page:58},{page:1000},{page:58,brands:["好想来"]}]){
      const start=performance.now(),result=await listBrandStores(1,filter,(sql,values)=>client.query(sql,values)),elapsed=Math.round(performance.now()-start);
      assert.equal(result.total,filter.brands?30000:60000);
      assert.equal(result.rows.length,50);
      assert.equal(new Set(result.rows.map(row=>row.id)).size,50);
      console.log(JSON.stringify({filter,total:result.total,ms:elapsed}));
      assert.ok(elapsed<500,`筛选/翻页超过500ms预算：${elapsed}ms`);
    }
    const first=await listBrandStores(1,{page:1},(sql,values)=>client.query(sql,values));
    const second=await listBrandStores(1,{page:2},(sql,values)=>client.query(sql,values));
    assert.equal(first.rows.some(row=>second.rows.some(other=>other.id===row.id)),false);
    await client.query("UPDATE brand_stores SET amap_name='零食有鸣仓库' WHERE id=1");
    assert.equal((await client.query("SELECT library_visible FROM brand_stores WHERE id=1")).rows[0].library_visible,false);
    assert.equal((await listBrandStores(1,{brands:["不存在"]},(sql,values)=>client.query(sql,values))).total,0);
  }finally{await client.query("ROLLBACK");client.release()}
});

test("迁移中的可见性计算与当前保留规则一致",()=>{
  const migration=fs.readFileSync(new URL("../server/migrations/009_brand_library_browse.sql",import.meta.url),"utf8");
  assert.ok(migration.includes(`GENERATED ALWAYS AS (${snackRetailSql()}) STORED`));
});
