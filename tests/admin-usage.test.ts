import assert from "node:assert/strict";
import test from "node:test";
import { adminUsageReport, consumeBackgroundQuota, normalizeUsageDate, QuotaPauseError } from "../server/amap-usage.js";

test("额度占用与用户调用日志在同一条数据库语句中完成", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];
  const fakeQuery = async (sql: string, values: unknown[] = []) => {
    capturedSql = sql;
    capturedValues = values;
    return { rows: [{ used_calls: 8 }] };
  };

  const result = await consumeBackgroundQuota(1, {
    userId: 33,
    sourceType: "poi_analysis",
    sourceId: 76,
    operation: "poi_around_search",
    details: { store_id: 6108, category: "小学", page: 1, radius: 500 },
  }, fakeQuery);

  assert.equal(result.used, 8);
  assert.match(capturedSql, /INSERT INTO amap_usage_daily/);
  assert.match(capturedSql, /INSERT INTO amap_usage_events/);
  assert.match(capturedSql, /Asia\/Shanghai/);
  assert.deepEqual(capturedValues.slice(2, 6), [33, "poi_analysis", "76", "poi_around_search"]);
  assert.deepEqual(JSON.parse(String(capturedValues[6])), { store_id: 6108, category: "小学", page: 1, radius: 500 });
});

test("管理员日期筛选只接受标准日期并默认北京时间当天", () => {
  assert.equal(normalizeUsageDate("2026-09-09"), "2026-09-09");
  assert.match(normalizeUsageDate("not-a-date"), /^\d{4}-\d{2}-\d{2}$/);
});

test("额度达到后台保护线时不写调用日志并返回暂停错误", async () => {
  let calls = 0;
  await assert.rejects(
    consumeBackgroundQuota(1, { userId: 10 }, async () => {
      calls += 1;
      return { rows: [] };
    }),
    QuotaPauseError,
  );
  assert.equal(calls, 1);
});

test("管理员报表按全量用户汇总计算精确归属，不受调用明细 500 条上限影响", async () => {
  let call = 0;
  const report = await adminUsageReport(1, "2026-09-09", async () => {
    call += 1;
    if (call === 1) return { rows: [{ used_calls: 1800 }] };
    if (call === 2) return { rows: [{ user_id: 33, used_calls: 1800, task_count: 5 }] };
    if (call === 3) return { rows: [{ id: 1, calls: 1 }] };
    return { rows: [] };
  });
  assert.equal(report.usage.logged_calls, 1800);
  assert.equal(report.usage.unlogged_calls, 0);
});
