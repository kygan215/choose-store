import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename"),
  status: text("status").notNull().default("等待开始匹配"),
  totalStores: integer("total_stores").notNull().default(0),
  processedStores: integer("processed_stores").notNull().default(0),
  matchedStores: integer("matched_stores").notNull().default(0),
  successStores: integer("success_stores").notNull().default(0),
  failedStores: integer("failed_stores").notNull().default(0),
  configJson: text("config_json").notNull().default("{}"),
  stage: text("stage").notNull().default("match"),
  control: text("control").notNull().default("idle"),
  currentStore: text("current_store").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_jobs_created_at").on(table.createdAt)]);

export const stores = sqliteTable("stores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  inputName: text("input_name").notNull(),
  standardName: text("standard_name"),
  amapPoiId: text("amap_poi_id"),
  longitude: real("longitude"),
  latitude: real("latitude"),
  province: text("province").default(""),
  city: text("city").default(""),
  district: text("district").default(""),
  address: text("address").default(""),
  userCode: text("user_code"),
  brand: text("brand"),
  matchScore: real("match_score"),
  matchStatus: text("match_status").default(""),
  status: text("status").notNull().default("等待匹配"),
  errorMessage: text("error_message"),
  poisJson: text("pois_json").notNull().default("[]"),
  analysisJson: text("analysis_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_stores_job_id").on(table.jobId),
  index("idx_stores_status").on(table.status),
]);

export const aiAnalyses = sqliteTable("ai_analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
  storeIdsJson: text("store_ids_json").notNull().default("[]"),
  inputJson: text("input_json").notNull(),
  resultJson: text("result_json").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_ai_analyses_store_created").on(table.storeId, table.createdAt),
  index("idx_ai_analyses_job_scope_created").on(table.jobId, table.scope, table.createdAt),
]);
