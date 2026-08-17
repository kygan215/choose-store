ALTER TABLE stores ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ai_analyses ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

UPDATE jobs j SET created_by=(SELECT u.id FROM users u WHERE u.tenant_id=j.tenant_id ORDER BY CASE WHEN u.role='admin' THEN 0 ELSE 1 END,u.id LIMIT 1) WHERE j.created_by IS NULL;
UPDATE stores s SET created_by=COALESCE((SELECT j.created_by FROM jobs j WHERE j.id=s.job_id),(SELECT u.id FROM users u WHERE u.tenant_id=s.tenant_id ORDER BY CASE WHEN u.role='admin' THEN 0 ELSE 1 END,u.id LIMIT 1)) WHERE s.created_by IS NULL;
UPDATE ai_analyses a SET created_by=COALESCE((SELECT j.created_by FROM jobs j WHERE j.id=a.job_id),(SELECT s.created_by FROM stores s WHERE s.id=a.store_id),(SELECT u.id FROM users u WHERE u.tenant_id=a.tenant_id ORDER BY CASE WHEN u.role='admin' THEN 0 ELSE 1 END,u.id LIMIT 1)) WHERE a.created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_owner_created ON jobs(tenant_id,created_by,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stores_owner_job ON stores(tenant_id,created_by,job_id);
CREATE INDEX IF NOT EXISTS idx_ai_owner_store ON ai_analyses(tenant_id,created_by,store_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_owner_job ON ai_analyses(tenant_id,created_by,job_id,scope,created_at DESC);
