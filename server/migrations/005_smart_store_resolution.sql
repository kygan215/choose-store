ALTER TABLE stores ADD COLUMN IF NOT EXISTS original_row_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS search_input_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS match_candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS confirmation_method TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_stores_job_match_review
  ON stores(job_id,status)
  WHERE status IN ('待确认','匹配失败');
