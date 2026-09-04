CREATE TABLE IF NOT EXISTS brand_catalog (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  standard_name TEXT NOT NULL,
  aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending','rejected')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, standard_name)
);
CREATE INDEX IF NOT EXISTS idx_brand_catalog_tenant_active ON brand_catalog(tenant_id,active,standard_name);

CREATE TABLE IF NOT EXISTS brand_discovery_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  province TEXT NOT NULL,
  cities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  brands_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  force_refresh BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT '等待执行',
  control TEXT NOT NULL DEFAULT 'run',
  total_units INTEGER NOT NULL DEFAULT 0,
  processed_units INTEGER NOT NULL DEFAULT 0,
  found_stores INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  cached_units INTEGER NOT NULL DEFAULT 0,
  current_region TEXT NOT NULL DEFAULT '',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_discovery_jobs_owner ON brand_discovery_jobs(tenant_id,created_by,created_at DESC);

CREATE TABLE IF NOT EXISTS brand_stores (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  source_uid TEXT NOT NULL,
  amap_poi_id TEXT,
  amap_name TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  poi_type TEXT NOT NULL DEFAULT '',
  typecode TEXT NOT NULL DEFAULT '',
  data_status TEXT NOT NULL DEFAULT '正常' CHECK (data_status IN ('正常','新增','更新','疑似关闭','数据异常')),
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_job_id BIGINT REFERENCES brand_discovery_jobs(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_uid)
);
CREATE INDEX IF NOT EXISTS idx_brand_stores_filters ON brand_stores(tenant_id,brand_name,province,city,district);
CREATE INDEX IF NOT EXISTS idx_brand_stores_updated ON brand_stores(tenant_id,last_seen_at DESC);

CREATE TABLE IF NOT EXISTS brand_region_cache (
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  store_count INTEGER NOT NULL DEFAULT 0,
  complete BOOLEAN NOT NULL DEFAULT FALSE,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,brand_name,province,city)
);

CREATE TABLE IF NOT EXISTS amap_usage_daily (
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  used_calls INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,usage_date)
);

CREATE TABLE IF NOT EXISTS brand_export_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_path TEXT,
  error_message TEXT,
  file_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_brand_exports_owner ON brand_export_jobs(tenant_id,created_by,created_at DESC);

ALTER TABLE stores ADD COLUMN IF NOT EXISTS brand_store_id BIGINT REFERENCES brand_stores(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stores_brand_library ON stores(tenant_id,brand_store_id);
