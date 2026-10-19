-- Approved in this workspace: tenant 1, Monday 12:00, Asia/Shanghai.
-- Fresh installations remain disabled until an administrator configures them.
INSERT INTO brand_refresh_schedules(tenant_id,created_by,enabled,weekday,hour,minute,timezone,next_run_at)
 SELECT t.id,(SELECT id FROM users WHERE tenant_id=t.id AND role='admin' AND active ORDER BY id LIMIT 1),true,1,12,0,'Asia/Shanghai',
 (date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')+interval '12 hours'+
  CASE WHEN date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')+interval '12 hours'<=now() AT TIME ZONE 'Asia/Shanghai' THEN interval '7 days' ELSE interval '0 days' END) AT TIME ZONE 'Asia/Shanghai'
 FROM tenants t WHERE t.id=1 AND EXISTS(SELECT 1 FROM history_activities WHERE tenant_id=t.id)
 ON CONFLICT(tenant_id) DO NOTHING;
