-- Preserve existing decisions; calculate a changed store's policy once rather
-- than once for each generated column (and again on conflict).
BEGIN;
DO $migration$
DECLARE visibility text; decision_sql text;
BEGIN
 SELECT pg_get_expr(d.adbin,d.adrelid) INTO visibility FROM pg_attribute a
 JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='brand_stores'::regclass AND a.attname='library_visible' AND a.attgenerated<>'';
 IF visibility IS NOT NULL THEN
   EXECUTE format('CREATE OR REPLACE FUNCTION brand_policy_legacy_visibility(s brand_stores) RETURNS boolean LANGUAGE sql IMMUTABLE AS %L',
     'SELECT '||visibility||' FROM (SELECT (s).*) AS original');
 END IF;
 SELECT pg_get_functiondef('brand_policy_decision(text,text,text,text,text,text,jsonb)'::regprocedure) INTO decision_sql;
 decision_sql:=regexp_replace(decision_sql,'CREATE OR REPLACE FUNCTION public.brand_policy_decision\([^)]*\)',
   'CREATE OR REPLACE FUNCTION public.brand_policy_decision_for_reason(reason text)');
 decision_sql:=replace(decision_sql,'brand_policy_reason(brand,name,poi_id,manual,poi_type,codes,raw)','reason');
 EXECUTE decision_sql;
END $migration$;
ALTER TABLE brand_stores ALTER COLUMN library_visible DROP EXPRESSION IF EXISTS;
ALTER TABLE brand_stores ALTER COLUMN needs_review DROP EXPRESSION IF EXISTS;
ALTER TABLE brand_stores ALTER COLUMN name_decision DROP EXPRESSION IF EXISTS;
ALTER TABLE brand_stores ALTER COLUMN name_decision_reason DROP EXPRESSION IF EXISTS;

CREATE OR REPLACE FUNCTION apply_ailingshi_override() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_brand boolean;
BEGIN
 IF btrim(COALESCE(NEW.amap_poi_id,''))<>'' THEN
  NEW.ailingshi_override:=COALESCE((SELECT decision FROM ailingshi_poi_overrides WHERE tenant_id=NEW.tenant_id AND poi_id=NEW.amap_poi_id),'');
 ELSE
  NEW.ailingshi_override:=COALESCE((SELECT decision FROM brand_store_record_overrides WHERE tenant_id=NEW.tenant_id AND brand_store_id=NEW.id),'');
 END IF;
 IF TG_OP='UPDATE' AND current_setting('storemap.recheck_policy',true) IS DISTINCT FROM 'on'
 AND ROW(NEW.brand_name,NEW.amap_name,NEW.amap_poi_id,NEW.ailingshi_override,NEW.poi_type,NEW.typecode,NEW.raw_json,
         NEW.library_visible,NEW.needs_review,NEW.name_decision,NEW.name_decision_reason)
 IS NOT DISTINCT FROM ROW(OLD.brand_name,OLD.amap_name,OLD.amap_poi_id,OLD.ailingshi_override,OLD.poi_type,OLD.typecode,OLD.raw_json,
         OLD.library_visible,OLD.needs_review,OLD.name_decision,OLD.name_decision_reason) THEN RETURN NEW; END IF;
 policy_brand:=NEW.brand_name=ANY(ARRAY['吖嘀吖嘀','好想来','戴永红','来伊份','来优品','爱零食','糖巢','老婆大人','赵一鸣零食','陆小馋','零食很忙','零食悦','零食有鸣','养馋记','优味多','吃货基地','加一加','馋不二','零小惠','好特卖','奉鲜鲜果','购物猩','同喜铺子','零食优选']);
 IF policy_brand THEN
  NEW.name_decision_reason:=brand_policy_reason(NEW.brand_name,NEW.amap_name,NEW.amap_poi_id,NEW.ailingshi_override,NEW.poi_type,NEW.typecode,NEW.raw_json);
  NEW.name_decision:=brand_policy_decision_for_reason(NEW.name_decision_reason);
  NEW.library_visible:=NEW.name_decision='接受';NEW.needs_review:=NEW.name_decision='待核实';
 ELSE
  NEW.library_visible:=brand_policy_legacy_visibility(NEW);
  NEW.needs_review:=false;NEW.name_decision:='';NEW.name_decision_reason:='';
 END IF;
 RETURN NEW;
END $$;
COMMIT;
