import assert from "node:assert/strict";
import test from "node:test";
import { assessBrandStore, POLICY_REASONS } from "../shared/brand-store-policy.js";

test("没有高德 POI ID 时，仅明确的人工决定可改变默认待核验", () => {
  const row = { name: "赵一鸣零食(测试店)", type: "购物服务;专卖店;专营店", tag: "零食" };
  const automatic = assessBrandStore("赵一鸣零食", row);
  assert.equal(automatic.decision, "待核实");
  assert.equal(automatic.decision_reason, POLICY_REASONS.noId);

  const accepted = assessBrandStore("赵一鸣零食", row, "accept");
  assert.equal(accepted.decision, "接受");
  assert.equal(accepted.decision_reason, POLICY_REASONS.manualRecord);

  const excluded = assessBrandStore("赵一鸣零食", row, "exclude");
  assert.equal(excluded.decision, "排除");
  assert.equal(excluded.decision_reason, POLICY_REASONS.recordExclude);
  assert.equal(assessBrandStore("赵一鸣零食", row).decision, "待核实");
});

test("缺 POI ID 的人工纳入仍遵守明确异业、停业和其他品牌排除", () => {
  for (const name of ["好想来台球店", "好想来品牌零食(暂停营业)", "好想来奶站"])
    assert.equal(assessBrandStore("好想来", { name, tag: "零食" }, "accept").decision, "排除", name);
  assert.equal(assessBrandStore("来优品", { name: "好想来零食乐园(测试店)", tag: "零食" }, "accept").decision, "排除");
});

test("有高德 POI ID 的人工名单语义保持原样", () => {
  const row = { id: "B0EXAMPLE", name: "赵一鸣零食(测试店)", tag: "零食" };
  assert.equal(assessBrandStore("赵一鸣零食", row, "accept").decision_reason, POLICY_REASONS.manual);
  assert.equal(assessBrandStore("赵一鸣零食", row, "exclude").decision_reason, POLICY_REASONS.blacklist);
});
