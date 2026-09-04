export type AiExportActivity = {
  activity_name: string;
  objective: string;
  activity_time: string;
};

export type AiExportValidationIssue = {
  message: string;
  field: "activity_name" | "objective" | "activity_time" | "activity_overrides";
};

export function validateAiExportActivity(
  activity: AiExportActivity,
  overrideErrors: string[],
): AiExportValidationIssue | null {
  if (!activity.activity_name.trim()) return { message: "请填写活动名称", field: "activity_name" };
  if (!activity.objective.trim()) return { message: "请填写活动目标", field: "objective" };
  if (!activity.activity_time.trim()) return { message: "请填写活动时间", field: "activity_time" };
  if (overrideErrors.length) return { message: "活动差异配置仍有错误，请修正或删除文件", field: "activity_overrides" };
  return null;
}
