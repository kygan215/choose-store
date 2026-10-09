import { AILINGSHI_ACCEPTED, AILINGSHI_OTHER_FORMAT, AILINGSHI_REASONS, AILINGSHI_SIMILAR } from "../shared/ailingshi.js";
import { snackRetailSql } from "./snack-retail.js";
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const ailingshiFunctionsSql = `
CREATE OR REPLACE FUNCTION ailingshi_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT translate(btrim(normalize(COALESCE(input,''), NFKC), E' \\t\\n\\r'), '。、•∙・', '.,···')
$$;
CREATE OR REPLACE FUNCTION ailingshi_reason(name text, poi_id text, manual text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
 WHEN btrim(COALESCE(poi_id,''))<>'' AND manual='exclude' THEN ${literal(AILINGSHI_REASONS.manualExclude)}
 WHEN btrim(COALESCE(poi_id,''))<>'' AND manual='accept' THEN ${literal(AILINGSHI_REASONS.manualAccept)}
 WHEN ailingshi_normalize(name) ~ ${literal(AILINGSHI_SIMILAR)} THEN ${literal(AILINGSHI_REASONS.similar)}
 WHEN ailingshi_normalize(name) ~ ${literal(AILINGSHI_OTHER_FORMAT)} THEN ${literal(AILINGSHI_REASONS.format)}
 WHEN btrim(COALESCE(poi_id,''))='' THEN ${literal(AILINGSHI_REASONS.noId)}
 WHEN ailingshi_normalize(name) ~ ${literal(AILINGSHI_ACCEPTED)} THEN ${literal(AILINGSHI_REASONS.accepted)}
 ELSE ${literal(AILINGSHI_REASONS.pending)} END
$$;
CREATE OR REPLACE FUNCTION ailingshi_decision(name text, poi_id text, manual text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE ailingshi_reason(name,poi_id,manual)
 WHEN ${literal(AILINGSHI_REASONS.manualAccept)} THEN '接受'
 WHEN ${literal(AILINGSHI_REASONS.accepted)} THEN '接受'
 WHEN ${literal(AILINGSHI_REASONS.manualExclude)} THEN '排除'
 WHEN ${literal(AILINGSHI_REASONS.similar)} THEN '排除'
 WHEN ${literal(AILINGSHI_REASONS.format)} THEN '排除'
 ELSE '待核实' END
$$;`;

export const ailingshiMigrationSql = `${ailingshiFunctionsSql}
CREATE TABLE IF NOT EXISTS ailingshi_poi_overrides (
 tenant_id bigint NOT NULL REFERENCES tenants(id), poi_id text NOT NULL CHECK (btrim(poi_id)<>''),
 decision text NOT NULL CHECK (decision IN ('accept','exclude')), reason text NOT NULL,
 reviewed_by bigint REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT NOW(),
 PRIMARY KEY(tenant_id,poi_id)
);
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS ailingshi_override text NOT NULL DEFAULT '';
ALTER TABLE brand_stores ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE brand_stores ALTER COLUMN latitude DROP NOT NULL;
CREATE OR REPLACE FUNCTION apply_ailingshi_override() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.ailingshi_override := COALESCE((SELECT decision FROM ailingshi_poi_overrides WHERE tenant_id=NEW.tenant_id AND poi_id=NEW.amap_poi_id),'');
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER apply_ailingshi_override BEFORE INSERT OR UPDATE ON brand_stores
 FOR EACH ROW EXECUTE FUNCTION apply_ailingshi_override();
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS normalized_name text GENERATED ALWAYS AS (ailingshi_normalize(amap_name)) STORED;
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS name_decision text GENERATED ALWAYS AS
 (CASE WHEN brand_name='爱零食' THEN ailingshi_decision(amap_name,amap_poi_id,ailingshi_override) ELSE '' END) STORED;
ALTER TABLE brand_stores ADD COLUMN IF NOT EXISTS name_decision_reason text GENERATED ALWAYS AS
 (CASE WHEN brand_name='爱零食' THEN ailingshi_reason(amap_name,amap_poi_id,ailingshi_override) ELSE '' END) STORED;
ALTER TABLE brand_stores ALTER COLUMN library_visible SET EXPRESSION AS
 (CASE WHEN brand_name='爱零食' THEN ailingshi_decision(amap_name,amap_poi_id,ailingshi_override)='接受' ELSE ${snackRetailSql()} END);
CREATE INDEX IF NOT EXISTS idx_ailingshi_review ON brand_stores(tenant_id,name_decision,id) WHERE brand_name='爱零食' AND deleted_at IS NULL;
UPDATE brand_dashboard_snapshots SET invalidated_at=NOW();
UPDATE brand_region_cache c SET store_count=(SELECT count(*) FROM brand_stores s WHERE s.tenant_id=c.tenant_id AND s.brand_name=c.brand_name AND s.province=c.province AND s.city=c.city AND s.library_visible AND s.deleted_at IS NULL) WHERE c.brand_name='爱零食';
ANALYZE brand_stores;
`;
