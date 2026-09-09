import { query } from "./db.js";
import type { Row } from "./services.js";

type UsageQuery = (text: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>;

export type AmapUsageAttribution = {
  userId?: number | null;
  sourceType?: string;
  sourceId?: string | number | null;
  operation?: string;
  details?: Record<string, unknown>;
};

export class QuotaPauseError extends Error {}

export function normalizeUsageDate(value: unknown): string {
  const candidate = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function consumeBackgroundQuota(
  tenantId: number,
  attribution: AmapUsageAttribution = {},
  runQuery: UsageQuery = query as UsageQuery,
) {
  const limit = Math.max(1, Number(process.env.AMAP_DAILY_LIMIT || 2000));
  const backgroundLimit = Math.max(1, Math.floor(limit * .9));
  const result = await runQuery(
    `WITH reserved AS (
      INSERT INTO amap_usage_daily(tenant_id,usage_date,used_calls)
      VALUES($1,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date,1)
      ON CONFLICT(tenant_id,usage_date) DO UPDATE
      SET used_calls=amap_usage_daily.used_calls+1,updated_at=NOW()
      WHERE amap_usage_daily.used_calls<$2
      RETURNING used_calls,usage_date
    ), logged AS (
      INSERT INTO amap_usage_events(tenant_id,user_id,usage_date,source_type,source_id,operation,calls,details_json,created_at)
      SELECT $1,$3,usage_date,$4,$5,$6,1,$7::jsonb,NOW() FROM reserved
      RETURNING id
    )
    SELECT used_calls FROM reserved`,
    [
      tenantId,
      backgroundLimit,
      attribution.userId || null,
      attribution.sourceType || "unattributed",
      attribution.sourceId == null ? null : String(attribution.sourceId),
      attribution.operation || "amap_request",
      JSON.stringify(attribution.details || {}),
    ],
  );
  if (!result.rows.length) throw new QuotaPauseError("今日高德后台任务额度已达到90%，任务已自动暂停");
  const used = Number(result.rows[0].used_calls);
  return { used, limit, background_limit: backgroundLimit, remaining: Math.max(0, limit - used) };
}

export const isQuotaPauseError = (error: unknown) => error instanceof QuotaPauseError;

export async function usageSummary(tenantId: number, runQuery: UsageQuery = query as UsageQuery) {
  const limit = Math.max(1, Number(process.env.AMAP_DAILY_LIMIT || 2000));
  const used = Number((await runQuery(
    "SELECT used_calls FROM amap_usage_daily WHERE tenant_id=$1 AND usage_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date",
    [tenantId],
  )).rows[0]?.used_calls || 0);
  return { limit, used, remaining: Math.max(0, limit - used), background_limit: Math.floor(limit * .9), reserve: Math.ceil(limit * .1), percent: Math.round(used / limit * 100) };
}

export async function adminUsageReport(tenantId: number, dateInput: unknown, runQuery: UsageQuery = query as UsageQuery) {
  const date = normalizeUsageDate(dateInput);
  const limit = Math.max(1, Number(process.env.AMAP_DAILY_LIMIT || 2000));
  const used = Number((await runQuery(
    "SELECT used_calls FROM amap_usage_daily WHERE tenant_id=$1 AND usage_date=$2::date",
    [tenantId, date],
  )).rows[0]?.used_calls || 0);
  const users = (await runQuery(
    `SELECT e.user_id,u.display_name,u.email,SUM(e.calls)::int used_calls,
      COUNT(DISTINCT (e.source_type,e.source_id))::int task_count,MAX(e.created_at) last_used_at
     FROM amap_usage_events e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.tenant_id=$1 AND e.usage_date=$2::date
     GROUP BY e.user_id,u.display_name,u.email ORDER BY used_calls DESC,u.display_name`,
    [tenantId, date],
  )).rows;
  const events = (await runQuery(
    `SELECT e.id,e.user_id,u.display_name,u.email,e.source_type,e.source_id,e.operation,e.calls,e.details_json,e.created_at
     FROM amap_usage_events e LEFT JOIN users u ON u.id=e.user_id
     WHERE e.tenant_id=$1 AND e.usage_date=$2::date
     ORDER BY e.created_at DESC,e.id DESC LIMIT 500`,
    [tenantId, date],
  )).rows;
  const tasks = (await runQuery(
    `SELECT * FROM (
      SELECT 'brand_discovery' source_type,j.id::text source_id,j.created_by user_id,u.display_name,u.email,
        j.status,j.province title,j.brands_json content_json,j.cities_json regions_json,
        j.total_units total_items,j.processed_units processed_items,j.api_calls recorded_calls,j.created_at,j.updated_at
      FROM brand_discovery_jobs j LEFT JOIN users u ON u.id=j.created_by
      WHERE j.tenant_id=$1 AND j.created_at>=($2::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND j.created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')
      UNION ALL
      SELECT 'poi_analysis' source_type,j.id::text source_id,j.created_by user_id,u.display_name,u.email,
        j.status,j.filename title,j.config_json content_json,'[]'::jsonb regions_json,
        j.total_stores total_items,j.processed_stores processed_items,
        COALESCE((SELECT SUM(e.calls) FROM amap_usage_events e
          WHERE e.tenant_id=j.tenant_id AND e.source_type='poi_analysis' AND e.source_id=j.id::text),0)::int recorded_calls,
        j.created_at,j.updated_at
      FROM jobs j LEFT JOIN users u ON u.id=j.created_by
      WHERE j.tenant_id=$1 AND j.stage='analysis'
        AND j.created_at>=($2::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND j.created_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')
     ) activity ORDER BY created_at DESC`,
    [tenantId, date],
  )).rows;
  const loggedCalls = users.reduce((sum, user) => sum + Number(user.used_calls || 0), 0);
  return {
    date,
    usage: {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      background_limit: Math.floor(limit * .9),
      logged_calls: loggedCalls,
      unlogged_calls: Math.max(0, used - loggedCalls),
    },
    users,
    events,
    tasks,
  };
}
