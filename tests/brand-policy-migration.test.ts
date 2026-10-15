import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { brandPolicyFunctionsSql } from "../server/brand-store-policy-sql.js";

test("重复连锁名称迁移与在线策略同版，并只重算受影响的品牌", () => {
  const sql = readFileSync(new URL("../server/migrations/033_brand_store_repeated_names.sql", import.meta.url), "utf8");
  assert.ok(sql.includes(brandPolicyFunctionsSql), "静态迁移应包含当前完整 SQL 规则");
  assert.match(sql, /UPDATE brand_stores SET raw_json=raw_json WHERE brand_name IN \('好特卖','零食优选','加一加','同喜铺子'\)/);
  assert.doesNotMatch(sql, /ALTER TABLE brand_stores ALTER COLUMN .* SET EXPRESSION/);
  assert.match(sql, /UPDATE brand_region_cache/);
  assert.match(sql, /UPDATE brand_dashboard_snapshots/);
});
