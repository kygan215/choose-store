-- User-authorized, reversible removal. Analysis tasks and exported reports remain.
BEGIN;
INSERT INTO brand_store_removals(tenant_id,brand_store_id,snapshot_json,reason,deleted_by)
 SELECT tenant_id,id,to_jsonb(s),'用户确认移除'||brand_name||'系统；保留过去分析报告',NULL
 FROM brand_stores s WHERE brand_name IN ('来优品','来伊份') AND deleted_at IS NULL
 ON CONFLICT(tenant_id,brand_store_id) WHERE restored_at IS NULL DO NOTHING;
WITH removed AS (
 UPDATE brand_stores SET deleted_at=now(),deleted_by=NULL,
 delete_reason='用户确认移除'||brand_name||'系统；保留过去分析报告',updated_at=now()
 WHERE brand_name IN ('来优品','来伊份') AND deleted_at IS NULL RETURNING tenant_id,id,brand_name
)
INSERT INTO audit_logs(tenant_id,user_id,action,target_type,details)
 SELECT tenant_id,NULL,'retire_brand','brand_catalog',jsonb_build_object('brand',brand_name,'removed_stores',COUNT(*),'reports_preserved',true)
 FROM removed GROUP BY tenant_id,brand_name;
UPDATE brand_catalog SET active=false,updated_at=now() WHERE standard_name IN ('来优品','来伊份') AND active;
UPDATE brand_dashboard_snapshots SET invalidated_at=now();
COMMIT;
