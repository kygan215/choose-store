import test from "node:test";
import assert from "node:assert/strict";
import { validateAiExportActivity } from "../app/export-validation";

const completeActivity = {
  activity_name: "周末亲子互动日",
  objective: "触达妈妈带孩子家庭",
  activity_time: "周六 14:00-17:00",
  budget: "",
  gifts: "",
  allowed_formats: "",
  notes: "",
};

test("AI 导出预检会指出具体缺失字段，供页面聚焦反馈", () => {
  assert.deepEqual(validateAiExportActivity({ ...completeActivity, activity_name: "" }, []), {
    message: "请填写活动名称",
    field: "activity_name",
  });
  assert.deepEqual(validateAiExportActivity({ ...completeActivity, objective: " " }, []), {
    message: "请填写活动目标",
    field: "objective",
  });
  assert.deepEqual(validateAiExportActivity({ ...completeActivity, activity_time: "" }, []), {
    message: "请填写活动时间",
    field: "activity_time",
  });
});

test("AI 导出预检会定位活动差异配置错误", () => {
  assert.deepEqual(validateAiExportActivity(completeActivity, ["门店不存在"]), {
    message: "活动差异配置仍有错误，请修正或删除文件",
    field: "activity_overrides",
  });
  assert.equal(validateAiExportActivity(completeActivity, []), null);
});
