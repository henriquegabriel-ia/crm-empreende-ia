-- Included inside commercial-security.sql's rollback transaction after configuration-permissions.sql.
-- Run through `npm run test:db`: the backfill checks below need the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261011100000_deal_closing_probability.sql right before that migration.
-- Item 0.6: closing date (deals.closed_at) and probability inherited from the stage (decision D8).
-- now() is fixed for the whole transaction: every write below happens at that same instant.
reset role;
-- Backfill over the legacy organization written by supabase/tests/upgrade/20261011100000_deal_closing_probability.sql
-- right before the migration, with dates fixed in the old format.
select test_support.assert((select closed_at='2026-10-05 15:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000001'),'backfill: closed_at is the last entry into won, not a later stage move');
select test_support.assert((select closed_at='2026-09-15 14:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000002'),'backfill: a lost deal closes at its loss');
select test_support.assert((select closed_at='2026-09-25 12:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000003'),'backfill: won, reopened and won again closes at the latest win');
select test_support.assert((select closed_at=created_at from public.deals where id='91000000-0000-0000-0000-000000000004'),'backfill: a deal created already won closes at its creation');
select test_support.assert((select closed_at='2026-09-20 16:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000008'),'backfill: a closed deal without history falls back to its last update');
select test_support.assert(not exists(select 1 from public.deals where org_id='90000000-0000-0000-0000-000000000001' and status='open' and closed_at is not null),'backfill: open deals have no closing date');
select test_support.assert((select probability is null from public.deals where id='91000000-0000-0000-0000-000000000005'),'backfill: an open deal with the stage probability now inherits it');
select test_support.assert((select probability=35 from public.deals where id='91000000-0000-0000-0000-000000000006'),'backfill: a manual probability is kept');
select test_support.assert((select probability is null from public.deals where id='91000000-0000-0000-0000-000000000007'),'backfill: an inherited probability stays NULL');
select test_support.assert((select probability=100 from public.deals where id='91000000-0000-0000-0000-000000000001') and (select probability=0 from public.deals where id='91000000-0000-0000-0000-000000000002'),'backfill: won is 100 and lost is 0');
select test_support.assert((select updated_at='2026-10-07 18:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000001') and (select updated_at='2026-09-10 10:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000005'),'backfill keeps updated_at, so the stale-deal rule still sees old deals');
select test_support.assert((select count(*)=14 from public.deal_stage_history where org_id='90000000-0000-0000-0000-000000000001') and not exists(select 1 from public.audit_logs where org_id='90000000-0000-0000-0000-000000000001'),'backfill writes no history or audit entries');
select test_support.assert(not exists(select 1 from pg_trigger where tgrelid='public.deals'::regclass and not tgisinternal and tgenabled<>'O'),'deal triggers are enabled again after the backfill');
select test_support.assert(exists(select 1 from pg_indexes where schemaname='public' and tablename='deals' and indexdef like '%(org_id, status, closed_at)%'),'deals are indexed by organization, status and closing date');
-- Lifecycle through the API, as the owner of organization A.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,probability,closed_at) values('20000000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Ciclo de fechamento',2000,auth.uid(),null,now());
select test_support.assert((select probability is null and closed_at is null from public.deals where id='20000000-0000-0000-0000-000000000006'),'a new open deal inherits the stage probability and ignores a closing date');
select public.move_deal('20000000-0000-0000-0000-000000000006',current_setting('test.stage_a_next')::uuid);
select test_support.assert((select probability is null and stage_id=current_setting('test.stage_a_next')::uuid from public.deals where id='20000000-0000-0000-0000-000000000006'),'moving keeps an inherited probability as NULL');
update public.deals set probability=40 where id='20000000-0000-0000-0000-000000000006';
select public.move_deal('20000000-0000-0000-0000-000000000006',current_setting('test.stage_a')::uuid);
select test_support.assert((select probability=40 from public.deals where id='20000000-0000-0000-0000-000000000006'),'moving keeps a manual probability');
update public.deals set closed_at=now() where id='20000000-0000-0000-0000-000000000006';
select test_support.assert((select closed_at is null from public.deals where id='20000000-0000-0000-0000-000000000006'),'open deals never keep a closing date');
select public.move_deal('20000000-0000-0000-0000-000000000006',current_setting('test.stage_a')::uuid,'won');
select test_support.assert((select probability=100 and closed_at=now() from public.deals where id='20000000-0000-0000-0000-000000000006'),'winning sets probability 100 and closed_at to now()');
update public.deals set closed_at=now()+interval '6 hours' where id='20000000-0000-0000-0000-000000000006';
select test_support.assert((select closed_at=now()+interval '6 hours' from public.deals where id='20000000-0000-0000-0000-000000000006'),'the closing date can be edited while the deal is won');
select public.move_deal('20000000-0000-0000-0000-000000000006',current_setting('test.stage_a_next')::uuid);
select test_support.assert((select status='won' and closed_at=now()+interval '6 hours' from public.deals where id='20000000-0000-0000-0000-000000000006'),'moving a won deal between stages keeps its closing date');
select test_support.denied('update public.deals set closed_at=now()+interval ''2 days'' where id=''20000000-0000-0000-0000-000000000006''','the closing date cannot be later than one day ahead');
select test_support.denied('update public.deals set closed_at=now()-interval ''1 hour'' where id=''20000000-0000-0000-0000-000000000006''','the closing date cannot precede the deal creation');
-- The browser only keeps milliseconds, so the form rounds created_at (stored with microseconds) up.
update public.deals set closed_at=date_trunc('milliseconds',created_at)+interval '1 millisecond' where id='20000000-0000-0000-0000-000000000006';
select test_support.assert((select closed_at>=created_at and closed_at<=created_at+interval '1 millisecond' from public.deals where id='20000000-0000-0000-0000-000000000006'),'the creation instant rounded up to the millisecond, as the browser sends it, is a valid closing date');
select test_support.denied('update public.deals set closed_at=null where id=''20000000-0000-0000-0000-000000000006''','a won deal keeps a closing date');
select test_support.denied('update public.deals set closed_at=''infinity'' where id=''20000000-0000-0000-0000-000000000006''','infinite closing dates are rejected');
select public.move_deal('20000000-0000-0000-0000-000000000006',current_setting('test.stage_a')::uuid,'open');
select test_support.assert((select status='open' and probability is null and closed_at is null from public.deals where id='20000000-0000-0000-0000-000000000006'),'reopening clears closed_at and returns the probability to the stage');
select public.move_deal('20000000-0000-0000-0000-000000000006',current_setting('test.stage_a')::uuid,'lost','Prazo');
select test_support.assert((select probability=0 and closed_at=now() from public.deals where id='20000000-0000-0000-0000-000000000006'),'losing sets probability 0 and closed_at to now()');
update public.deals set status='won',closed_at=now()+interval '3 hours' where id='20000000-0000-0000-0000-000000000006';
select test_support.assert((select status='won' and probability=100 and closed_at=now()+interval '3 hours' from public.deals where id='20000000-0000-0000-0000-000000000006'),'a closing date informed together with the win is kept');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,owner_id,status) values('20000000-0000-0000-0000-000000000007',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Criada ganha',auth.uid(),'won');
select test_support.assert((select probability=100 and closed_at=now() from public.deals where id='20000000-0000-0000-0000-000000000007'),'a deal created as won closes now with probability 100');
select test_support.denied(format('insert into public.deals(org_id,pipeline_id,stage_id,title,owner_id,status,closed_at) values(%L,%L,%L,''Fechada antes de existir'',auth.uid(),''won'',now()-interval ''1 day'')',current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),'a deal created as won cannot close before it exists');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
with changed as (update public.deals set closed_at=now()+interval '1 hour' where id='20000000-0000-0000-0000-000000000006' returning 1) select test_support.assert(count(*)=0,'viewers cannot change the closing date') from changed;
-- Editing an older closing date, as the owner of the legacy organization.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
update public.deals set closed_at='2026-09-30 15:00:00+00' where id='91000000-0000-0000-0000-000000000001';
select test_support.assert((select closed_at='2026-09-30 15:00:00+00'::timestamptz and updated_at>'2026-10-07 18:00:00+00'::timestamptz from public.deals where id='91000000-0000-0000-0000-000000000001'),'the closing date can be moved back to the real day after creation');
select test_support.denied('update public.deals set closed_at=''2026-08-09 12:00:00+00'' where id=''91000000-0000-0000-0000-000000000001''','the closing date cannot move before the creation of an older deal');
reset role;
