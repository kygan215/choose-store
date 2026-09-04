import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const fields=fs.readFileSync(new URL("../server/batch-export.ts",import.meta.url),"utf8");

test("AI导出不要求用户填写活动配置且单击即可开始后台任务",()=>{
  assert.doesNotMatch(page,/配置本次儿童健康饮品亲子活动/);
  assert.doesNotMatch(page,/核算AI调用并继续/);
  assert.match(page,/生成AI分析并导出/);
  assert.match(page,/if\(hasAiFields\)\{await startAiExport\(\);return\}/);
});

test("界面移除历史规则重算并使用简洁AI字段名称",()=>{
  assert.doesNotMatch(page,/按最新规则重算/);
  assert.match(fields,/label:"AI 活动摘要"/);
  assert.doesNotMatch(fields,/label:"AI 儿童健康饮品/);
});
