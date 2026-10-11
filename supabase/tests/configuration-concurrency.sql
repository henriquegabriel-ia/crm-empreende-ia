-- Included inside commercial-security.sql's rollback transaction after automations-deletion.sql.
-- Item 0.8: concurrency between colleagues (supabase/migrations/20261011120000_configuration_updated_at.sql).
-- Pipelines, stages and attention rules keep updated_at through touch_updated_at, so the guard used by the screens
-- (.eq('updated_at', version read) with maybeSingle) updates no row when someone else saved first.
-- now() is fixed for the whole transaction: the version read before the colleague saves is written in the past,
-- without triggers.
-- Run through `npm run test:db`: the backfill check needs the legacy rule that the runner writes from
-- supabase/tests/upgrade/20261011120000_configuration_updated_at.sql right before that migration.
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Schema: the same version column, trigger and finite check as the other edited tables.
select test_support.assert((select count(*)=3 from information_schema.columns where table_schema='public' and table_name in ('pipelines','pipeline_stages','risk_rules') and column_name='updated_at' and data_type='timestamp with time zone' and is_nullable='NO' and column_default='now()'),'pipelines, stages and attention rules have updated_at not null default now()');
select test_support.assert((select count(*)=3 from pg_trigger where tgrelid in ('public.pipelines'::regclass,'public.pipeline_stages'::regclass,'public.risk_rules'::regclass) and tgname='touch_updated_at' and tgfoid='private.touch_updated_at()'::regprocedure and tgtype=19 and tgenabled='O'),'pipelines, stages and attention rules renew updated_at before each row update');
select test_support.assert(not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.column_name='updated_at' and not exists(select 1 from pg_trigger t where t.tgrelid=format('public.%I',c.table_name)::regclass and t.tgname='touch_updated_at')),'every public table with updated_at renews it on update');
select test_support.assert((select count(*)=3 from pg_constraint where contype='c' and conname in ('pipelines_updated_at_finite','pipeline_stages_updated_at_finite','risk_rules_updated_at_finite')),'configuration versions only accept finite timestamps');
-- Backfill over the legacy organization: rows that existed before the migration receive its time as first version.
select test_support.assert((select count(*)=4 and bool_and(updated_at<now()) from (
 select updated_at from public.pipelines where org_id='90000000-0000-0000-0000-000000000001'
 union all select updated_at from public.pipeline_stages where org_id='90000000-0000-0000-0000-000000000001'
 union all select updated_at from public.risk_rules where org_id='90000000-0000-0000-0000-000000000001'
) legacy),'existing pipelines, stages and rules receive the migration time as their first version');
-- Versions that owner A read before the colleague saved.
set local session_replication_role=replica;
update public.pipelines set updated_at='2026-10-01 09:00:00+00' where id=current_setting('test.pipeline_a')::uuid;
update public.pipeline_stages set updated_at='2026-10-01 09:00:00+00' where id=current_setting('test.stage_a')::uuid;
update public.risk_rules set updated_at='2026-10-01 09:00:00+00' where org_id=current_setting('test.org_a')::uuid and type='overdue';
set local session_replication_role=origin;
set local role authenticated;
-- The colleague, admin of organization A since configuration-permissions.sql, saves first.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
update public.pipelines set name='Funil do colega' where id=current_setting('test.pipeline_a')::uuid;
update public.pipeline_stages set name='Etapa do colega',win_probability=35 where id=current_setting('test.stage_a')::uuid;
update public.risk_rules set priority=3 where org_id=current_setting('test.org_a')::uuid and type='overdue';
select test_support.assert((select updated_at=now() from public.pipelines where id=current_setting('test.pipeline_a')::uuid),'editing a pipeline renews its version');
select test_support.assert((select updated_at=now() from public.pipeline_stages where id=current_setting('test.stage_a')::uuid),'editing a stage renews its version');
select test_support.assert((select updated_at=now() from public.risk_rules where org_id=current_setting('test.org_a')::uuid and type='overdue'),'editing an attention rule renews its version');
-- The owner saves over the version read before: no row changes, so the screen shows the conflict.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
with changed as (update public.pipelines set name='Minha versão do funil' where id=current_setting('test.pipeline_a')::uuid and updated_at='2026-10-01 09:00:00+00' returning id)
 select test_support.assert(count(*)=0,'a stale pipeline version updates no row') from changed;
with changed as (update public.pipeline_stages set name='Minha versão da etapa',win_probability=90 where id=current_setting('test.stage_a')::uuid and updated_at='2026-10-01 09:00:00+00' returning id)
 select test_support.assert(count(*)=0,'a stale stage version updates no row') from changed;
with changed as (update public.risk_rules set priority=1 where org_id=current_setting('test.org_a')::uuid and type='overdue' and updated_at='2026-10-01 09:00:00+00' returning id)
 select test_support.assert(count(*)=0,'a stale attention rule version updates no row') from changed;
select test_support.assert((select name='Funil do colega' from public.pipelines where id=current_setting('test.pipeline_a')::uuid)
 and (select name='Etapa do colega' and win_probability=35 from public.pipeline_stages where id=current_setting('test.stage_a')::uuid)
 and (select priority=3 from public.risk_rules where org_id=current_setting('test.org_a')::uuid and type='overdue'),'stale writes keep the version saved by the colleague');
with changed as (update public.pipeline_stages set name='Minha versão da etapa' where id=current_setting('test.stage_a')::uuid and updated_at=now() returning id)
 select test_support.assert(count(*)=1,'a write based on the current version is accepted') from changed;
update public.risk_rules set updated_at='2026-10-01 09:00:00+00' where org_id=current_setting('test.org_a')::uuid and type='overdue';
select test_support.assert((select updated_at=now() from public.risk_rules where org_id=current_setting('test.org_a')::uuid and type='overdue'),'a client cannot rewind a version to bypass the guard');
select test_support.denied(format('insert into public.pipelines(org_id,name,updated_at) values(%L,''Funil infinito'',''infinity'')',current_setting('test.org_a')),'pipeline versions must be finite');
select test_support.denied(format('insert into public.pipeline_stages(org_id,pipeline_id,name,updated_at) values(%L,%L,''Etapa infinita'',''infinity'')',current_setting('test.org_a'),current_setting('test.pipeline_a')),'stage versions must be finite');
reset role;
select test_support.assert(exists(select 1 from public.audit_logs where entity_type='pipeline_stages' and entity_id=current_setting('test.stage_a')::uuid and action='update' and changed_fields='{name,win_probability}')
 and not exists(select 1 from public.audit_logs where entity_type in ('pipelines','pipeline_stages','risk_rules') and 'updated_at'=any(changed_fields)),'the audit records what changed and never the version');
