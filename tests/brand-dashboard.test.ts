import assert from "node:assert/strict";
import test from "node:test";
import {aggregateDashboard,filterDashboard,nextDashboardRefresh,DASHBOARD_PROVINCES,UNKNOWN_PROVINCE} from "../shared/brand-dashboard.js";

test("门店逐条汇总，同品牌同省相加，省份简称归一且未知省份不丢失",()=>{
  const data=aggregateDashboard([{province:"湖北省",brand_name:"糖巢",count:"12"},{province:"湖北",brand_name:"糖巢",count:3},{province:"福建省",brand_name:"好想来",count:8},{province:"",brand_name:"糖巢",count:2}]);
  assert.equal(data.total,25);assert.equal(data.matrix.find(row=>row.province==="湖北省")?.total,15);
  assert.equal(data.unknownProvinceCount,2);assert.equal(data.matrix.find(row=>row.province===UNKNOWN_PROVINCE)?.brands["糖巢"],2);
  assert.equal(DASHBOARD_PROVINCES.length,34);assert.equal(new Set(DASHBOARD_PROVINCES).size,34);
});
test("品牌和省份筛选同步总数，清空表示无选中项，不悄悄恢复全部",()=>{
  const data=aggregateDashboard([{province:"湖北省",brand_name:"糖巢",count:12},{province:"湖北省",brand_name:"好想来",count:8},{province:"福建省",brand_name:"糖巢",count:3}]);
  const filtered=filterDashboard(data,["糖巢"],["湖北省"]);
  assert.equal(filtered.total,12);assert.equal(filtered.covered,1);assert.equal(filtered.brandCount,1);
  assert.equal(filterDashboard(data,[],data.provinces).total,0);
  assert.equal(filterDashboard(data,data.brands,[]).total,0);
});
test("空库与特殊品牌名可正确汇总，不受对象原型键影响",()=>{
  assert.equal(aggregateDashboard([]).total,0);
  const data=aggregateDashboard([{province:"湖北省",brand_name:"__proto__",count:2},{province:"湖北省",brand_name:"constructor",count:1}]);
  assert.equal(data.total,3);assert.equal(data.matrix.find(row=>row.province==="湖北省")?.brands.__proto__,2);
  assert.equal(filterDashboard(data,data.brands,data.provinces).total,3);
});
test("每日刷新在北京时间02:00，跨月跨年均指向下一次执行",()=>{
  assert.equal(nextDashboardRefresh(new Date("2026-10-08T17:59:59Z")).toISOString(),"2026-10-08T18:00:00.000Z");
  assert.equal(nextDashboardRefresh(new Date("2026-10-08T18:00:00Z")).toISOString(),"2026-10-09T18:00:00.000Z");
  assert.equal(nextDashboardRefresh(new Date("2026-12-31T20:00:00Z")).toISOString(),"2027-01-01T18:00:00.000Z");
});
