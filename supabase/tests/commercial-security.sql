-- Run with `npm run test:db` (scripts/test-database.mjs), the supported way. The runner applies each
-- supabase/tests/upgrade/<migration>.sql right before the migration of the same name, and the backfill
-- checks in deal-lifecycle.sql, automations-deletion.sql, configuration-concurrency.sql and instance-admission.sql
-- depend on that legacy data. To run this file by hand
-- (`psql -v ON_ERROR_STOP=1 -f`), migrate a fresh database the same way first.
-- Pure SQL plus `\ir`: values shared between statements live in set_config('test.<name>', ..., true)
-- and are read back with current_setting('test.<name>'). The trailing ::uuid fails fast, like \gset,
-- when the query that produces the value returns no row.
begin;
create schema test_support;
grant usage on schema test_support to authenticated;
create function test_support.assert(ok boolean, message text) returns void language plpgsql security invoker as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; raise notice 'PASS: %',message; end $$;
create function test_support.denied(statement text, message text) returns void language plpgsql security invoker as $$
begin
 begin execute statement; exception when insufficient_privilege or foreign_key_violation or check_violation or unique_violation or raise_exception then raise notice 'PASS: %',message; return; end;
 raise exception 'FAIL: expected rejection: %',message;
end $$;
-- Like denied, but also checks the rejection text: since item 1.1 the same RPC refuses for different reasons, and the
-- test needs to know which one fired.
create function test_support.denied_with(statement text, fragment text, message text) returns void language plpgsql security invoker as $$
begin
 begin execute statement;
 exception when insufficient_privilege or foreign_key_violation or check_violation or unique_violation or raise_exception then
  if strpos(sqlerrm,fragment)=0 then raise exception 'FAIL: % (rejected with "%", expected "%")',message,sqlerrm,fragment; end if;
  raise notice 'PASS: %',message; return;
 end;
 raise exception 'FAIL: expected rejection: %',message;
end $$;
grant execute on all functions in schema test_support to authenticated;
-- Item 1.1: create_workspace refuses a second company, and the legacy organization written by supabase/tests/upgrade
-- already exists. Organizations A and B are provisioned by private.provision_organization as the database owner, with
-- the owner's sub for the audit. Not granted to authenticated.
create function test_support.provision(p_user uuid, p_name text) returns uuid language plpgsql security invoker as $$
begin
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 return private.provision_organization(p_user,p_name);
end $$;
revoke execute on function test_support.provision(uuid,text) from public,authenticated;
-- Test accounts are created with the signup gate (item 1.1) disabled inside this transaction, because only invited
-- emails create accounts once the instance has a company. instance-admission.sql tests the gate enabled.
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000001','owner-a@example.test',now()),
 ('00000000-0000-0000-0000-000000000002','owner-b@example.test',now()),
 ('00000000-0000-0000-0000-000000000003','viewer@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
select set_config('test.org_a',test_support.provision('00000000-0000-0000-0000-000000000001','Organização A')::text,true)::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select set_config('test.pipeline_a',(select id from public.pipelines limit 1)::text,true)::uuid;
select set_config('test.stage_a',(select id from public.pipeline_stages order by "order" limit 1)::text,true)::uuid;
select set_config('test.stage_a_next',(select id from public.pipeline_stages order by "order" offset 1 limit 1)::text,true)::uuid;
insert into public.contacts(id,org_id,first_name) values('10000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Contato A');
select test_support.denied_with('select public.create_workspace(''Segunda organização'')','Sua conta já pertence a uma organização','cannot create a second workspace for the same membership');
select test_support.denied('update public.profiles set org_id=null where id=auth.uid()','cannot edit organization through the profile');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,owner_id) values
 ('20000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Oportunidade A',1000,'10000000-0000-0000-0000-000000000001',auth.uid());
select test_support.assert((select count(*)=1 from public.deal_stage_history),'new opportunity creates a history entry');
update public.pipeline_stages set name='Etapa renomeada' where id=current_setting('test.stage_a')::uuid;
select test_support.assert((select stage_id=current_setting('test.stage_a')::uuid from public.deals limit 1),'renaming the stage preserves the association');
select public.move_deal('20000000-0000-0000-0000-000000000001',current_setting('test.stage_a_next')::uuid);
select test_support.assert((select count(*)=2 from public.deal_stage_history),'movement appends history');
select test_support.denied('update public.deals set status=''lost'',lost_reason=null','loss requires a reason, including NULL');
select test_support.denied('update public.deals set status=''won'',owner_id=null','win requires an owner');
select test_support.denied('update public.deals set value=-1','negative values are rejected');
select test_support.denied('update public.deals set value=''NaN''::numeric','non-finite deal values are rejected');
select test_support.denied(format('insert into public.payments(org_id,description,amount,due_date) values(%L,''Invalid amount'',''NaN''::numeric,current_date)',current_setting('test.org_a')),'non-finite payment amounts are rejected');
select test_support.denied('delete from public.deal_stage_history','history cannot be forged or deleted');
select test_support.denied('update public.deals set close_date=''infinity''::date','infinite user dates are rejected');
select test_support.denied('update public.deals set id=gen_random_uuid()','record identities cannot change');
update public.deals set created_at='2000-01-01'::timestamptz;
select test_support.assert((select created_at>'2020-01-01'::timestamptz from public.deals limit 1),'record creation time is immutable');
insert into public.automations(org_id,name,trigger_type,task_title,is_active) values(current_setting('test.org_a')::uuid,'Preparar entrega','deal_won','Agendar início',true);
select public.move_deal('20000000-0000-0000-0000-000000000001',current_setting('test.stage_a_next')::uuid,'won');
select test_support.assert((select count(*)=1 from public.activities),'activated automation creates a real activity');
select test_support.assert((select count(*)=1 from public.automation_logs where status='success'),'automation logs its linked activity');
select public.move_deal('20000000-0000-0000-0000-000000000001',current_setting('test.stage_a_next')::uuid,'won');
select test_support.assert((select count(*)=1 from public.activities),'repeating the same status does not duplicate automation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.denied_with('select public.create_workspace(''Organização B'')','Este CRM já tem uma empresa','a second company is refused, also for a confirmed account without organization');
reset role;
select set_config('test.org_b',test_support.provision('00000000-0000-0000-0000-000000000002','Organização B')::text,true)::uuid;
set local role authenticated;
select set_config('test.pipeline_b',(select id from public.pipelines limit 1)::text,true)::uuid;
select set_config('test.stage_b',(select id from public.pipeline_stages limit 1)::text,true)::uuid;
select test_support.assert((select count(*)=0 from public.contacts),'other organizations cannot read contacts');
select test_support.assert((select count(*)=0 from public.deals),'other organizations cannot read deals');
select test_support.assert((select count(*)=0 from public.activities),'other organizations cannot read activities');
select test_support.assert((select count(*)=0 from public.deal_stage_history),'other organizations cannot read history');
select test_support.assert((select count(*)=0 from public.automation_logs),'other organizations cannot read automation logs');
select test_support.denied('insert into public.contacts(org_id,first_name) values(current_setting(''test.org_a'')::uuid,''Injected'')','cannot insert into another organization');
select test_support.denied(format('insert into public.deals(org_id,pipeline_id,stage_id,title,contact_id) values(%L,%L,%L,''Cross tenant'',''10000000-0000-0000-0000-000000000001'')',current_setting('test.org_b'),current_setting('test.pipeline_b'),current_setting('test.stage_b')),'cross-organization contact FK is rejected');
select test_support.denied(format('insert into public.deals(org_id,pipeline_id,stage_id,title) values(%L,%L,%L,''Wrong stage'')',current_setting('test.org_b'),current_setting('test.pipeline_b'),current_setting('test.stage_a')),'stage must belong to the pipeline and organization');
select test_support.denied(format('select public.move_deal(''20000000-0000-0000-0000-000000000001'',%L)',current_setting('test.stage_b')),'cannot move another organization deal');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.profiles set org_id=current_setting('test.org_a')::uuid where id='00000000-0000-0000-0000-000000000003';
insert into public.user_roles(user_id,org_id,role) values('00000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'viewer');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select test_support.assert((select count(*)=1 from public.contacts),'viewer can read own organization');
select test_support.denied(format('insert into public.contacts(org_id,first_name) values(%L,''Forbidden'')',current_setting('test.org_a')),'viewer cannot insert contacts');
select test_support.denied(format('select public.move_deal(''20000000-0000-0000-0000-000000000001'',%L)',current_setting('test.stage_a')),'viewer cannot move deals');
select test_support.denied('insert into public.user_roles(user_id,org_id,role) values(auth.uid(),private.current_org(),''admin'')','users cannot elevate their role');
select test_support.assert(not private.can_manage(),'viewer cannot manage configuration');
select test_support.assert(not private.can_write(),'viewer cannot write');
reset role;
select test_support.assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),'RLS enabled on all public tables');
select test_support.assert(not exists(select 1 from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','PUBLIC')),'no anonymous table privileges');
select test_support.assert(not has_function_privilege('anon','public.create_workspace(text)','execute'),'anonymous cannot create workspace');
select test_support.assert(not has_function_privilege('anon','public.move_deal(uuid,uuid,text,text)','execute'),'anonymous cannot move opportunity');
-- Membership, invitations, search and audit checks run through authenticated policies.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select test_support.denied('select public.set_member_role(auth.uid(),''viewer'')','last owner cannot remove their owner role');
select public.set_member_role('00000000-0000-0000-0000-000000000003','member');
select test_support.assert((select probability=100 from public.deals limit 1),'won deal probability is normalized');
select test_support.assert((select count(*)=1 from public.search_crm('Oportunidade A')),'search opens exact matching record');
select test_support.assert((select count(*)=0 from public.search_crm('%')),'search wildcards are literal');
insert into public.contacts(org_id,first_name,email) values(current_setting('test.org_a')::uuid,'Same name','unique@example.test');
select test_support.denied(format('insert into public.contacts(org_id,first_name,email) values(%L,''Duplicate'',''UNIQUE@example.test'')',current_setting('test.org_a')),'contact email identity is case-insensitive within organization');
select test_support.assert((select count(*)>0 from public.audit_logs),'administrators see real audit events');
select test_support.denied('delete from public.audit_logs','audit events cannot be deleted');
select set_config('test.invite_new',public.create_invitation('new@example.test','member')::text,true)::uuid;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
with removed as (delete from public.contacts returning *) select test_support.assert(count(*)=0,'collaborators cannot delete contacts') from removed;
select test_support.assert((select count(*)=0 from public.audit_logs),'collaborators cannot read administrator audit logs');
select test_support.denied('select public.set_member_role(auth.uid(),''admin'')','collaborator cannot elevate role through RPC');
reset role;
-- The invited email creates its account with the signup gate on; the other two need the gate off.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('00000000-0000-0000-0000-000000000004','new@example.test',null,'{}');
select test_support.assert(exists(select 1 from public.profiles where id='00000000-0000-0000-0000-000000000004' and org_id is null),'an invited email creates its account with the signup gate on');
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000005','wrong@example.test',now(),'{}'),
 ('00000000-0000-0000-0000-000000000006','metadata@example.test',now(),jsonb_build_object('role','owner','org_id',current_setting('test.org_a')));
alter table auth.users enable trigger enforce_invite_only_signup;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select test_support.assert(private.current_org() is null and not private.can_manage(),'mutable signup metadata cannot grant membership or roles');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_new')),'Este convite é para outro e-mail','invitation is bound to its verified email');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_new')),'Confirme seu e-mail','unverified email cannot claim invitation');
reset role;
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000004';
set local role authenticated;
select public.accept_invitation(current_setting('test.invite_new')::uuid);
select test_support.assert(private.current_org()=current_setting('test.org_a')::uuid and private.can_write(),'verified invited user joins correct organization and role');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_new')),'Sua conta já pertence a uma organização','invitation is single-use');
reset role;
\ir configuration-permissions.sql
\ir deal-lifecycle.sql
\ir automations-deletion.sql
\ir configuration-concurrency.sql
\ir instance-admission.sql
rollback;
