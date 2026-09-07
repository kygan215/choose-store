import assert from "node:assert/strict";
import test from "node:test";
import { matchCandidatesJson } from "../server/store-match.js";

test("门店匹配候选以 JSON 字符串形式写入 jsonb", () => {
  const candidates = [{ id: "B001", name: "测试门店", location: [114.3, 30.5] }];

  const parameter = matchCandidatesJson(candidates);

  assert.equal(typeof parameter, "string");
  assert.deepEqual(JSON.parse(parameter), candidates);
});
