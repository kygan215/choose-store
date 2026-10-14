import assert from "node:assert/strict";
import test from "node:test";
import {brandReviewFeedback} from "../app/brand-review-feedback.js";
test("单条和批量核验回显实际接受结果，未纳入时显示硬性规则原因",()=>{
 assert.match(brandReviewFeedback("accept",{accepted:1,excluded:0,pending:0}),/人工纳入已生效/);
 assert.match(brandReviewFeedback("accept",{accepted:0,excluded:1,pending:0,rows:[{amap_name:"好想来(仓库)",name_decision:"排除",name_decision_reason:"名称明确为仓库，非营业门店"}]}),/仍未纳入.*仓库/);
 assert.match(brandReviewFeedback("accept",{accepted:2,excluded:1,pending:0,blocked:[{amap_name:"好想来奶站",name_decision:"排除",name_decision_reason:"奶站不属于目标品牌"}]}),/已接受 2 家.*奶站/);
 assert.match(brandReviewFeedback("reset",{accepted:0,excluded:0,pending:1}),/已恢复自动判断.*待核验 1 家/);
});
