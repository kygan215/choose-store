CREATE TABLE IF NOT EXISTS brand_discovery_units (
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 job_id bigint NOT NULL REFERENCES brand_discovery_jobs(id) ON DELETE CASCADE,
 province text NOT NULL,city text NOT NULL,brand text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','complete','cached','partial','failed')),
 api_calls int NOT NULL DEFAULT 0,saved_stores int NOT NULL DEFAULT 0,
 error_message text,started_at timestamptz,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,province,city,brand)
);
CREATE INDEX IF NOT EXISTS brand_discovery_units_status_idx ON brand_discovery_units(tenant_id,job_id,status);
CREATE TABLE IF NOT EXISTS brand_discovery_pages (
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 job_id bigint NOT NULL REFERENCES brand_discovery_jobs(id) ON DELETE CASCADE,
 province text NOT NULL,city text NOT NULL,brand text NOT NULL,
 request_key text NOT NULL,response_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,province,city,brand,request_key)
);
ALTER TABLE brand_discovery_jobs ADD COLUMN IF NOT EXISTS region_plan_json jsonb NOT NULL DEFAULT '[]';
ALTER TABLE brand_discovery_jobs ADD COLUMN IF NOT EXISTS failed_provinces_json jsonb NOT NULL DEFAULT '[]';
ALTER TABLE brand_discovery_jobs ADD COLUMN IF NOT EXISTS unit_summary_json jsonb NOT NULL DEFAULT '{}';
ALTER TABLE brand_discovery_jobs ADD COLUMN IF NOT EXISTS schedule_key text;
CREATE UNIQUE INDEX IF NOT EXISTS brand_discovery_jobs_schedule_idx ON brand_discovery_jobs(tenant_id,schedule_key) WHERE schedule_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS brand_refresh_schedules (
 tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 weekday int NOT NULL DEFAULT 1 CHECK(weekday BETWEEN 0 AND 6),
 hour int NOT NULL DEFAULT 12 CHECK(hour BETWEEN 0 AND 23),
 minute int NOT NULL DEFAULT 0 CHECK(minute BETWEEN 0 AND 59),
 timezone text NOT NULL DEFAULT 'Asia/Shanghai',
 created_by bigint REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),last_dispatched_at timestamptz,next_run_at timestamptz
);
CREATE TABLE IF NOT EXISTS brand_refresh_runs (
 id bigserial PRIMARY KEY,tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 created_by bigint REFERENCES users(id),due_at timestamptz NOT NULL,
 brands_json jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',dispatch_json jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,due_at)
);
CREATE TABLE IF NOT EXISTS history_match_jobs (
 id bigserial PRIMARY KEY,tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 created_by bigint REFERENCES users(id),status text NOT NULL DEFAULT 'waiting',
 store_ids_json jsonb NOT NULL,total int NOT NULL DEFAULT 0,processed int NOT NULL DEFAULT 0,
 error_message text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS history_poi_candidates (
 tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 history_store_id bigint NOT NULL REFERENCES history_stores(id) ON DELETE CASCADE,
 source_name text NOT NULL,source_brand text NOT NULL,source_province text NOT NULL,source_city text NOT NULL,
 candidates_json jsonb NOT NULL,error_message text,checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,history_store_id)
);
