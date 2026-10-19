-- Included by commercial-security.sql, after catalog.sql and before instance-admission.sql (whose section 9 empties the
-- instance), inside a savepoint that is rolled back at the end: the hooks rewritten here and the records of this file do
-- not reach the checks that follow it.
-- Item 1.13: update protection (supabase/migrations/20261019110000_update_protection.sql, design in
-- docs/arquitetura/1.13.md). The eight private.custom_* hooks, empty by default, run by the zz_custom_validate (before)
-- and zz_custom_after_save (after) triggers of contacts, companies, deals and activities, after every rule of the base;
-- the validation is skipped during the anonymization, during the portfolio move and on a creation that the RLS refuses,
-- and the after-save hook is not; private.assert_base_definition
-- stops a future migration that would replace an object changed by hand, unless the replacement was accepted for the
-- live hash. The manifest and the drift check run in scripts/test-database.mjs (driftCheckChecks).
-- now() is fixed for the whole transaction, so the version read right before a save is the version the save expects.
-- Accounts (organization A): 1 owner A, d1 collaborator P (portfolio holder), d2 collaborator Q (recipient), d3 viewer L
-- (later deactivated).
reset role;
select test_support.sign_out();
savepoint update_protection;
update public.automations set is_active=false where org_id=current_setting('test.org_a')::uuid;
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000d1','carteira-p@example.test',now()),
 ('00000000-0000-0000-0000-0000000000d2','recebedor-q@example.test',now()),
 ('00000000-0000-0000-0000-0000000000d3','leitura-l@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
update public.profiles p set org_id=current_setting('test.org_a')::uuid,name=v.name from (values
 ('00000000-0000-0000-0000-0000000000d1'::uuid,'Carteira P'),
 ('00000000-0000-0000-0000-0000000000d2'::uuid,'Recebedor Q'),
 ('00000000-0000-0000-0000-0000000000d3'::uuid,'Leitura L')
) v(id,name) where p.id=v.id;
insert into public.user_roles(user_id,org_id,role) values
 ('00000000-0000-0000-0000-0000000000d1',current_setting('test.org_a')::uuid,'member'),
 ('00000000-0000-0000-0000-0000000000d2',current_setting('test.org_a')::uuid,'member'),
 ('00000000-0000-0000-0000-0000000000d3',current_setting('test.org_a')::uuid,'viewer');
-- The service_role key writes through the API without an account; the checks below call denied_with as that role.
grant usage on schema test_support to service_role;
grant execute on function test_support.denied_with(text,text,text),test_support.assert(boolean,text) to service_role;

-- 1. The hooks: eight, empty, SECURITY INVOKER, empty search_path, void, no EXECUTE for the API roles.
select test_support.assert((select count(*)=8 from pg_proc p where p.oid in (select to_regprocedure(s) from unnest(array[
  'private.custom_validate_contact(public.contacts,public.contacts)','private.custom_validate_company(public.companies,public.companies)',
  'private.custom_validate_deal(public.deals,public.deals)','private.custom_validate_activity(public.activities,public.activities)',
  'private.custom_after_contact_saved(public.contacts,public.contacts)','private.custom_after_company_saved(public.companies,public.companies)',
  'private.custom_after_deal_saved(public.deals,public.deals)','private.custom_after_activity_saved(public.activities,public.activities)']) s)
 and not p.prosecdef and p.proconfig=array['search_path=""'] and p.prorettype='void'::regtype and p.prosrc ~ '^\s*begin\s+null;\s*end\s*$'),
 'the eight hooks exist, empty, SECURITY INVOKER, with an empty search_path and returning void');
select test_support.assert((select count(*)=8 from pg_proc p where p.pronamespace='private'::regnamespace and p.proname like 'custom\_%'),
 'the base creates no other private.custom_* function');
select test_support.assert(not exists(select 1 from pg_proc p cross join unnest(array['public','anon','authenticated','service_role']) r(role)
 where p.pronamespace='private'::regnamespace and p.proname like 'custom\_%' and has_function_privilege(r.role,p.oid,'execute')),
 'no API role executes a hook directly');
select test_support.assert((select count(*)=8 and bool_and(t.tgenabled='O') from pg_trigger t join pg_proc f on f.oid=t.tgfoid
 where t.tgrelid in ('public.contacts'::regclass,'public.companies'::regclass,'public.deals'::regclass,'public.activities'::regclass)
 and ((t.tgname='zz_custom_validate' and f.oid='private.run_custom_validation()'::regprocedure and t.tgtype & 2 = 2)
  or (t.tgname='zz_custom_after_save' and f.oid='private.run_custom_after_save()'::regprocedure and t.tgtype & 2 = 0))
 and t.tgtype & 1 = 1 and t.tgtype & 4 = 4 and t.tgtype & 16 = 16 and t.tgtype & 8 = 0),
 'each of the four tables has the zz_custom_validate (before) and zz_custom_after_save (after) row triggers on insert and update, enabled');
select test_support.assert((select bool_and(p.prosecdef and p.proconfig=array['search_path=""']) from pg_proc p
 where p.oid in ('private.run_custom_validation()'::regprocedure,'private.run_custom_after_save()'::regprocedure))
 and not exists(select 1 from unnest(array['public','anon','authenticated','service_role']) r(role)
  where has_function_privilege(r.role,'private.run_custom_validation()','execute') or has_function_privilege(r.role,'private.run_custom_after_save()','execute')),
 'the dispatchers are SECURITY DEFINER with an empty search_path and no EXECUTE for the API roles');
select test_support.assert(not exists(select 1 from pg_trigger t where t.tgrelid='public.deals'::regclass and not t.tgisinternal
 and t.tgname>'zz_custom_validate' and t.tgtype & 2 = 2),
 'zz_custom_validate is the last before trigger of deals (alphabetical order)');
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.denied('select private.custom_validate_deal(null,null)','an account cannot call a hook directly');
reset role;
select test_support.sign_out();

-- 2. Validation hooks. Each one records what it saw and refuses with its own message (P0001), whatever the path.
create table private.custom_hook_log(id bigint generated always as identity, entity text not null, new_id uuid, old_id uuid,
 closed_at timestamptz, completed_at timestamptz, anonymized_at timestamptz);
-- Each validation hook also counts its calls in a sequence: nextval is not undone by the subtransaction of denied_with,
-- so a hook that ran inside a refused statement still shows (achado 4 da revisão do 1.13).
create sequence private.custom_hook_calls;
create or replace function private.custom_validate_deal(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.nextval('private.custom_hook_calls');
 insert into private.custom_hook_log(entity,new_id,old_id,closed_at) values('validate_deal',p_new.id,p_old.id,p_new.closed_at);
 if p_new.value>10000 and p_new.company_id is null then raise exception 'Regra da empresa: oportunidade acima de R$ 10.000 precisa de empresa.'; end if;
end $$;
create or replace function private.custom_validate_contact(p_new public.contacts, p_old public.contacts) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.nextval('private.custom_hook_calls');
 insert into private.custom_hook_log(entity,new_id,old_id) values('validate_contact',p_new.id,p_old.id);
 if p_new.job_title='Cargo recusado' then raise exception 'Regra da empresa: informe um cargo da lista.'; end if;
end $$;
create or replace function private.custom_validate_company(p_new public.companies, p_old public.companies) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.nextval('private.custom_hook_calls');
 insert into private.custom_hook_log(entity,new_id,old_id) values('validate_company',p_new.id,p_old.id);
 if p_new.name like '%Proibida%' then raise exception 'Regra da empresa: nome de empresa não permitido.'; end if;
end $$;
create or replace function private.custom_validate_activity(p_new public.activities, p_old public.activities) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 perform pg_catalog.nextval('private.custom_hook_calls');
 insert into private.custom_hook_log(entity,new_id,old_id,completed_at) values('validate_activity',p_new.id,p_old.id,p_new.completed_at);
 if p_new.title='Recusada na criação' then raise exception 'Regra da empresa: título de atividade não permitido.'; end if;
 if p_new.completed_at is not null and p_old.completed_at is null and p_new.title like 'Bloqueada%' then
  raise exception 'Regra da empresa: esta atividade só é concluída com a anotação da reunião.';
 end if;
end $$;
-- Records written while the hooks are empty, for the moves and the completion below.
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id) values
 ('d1300000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,
  'Proteção: pequena',500,'00000000-0000-0000-0000-000000000001');
insert into public.activities(id,org_id,type,title,due_date,user_id) values
 ('d1300000-0000-0000-0000-000000000011',current_setting('test.org_a')::uuid,'meeting','Bloqueada sem anotação',now()+interval '1 day','00000000-0000-0000-0000-000000000001');
select test_support.assert((select count(*)=2 and bool_and(old_id is null) from private.custom_hook_log
 where new_id in ('d1300000-0000-0000-0000-000000000001','d1300000-0000-0000-0000-000000000011')),
 'a validation hook sees p_old null on creation (database owner, SQL editor)');
truncate private.custom_hook_log;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.denied_with(format('insert into public.deals(org_id,pipeline_id,stage_id,title,value) values(%L,%L,%L,''Proteção: grande'',20000)',
 current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),
 'precisa de empresa','a validation hook refuses a deal created through the API');
select test_support.denied_with('update public.deals set value=20000 where id=''d1300000-0000-0000-0000-000000000001''',
 'precisa de empresa','a validation hook refuses a deal edited through the API');
select test_support.denied_with(format('select public.save_deal(gen_random_uuid(),null,%L::jsonb)',jsonb_build_object('title','Proteção: pela RPC',
  'pipeline_id',current_setting('test.pipeline_a'),'stage_id',current_setting('test.stage_a'),'status','open','currency','BRL','value','20000',
  'owner_id','00000000-0000-0000-0000-000000000001')),
 'precisa de empresa','a validation hook refuses a deal created by save_deal');
select test_support.denied_with(format('select public.save_deal(''d1300000-0000-0000-0000-000000000001'',%L,%L::jsonb)',
  (select updated_at from public.deals where id='d1300000-0000-0000-0000-000000000001'),jsonb_build_object('value','20000')),
 'precisa de empresa','a validation hook refuses a deal edited by save_deal');
select test_support.assert((select value=500 from public.deals where id='d1300000-0000-0000-0000-000000000001'),
 'the refused saves change nothing');
-- Winning sets closed_at in validate_deal_change, which runs before the hook: the hook sees the final row.
select public.move_deal('d1300000-0000-0000-0000-000000000001',current_setting('test.stage_a_next')::uuid,'won');
reset role;
select test_support.assert((select closed_at is not null and old_id='d1300000-0000-0000-0000-000000000001' from private.custom_hook_log
 where entity='validate_deal' and new_id='d1300000-0000-0000-0000-000000000001' order by id desc limit 1),
 'the validation hook sees closed_at filled by validate_deal_change and the previous row on move_deal');
-- A deal above the limit written with the hook switched off (a record from before the rule): moving it is refused.
alter table public.deals disable trigger zz_custom_validate;
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id) values
 ('d1300000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,
  'Proteção: anterior à regra',20000,'00000000-0000-0000-0000-000000000001');
alter table public.deals enable trigger zz_custom_validate;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.denied_with(format('select public.move_deal(''d1300000-0000-0000-0000-000000000002'',%L)',current_setting('test.stage_a_next')),
 'precisa de empresa','a validation hook refuses a move by move_deal');
select test_support.assert((select stage_id=current_setting('test.stage_a')::uuid from public.deals where id='d1300000-0000-0000-0000-000000000002'),
 'the refused move keeps the stage');
reset role;
select test_support.sign_out();
set local role service_role;
select test_support.denied_with(format('insert into public.deals(org_id,pipeline_id,stage_id,title,value) values(%L,%L,%L,''Proteção: chave'',20000)',
 current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),
 'precisa de empresa','a validation hook refuses a deal written with the service_role key (the dispatcher is SECURITY DEFINER)');
reset role;
select test_support.denied_with(format('insert into public.deals(org_id,pipeline_id,stage_id,title,value) values(%L,%L,%L,''Proteção: editor'',20000)',
 current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),
 'precisa de empresa','a validation hook refuses a deal written in the SQL editor');
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,job_title) values(%L,''Proteção'',''Cargo recusado'')',current_setting('test.org_a')),
 'informe um cargo da lista','a validation hook refuses a contact');
select test_support.denied_with(format('insert into public.companies(org_id,name) values(%L,''Empresa Proibida'')',current_setting('test.org_a')),
 'nome de empresa não permitido','a validation hook refuses a company');
select test_support.denied_with(format('insert into public.activities(org_id,type,title,user_id) values(%L,''task'',''Recusada na criação'',auth.uid())',current_setting('test.org_a')),
 'título de atividade não permitido','a validation hook refuses an activity');
select test_support.denied_with(format('select public.complete_activity(''d1300000-0000-0000-0000-000000000011'',%L)',
  (select updated_at from public.activities where id='d1300000-0000-0000-0000-000000000011')),
 'só é concluída com a anotação','a validation hook refuses a completion by complete_activity');
select test_support.assert((select completed_at is null from public.activities where id='d1300000-0000-0000-0000-000000000011'),
 'the refused completion leaves the activity pending');
reset role;
select test_support.sign_out();
-- A creation by an account that the RLS refuses (viewer, deactivated) does not reach the validation hook: the WITH
-- CHECK of the INSERT runs after the BEFORE triggers, and the hook must not run (side effect, message) for who cannot
-- write. The count comes from the sequence (a log row would be undone with the refused statement), and the company hook,
-- which does not refuse this name, covers a hook with a side effect only. The third condition of the skip: a
-- collaborator who can write, creating with the org_id of another organization.
select set_config('test.hook_calls',pg_catalog.nextval('private.custom_hook_calls')::text,true);
select test_support.sign_in('00000000-0000-0000-0000-0000000000d3');
set local role authenticated;
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,job_title) values(%L,''Proteção leitura'',''Cargo recusado'')',current_setting('test.org_a')),
 'row-level security','a viewer creation is refused by the RLS, not by the validation hook');
select test_support.denied_with(format('insert into public.deals(org_id,pipeline_id,stage_id,title,value) values(%L,%L,%L,''Proteção: leitura'',20000)',
 current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),
 'row-level security','a viewer deal creation is refused by the RLS, not by the validation hook');
select test_support.denied_with(format('insert into public.companies(org_id,name) values(%L,''Proteção leitura empresa'')',current_setting('test.org_a')),
 'row-level security','a viewer company creation is refused by the RLS (a hook that does not refuse)');
reset role;
select test_support.sign_out();
select test_support.sign_in('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select test_support.denied_with(format('insert into public.companies(org_id,name) values(%L,''Proteção outra organização'')',current_setting('test.org_b')),
 'row-level security','a collaborator creation with the org_id of another organization is refused by the RLS');
select test_support.denied_with(format('insert into public.contacts(org_id,first_name) values(%L,''Proteção outra organização'')',current_setting('test.org_b')),
 'row-level security','a collaborator contact with the org_id of another organization is refused by the RLS');
reset role;
select test_support.sign_out();
select test_support.sign_in('00000000-0000-0000-0000-0000000000d3');
update public.user_roles set role='member',deactivated_at=now() where user_id='00000000-0000-0000-0000-0000000000d3';
set local role authenticated;
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,job_title) values(%L,''Proteção desativada'',''Cargo recusado'')',current_setting('test.org_a')),
 'row-level security','a deactivated account creation is refused by the RLS, not by the validation hook');
reset role;
select test_support.sign_out();
select test_support.assert(pg_catalog.nextval('private.custom_hook_calls')=current_setting('test.hook_calls')::bigint+1,
 'the validation hooks did not run for the creations refused by the RLS (viewer, other organization, deactivated)');

-- The portfolio move (deactivate_member, then transfer_portfolio for the accounts left with the deactivated person) only
-- changes the owner: records from before a rule, which the rule refuses, do not block it, and the person who leaves
-- loses the access. The validation is back on right after the move.
alter table public.deals disable trigger zz_custom_validate;
alter table public.contacts disable trigger zz_custom_validate;
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id) values
 ('d1300000-0000-0000-0000-000000000031',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,
  'Proteção: carteira',20000,'00000000-0000-0000-0000-0000000000d1');
insert into public.contacts(id,org_id,first_name,job_title,owner_id) values
 ('d1300000-0000-0000-0000-000000000032',current_setting('test.org_a')::uuid,'Proteção carteira','Cargo recusado','00000000-0000-0000-0000-0000000000d1');
alter table public.deals enable trigger zz_custom_validate;
alter table public.contacts enable trigger zz_custom_validate;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select public.deactivate_member('00000000-0000-0000-0000-0000000000d1',false,'00000000-0000-0000-0000-0000000000d2');
select test_support.assert((select owner_id='00000000-0000-0000-0000-0000000000d2'::uuid from public.deals where id='d1300000-0000-0000-0000-000000000031'),
 'deactivate_member passes a deal that a validation hook refuses');
reset role;
select test_support.assert((select deactivated_at is not null from public.user_roles where user_id='00000000-0000-0000-0000-0000000000d1'),
 'the person who leaves loses the access despite the validation hook');
set local role authenticated;
select test_support.assert(coalesce(current_setting('crm.moving_portfolio',true),'')='',
 'the portfolio mark is off after the move');
select test_support.denied_with('update public.deals set title=''Proteção: carteira, editada'' where id=''d1300000-0000-0000-0000-000000000031''',
 'precisa de empresa','the validation hook runs again right after the portfolio move');
select public.transfer_portfolio('00000000-0000-0000-0000-0000000000d1',true,'00000000-0000-0000-0000-0000000000d2');
select test_support.assert((select owner_id='00000000-0000-0000-0000-0000000000d2'::uuid from public.contacts where id='d1300000-0000-0000-0000-000000000032'),
 'transfer_portfolio passes a contact that a validation hook refuses');
reset role;
select test_support.sign_out();

-- 3. After-save hooks: a row per creation and edition of each entity, with the right p_old; a failure undoes the save.
create or replace function private.custom_after_contact_saved(p_new public.contacts, p_old public.contacts) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 insert into private.custom_hook_log(entity,new_id,old_id,anonymized_at) values('after_contact',p_new.id,p_old.id,p_new.anonymized_at);
end $$;
create or replace function private.custom_after_company_saved(p_new public.companies, p_old public.companies) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 if p_new.name='Falha depois de salvar' then raise exception 'Regra da empresa: falha no gancho de depois.'; end if;
 insert into private.custom_hook_log(entity,new_id,old_id) values('after_company',p_new.id,p_old.id);
end $$;
create or replace function private.custom_after_deal_saved(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 insert into private.custom_hook_log(entity,new_id,old_id,closed_at) values('after_deal',p_new.id,p_old.id,p_new.closed_at);
end $$;
create or replace function private.custom_after_activity_saved(p_new public.activities, p_old public.activities) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 insert into private.custom_hook_log(entity,new_id,old_id,completed_at) values('after_activity',p_new.id,p_old.id,p_new.completed_at);
end $$;
truncate private.custom_hook_log;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.contacts(id,org_id,first_name,email) values('d1300000-0000-0000-0000-000000000021',current_setting('test.org_a')::uuid,'Proteção Depois','protecao@example.test');
update public.contacts set last_name='Editado' where id='d1300000-0000-0000-0000-000000000021';
insert into public.companies(id,org_id,name) values('d1300000-0000-0000-0000-000000000022',current_setting('test.org_a')::uuid,'Proteção Empresa');
update public.companies set name='Proteção Empresa Editada' where id='d1300000-0000-0000-0000-000000000022';
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,contact_id,company_id) values
 ('d1300000-0000-0000-0000-000000000023',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,
  'Proteção: depois',800,auth.uid(),'d1300000-0000-0000-0000-000000000021','d1300000-0000-0000-0000-000000000022');
update public.deals set title='Proteção: depois, editada' where id='d1300000-0000-0000-0000-000000000023';
insert into public.activities(id,org_id,type,title,user_id,contact_id) values
 ('d1300000-0000-0000-0000-000000000024',current_setting('test.org_a')::uuid,'task','Proteção: tarefa',auth.uid(),'d1300000-0000-0000-0000-000000000021');
select public.complete_activity('d1300000-0000-0000-0000-000000000024',(select updated_at from public.activities where id='d1300000-0000-0000-0000-000000000024'));
reset role;
select test_support.assert((select count(*)=8 from (values
  ('after_contact','d1300000-0000-0000-0000-000000000021'::uuid),('after_company','d1300000-0000-0000-0000-000000000022'),
  ('after_deal','d1300000-0000-0000-0000-000000000023'),('after_activity','d1300000-0000-0000-0000-000000000024')) e(entity,id)
 cross join (values (false),(true)) o(edited)
 where (select count(*) from private.custom_hook_log l where l.entity=e.entity and l.new_id=e.id
   and (case when o.edited then l.old_id=e.id else l.old_id is null end))=1),
 'the after-save hooks record one creation (p_old null) and one edition (p_old filled) of each of the four entities');
select test_support.assert((select completed_at is not null from private.custom_hook_log
 where entity='after_activity' and new_id='d1300000-0000-0000-0000-000000000024' and old_id is not null),
 'the after-save hook sees the completion made by complete_activity');
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.denied_with(format('insert into public.companies(org_id,name) values(%L,''Falha depois de salvar'')',current_setting('test.org_a')),
 'falha no gancho de depois','a failing after-save hook refuses the save');
select test_support.assert(not exists(select 1 from public.companies where name='Falha depois de salvar'),
 'a failing after-save hook undoes the whole save');
reset role;
select test_support.sign_out();

-- 4. Anonymization: the validation does not run (a company rule cannot block a request under the LGPD); the after-save
-- hook runs, with anonymized_at filled, so the student can clean the personal data copied into their own tables.
-- The anonymization also writes the deal linked to the contact (contact_id and the terms) and the company whose reason
-- cites the contact: every validation hook refuses everything, and it passes.
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
update public.companies set do_not_contact=true,do_not_contact_reason='Pedido de protecao@example.test'
 where id='d1300000-0000-0000-0000-000000000022';
reset role;
select test_support.sign_out();
create or replace function private.custom_validate_deal(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Regra da empresa: nenhuma oportunidade pode ser alterada.';
end $$;
create or replace function private.custom_validate_company(p_new public.companies, p_old public.companies) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Regra da empresa: nenhuma empresa pode ser alterada.';
end $$;
create or replace function private.custom_validate_contact(p_new public.contacts, p_old public.contacts) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Regra da empresa: nenhum contato pode ser alterado.';
end $$;
create or replace function private.custom_validate_activity(p_new public.activities, p_old public.activities) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Regra da empresa: nenhuma atividade pode ser alterada.';
end $$;
truncate private.custom_hook_log;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
select test_support.denied_with('update public.contacts set last_name=''De novo'' where id=''d1300000-0000-0000-0000-000000000021''',
 'nenhum contato pode ser alterado','the refusing validation hook is active outside the anonymization');
select public.anonymize_contact('d1300000-0000-0000-0000-000000000021',(select updated_at from public.contacts where id='d1300000-0000-0000-0000-000000000021'));
reset role;
select test_support.assert((select anonymized_at is not null from public.contacts where id='d1300000-0000-0000-0000-000000000021'),
 'the anonymization passes with validation hooks that refuse everything');
select test_support.assert((select contact_id is null from public.deals where id='d1300000-0000-0000-0000-000000000023')
 and (select do_not_contact_reason not like '%protecao@example.test%' from public.companies where id='d1300000-0000-0000-0000-000000000022'),
 'the anonymization writes the linked deal and the company past validation hooks that refuse everything');
select test_support.assert(exists(select 1 from private.custom_hook_log where entity='after_contact'
 and new_id='d1300000-0000-0000-0000-000000000021' and anonymized_at is not null),
 'the after-save hook runs during the anonymization, with anonymized_at filled');

-- 5. The fingerprints: the body of a function written with CRLF (a migration saved on Windows without the
-- .gitattributes) has the hash of the same body with LF; the permissions list only the API roles, never the owner.
create function private.crlf_probe_a() returns int language sql as E'select 1\r\n';
create function private.crlf_probe_b() returns int language sql as E'select 1\n';
select test_support.assert((select count(distinct body_hash)=1 and count(*)=2 from private.base_fingerprints()
 where kind='function' and object in ('private.crlf_probe_a()','private.crlf_probe_b()')),
 'a function body with CRLF has the same fingerprint as with LF');
select test_support.assert((select props->>'acl' from private.base_fingerprints() where kind='function'
  and object='private.custom_validate_deal(public.deals,public.deals)')=''
 and (select props->>'acl' from private.base_fingerprints() where kind='function'
  and object='public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)')='authenticated=X'
 and (select props->>'acl' from private.base_fingerprints() where kind='table' and object='public.contacts')='authenticated=arwd,service_role=arwd'
 and (select props->>'acl' from private.base_fingerprints() where kind='schema' and object='private')='anon=U,authenticated=U',
 'the fingerprint permissions list only PUBLIC, anon, authenticated and service_role (not the owner)');

-- 6. The guard of future migrations: private.assert_base_definition.
select set_config('test.touch_hash',(select hash from private.base_fingerprints() where kind='function' and object='private.touch_updated_at()'),true);
select private.assert_base_definition('function','private.touch_updated_at()',array['0000000000000000',current_setting('test.touch_hash')]);
select test_support.assert(true,'the guard passes when the object has the hash of the manifest');
do $$ begin execute regexp_replace(pg_get_functiondef('private.touch_updated_at()'::regprocedure),'\$function\$',E'$function$\n-- alterada à mão'); end $$;
select set_config('test.touch_live',(select hash from private.base_fingerprints() where kind='function' and object='private.touch_updated_at()'),true);
select test_support.assert(current_setting('test.touch_live')<>current_setting('test.touch_hash'),'a body changed by hand changes the hash');
select test_support.denied_with(format('select private.assert_base_definition(''function'',''private.touch_updated_at()'',array[%L])',current_setting('test.touch_hash')),
 'esta função foi alterada nesta instância e a alteração seria perdida','the guard refuses a function changed by hand');
select test_support.denied_with(format('select private.assert_base_definition(''function'',''private.touch_updated_at()'',array[%L])',current_setting('test.touch_hash')),
 format('insert into private.base_overwrite_consents(kind, object, live_hash) values (''function'', ''private.touch_updated_at()'', %L)',current_setting('test.touch_live')),
 'the refusal carries the insert of the consent with the live hash');
insert into private.base_overwrite_consents(kind,object,live_hash) values('function','private.touch_updated_at()',current_setting('test.touch_live'));
select private.assert_base_definition('function','private.touch_updated_at()',array[current_setting('test.touch_hash')]);
select test_support.assert(true,'the guard passes after the consent for the live hash');
do $$ begin execute regexp_replace(pg_get_functiondef('private.touch_updated_at()'::regprocedure),'\$function\$',E'$function$\n-- alterada de novo'); end $$;
select test_support.denied_with(format('select private.assert_base_definition(''function'',''private.touch_updated_at()'',array[%L])',current_setting('test.touch_hash')),
 'foi alterada nesta instância','the old consent does not cover another hash');
select test_support.denied_with('select private.assert_base_definition(''trigger'',''public.deals.nao_existe'',array[''0000000000000000''])',
 'não existe neste banco','the guard refuses a missing object');
select test_support.denied_with('select private.assert_base_definition(''view'',''public.x'',array[''0000000000000000''])',
 'tipo de objeto desconhecido','the guard refuses an unknown kind');
select test_support.denied('insert into private.base_overwrite_consents(kind,object,live_hash) values(''function'',''private.x()'',''nao-e-hash'')',
 'a consent needs a 16-character hexadecimal hash');
select test_support.assert(not exists(select 1 from unnest(array['public','anon','authenticated','service_role']) r(role)
 where has_table_privilege(r.role,'private.base_overwrite_consents','select,insert,update,delete')
  or has_function_privilege(r.role,'private.assert_base_definition(text,text,text[])','execute')
  or has_function_privilege(r.role,'private.base_fingerprints()','execute')),
 'no API role reads the consents or runs the guard and the fingerprints');
select test_support.assert((select relrowsecurity from pg_class where oid='private.base_overwrite_consents'::regclass),
 'the consents table has RLS on, without policy');
rollback to savepoint update_protection;
