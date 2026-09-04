import assert from "node:assert/strict";
import test from "node:test";
import { activityCacheKey, normalizeActivityConfig, resolveActivityConfig, scoreParentChildActivity, validateActivityConfig } from "../server/activity-ai.js";
import { buildActivityPrompt, CHILDREN_DRINK_PRODUCT_CONTEXT, type AggregateStore } from "../app/api/deepseek.js";

const rich:AggregateStore={label:"门店A",circles:[{radius:500,total:40,counts:{"幼儿园":3,"小学":4,"中学":1,"住宅小区":12,"公园":2,"购物中心":1,"超市":4,"便利店":6,"公交站":3}}]};
const weak:AggregateStore={label:"门店A",circles:[{radius:500,total:3,counts:{"便利店":2,"中学":1}}]};

test("亲子活动规则评分会按证据形成分层而不是统一满分",()=>{
  const high=scoreParentChildActivity(rich),low=scoreParentChildActivity(weak);
  assert.ok(high.activity_fit_score>low.activity_fit_score);
  assert.ok(high.audience_strength_score>low.audience_strength_score);
  assert.equal(high.core_child_age,"3–12岁");
  assert.notEqual(low.activity_fit_level,"突出");
});

test("AI缓存键同时受POI和活动配置版本影响",()=>{
  const first=normalizeActivityConfig({activity_name:"亲子日",objective:"触达家庭",activity_time:"周六"});
  const same=normalizeActivityConfig({objective:"触达家庭",activity_time:"周六",activity_name:"亲子日"});
  const changed=normalizeActivityConfig({...first,activity_time:"周日"});
  assert.equal(activityCacheKey(rich,first),activityCacheKey(rich,same));
  assert.notEqual(activityCacheKey(rich,first),activityCacheKey(rich,changed));
  assert.notEqual(activityCacheKey(rich,first),activityCacheKey(weak,first));
});

test("活动名称目标和时间为严格必填",()=>{
  assert.equal(validateActivityConfig({}).errors.length,3);
  assert.deepEqual(validateActivityConfig({activity_name:"亲子日",objective:"触达家庭",activity_time:"周六"}).errors,[]);
});

test("未填写活动配置时使用服务器默认值直接生成AI分析",()=>{
  const resolved=resolveActivityConfig({});
  assert.deepEqual(validateActivityConfig(resolved).errors,[]);
  assert.match(resolved.objective,/妈妈带孩子/);
  assert.match(String(resolved.allowed_formats),/儿童饮品试饮/);
});

test("AI活动提示词严格采用儿童健康饮品定位并排除零食试吃和医疗夸大",()=>{
  const text=buildActivityPrompt([rich],{activity_name:"周末亲子日",objective:"触达家庭",activity_time:"周六"},{activity_fit_score:72});
  assert.match(CHILDREN_DRINK_PRODUCT_CONTEXT,/儿童健康饮品/);
  assert.match(text,/妈妈带孩子/);
  assert.match(text,/清热下火、口感好喝/);
  assert.match(text,/禁止写“零食试吃”“散装试吃”“零食试吃区”/);
  assert.match(text,/不得扩展为药品疗效、治疗、治愈或疾病预防承诺/);
  assert.match(text,/周边零食渠道只是活动承载与渠道竞争环境/);
});
