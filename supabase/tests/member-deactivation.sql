-- Included by commercial-security.sql, before instance-admission.sql (whose section 9 empties the instance), inside a
-- savepoint that is rolled back at the end: the accounts, records and deactivations of this file do not reach the
-- checks that follow it.
-- Item 1.2: deactivate a member and pass on the portfolio (supabase/migrations/20261013100000_member_deactivation.sql,
-- design in docs/arquitetura/1.2.md). The deactivation is a state of the role (user_roles.deactivated_at), and
-- private.current_org() requires an active role, so every policy and RPC drops the account on the next query, with the
-- same token. deactivate_member passes, in one transaction, the open deals and pending activities (and, if chosen, the
-- contacts and companies) to an active recipient who edits, revokes the pending invitations the person created and
-- records the transfer; a trigger refuses new work assigned to a deactivated member.
-- Run through `npm run test:db`: section 16 needs the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261013100000_member_deactivation.sql right before that migration. The checks with two
-- sessions (the old token in another connection, the race between an assignment and the deactivation in both orders,
-- the colleague who holds a deal of the person, the task on the deal of the person without deadlock, a reference to
-- the portfolio that does not wait, two managers deactivating each other, and the volume of item 0.10) run in
-- scripts/test-database.mjs.
-- Accounts (organization A): 1 owner A, c1 second owner, c2 administrator C, c3 collaborator M (deactivated with a
-- portfolio), c4 collaborator R (recipient), c5 viewer V, c6 administrator D (deactivated with invitations), c7
-- collaborator X (deactivated without a portfolio); 2 owner B; 93 to 95 and 99 from the upgrade file.
reset role;
select test_support.sign_out();
savepoint member_deactivation;
-- Only the automations created here run while deals move in this file.
update public.automations set is_active=false where org_id=current_setting('test.org_a')::uuid;
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000c1','segundo-dono@example.test',now()),
 ('00000000-0000-0000-0000-0000000000c2','admin-c@example.test',now()),
 ('00000000-0000-0000-0000-0000000000c3','membro-m@example.test',now()),
 ('00000000-0000-0000-0000-0000000000c4','recebedora-r@example.test',now()),
 ('00000000-0000-0000-0000-0000000000c5','leitura-v@example.test',now()),
 ('00000000-0000-0000-0000-0000000000c6','admin-d@example.test',now()),
 ('00000000-0000-0000-0000-0000000000c7','membro-x@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
update public.profiles p set org_id=current_setting('test.org_a')::uuid,name=v.name from (values
 ('00000000-0000-0000-0000-0000000000c1'::uuid,'Segundo Dono'),
 ('00000000-0000-0000-0000-0000000000c2'::uuid,'Administração C'),
 ('00000000-0000-0000-0000-0000000000c3'::uuid,'Membro M'),
 ('00000000-0000-0000-0000-0000000000c4'::uuid,'Recebedora R'),
 ('00000000-0000-0000-0000-0000000000c5'::uuid,'Leitura V'),
 ('00000000-0000-0000-0000-0000000000c6'::uuid,'Administração D'),
 ('00000000-0000-0000-0000-0000000000c7'::uuid,'Membro X')
) v(id,name) where p.id=v.id;
insert into public.user_roles(user_id,org_id,role) values
 ('00000000-0000-0000-0000-0000000000c1',current_setting('test.org_a')::uuid,'owner'),
 ('00000000-0000-0000-0000-0000000000c2',current_setting('test.org_a')::uuid,'admin'),
 ('00000000-0000-0000-0000-0000000000c3',current_setting('test.org_a')::uuid,'member'),
 ('00000000-0000-0000-0000-0000000000c4',current_setting('test.org_a')::uuid,'member'),
 ('00000000-0000-0000-0000-0000000000c5',current_setting('test.org_a')::uuid,'viewer'),
 ('00000000-0000-0000-0000-0000000000c6',current_setting('test.org_a')::uuid,'admin'),
 ('00000000-0000-0000-0000-0000000000c7',current_setting('test.org_a')::uuid,'member');

-- 1. Schema.
select test_support.assert((select format_type(atttypid,atttypmod)='timestamp with time zone' and not attnotnull from pg_attribute where attrelid='public.user_roles'::regclass and attname='deactivated_at')
 and exists(select 1 from pg_constraint where conrelid='public.user_roles'::regclass and conname='user_roles_deactivated_at_finite' and pg_get_constraintdef(oid) like '%isfinite(deactivated_at)%'),'user_roles.deactivated_at is a nullable timestamptz with a finite check');
select test_support.assert(pg_get_functiondef('private.current_org()'::regprocedure) like '%join public.user_roles r on r.user_id=p.id and r.org_id=p.org_id and r.deactivated_at is null%','current_org joins an active role');
select test_support.assert((select count(*)=17 and bool_and(p.prosecdef=expected.definer and p.proconfig @> array['search_path=""']) from (values
 ('private.role_change_allowed(text,text,text)',false),
 ('private.current_org()',true),
 ('private.refuse_inactive_assignee()',true),
 ('private.portfolio_counts(uuid,uuid)',false),
 ('private.check_portfolio_recipient(uuid,uuid,uuid)',false),
 ('private.move_member_portfolio(uuid,uuid,uuid,boolean,boolean)',false),
 ('private.member_portfolio(uuid)',true),
 ('public.member_portfolio(uuid)',false),
 ('private.deactivate_member(uuid,boolean,uuid)',true),
 ('public.deactivate_member(uuid,boolean,uuid)',false),
 ('private.transfer_portfolio(uuid,boolean,uuid)',true),
 ('public.transfer_portfolio(uuid,boolean,uuid)',false),
 ('private.reactivate_member(uuid,text)',true),
 ('public.reactivate_member(uuid,text)',false),
 ('private.set_member_role(uuid,text)',true),
 ('private.create_invitation(text,text)',true),
 ('private.restore_owner(text,uuid)',false)
) expected(signature,definer) join pg_proc p on p.oid=expected.signature::regprocedure),'the deactivation functions are SECURITY DEFINER or INVOKER as designed, all with an empty search_path');
select test_support.assert((select count(*)=2 from pg_proc where oid in ('public.deactivate_member(uuid,boolean,uuid)'::regprocedure,'public.transfer_portfolio(uuid,boolean,uuid)'::regprocedure) and proconfig @> array['statement_timeout=60s']),'the transfer RPCs declare a statement_timeout of 60 s');
select test_support.assert((select array_agg(policyname::text) from pg_policies where schemaname='public' and tablename='user_roles' and cmd in ('SELECT','ALL'))='{roles_read}'
 and (select qual like '%current_org()%' and qual like '%auth.uid()%' from pg_policies where schemaname='public' and tablename='user_roles' and policyname='roles_read'),'user_roles has a single read policy: the organization or the own role');
select test_support.assert((select array_agg(policyname::text) from pg_policies where schemaname='public' and tablename='profiles' and cmd in ('UPDATE','ALL'))='{profile_update}'
 and (select qual like '%current_org()%' and with_check like '%current_org()%' from pg_policies where schemaname='public' and tablename='profiles' and policyname='profile_update'),'profile_update requires the organization of the session, in using and with check');
select test_support.assert((select relrowsecurity from pg_class where oid='public.portfolio_transfers'::regclass)
 and (select array_agg(policyname::text) from pg_policies where schemaname='public' and tablename='portfolio_transfers')='{portfolio_transfers_manager_read}'
 and (select cmd='SELECT' and permissive='PERMISSIVE' and qual like '%can_manage()%' from pg_policies where schemaname='public' and tablename='portfolio_transfers'),'portfolio_transfers has RLS and a single read policy, for managers');
select test_support.assert((select count(*)=3 from pg_constraint c where c.conrelid='public.portfolio_transfers'::regclass and c.contype='f' and c.confrelid='public.profiles'::regclass and cardinality(c.conkey)=2
  and (select attname from pg_attribute where attrelid=c.conrelid and attnum=c.conkey[2])='org_id' and c.confdeltype='a')
 and exists(select 1 from pg_constraint where conrelid='public.portfolio_transfers'::regclass and contype='f' and confrelid='public.organizations'::regclass),'portfolio_transfers points to the people through composite foreign keys, without ON DELETE');
select test_support.assert((select count(*)=4 from pg_indexes where schemaname='public' and tablename='portfolio_transfers' and (
  indexdef like '%(org_id, created_at DESC)%' or indexdef like '%(from_user_id, org_id)%' or indexdef like '%(to_user_id, org_id)%' or indexdef like '%(performed_by, org_id)%')),'portfolio_transfers is indexed by organization and time and on every foreign key');
select test_support.assert(not has_table_privilege('anon','public.portfolio_transfers','select,insert,update,delete,truncate,references,trigger')
 and has_table_privilege('authenticated','public.portfolio_transfers','select')
 and not has_table_privilege('authenticated','public.portfolio_transfers','insert,update,delete,truncate,references,trigger'),'anon has no privilege on portfolio_transfers, and authenticated only reads it');
select test_support.assert((select count(*)=4 and bool_and(t.tgtype=23 and t.tgenabled='O' and t.tgfoid='private.refuse_inactive_assignee()'::regprocedure) from pg_trigger t
 where t.tgname='refuse_inactive_assignee' and t.tgrelid in ('public.deals'::regclass,'public.activities'::regclass,'public.contacts'::regclass,'public.companies'::regclass)),'the assignment trigger is an enabled BEFORE INSERT OR UPDATE row trigger on deals, activities, contacts and companies');
select test_support.assert(not exists(select 1 from (values ('private.role_change_allowed(text,text,text)'),('private.refuse_inactive_assignee()'),('private.portfolio_counts(uuid,uuid)'),
 ('private.check_portfolio_recipient(uuid,uuid,uuid)'),('private.move_member_portfolio(uuid,uuid,uuid,boolean,boolean)')) f(signature)
 cross join (values ('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(r.role,f.signature,'execute')),'no API role executes the internal deactivation functions');
select test_support.assert((select bool_and(has_function_privilege('authenticated',f.signature,'execute') and not has_function_privilege('anon',f.signature,'execute')) from (values
 ('public.member_portfolio(uuid)'),('public.deactivate_member(uuid,boolean,uuid)'),('public.transfer_portfolio(uuid,boolean,uuid)'),('public.reactivate_member(uuid,text)'),
 ('private.member_portfolio(uuid)'),('private.deactivate_member(uuid,boolean,uuid)'),('private.transfer_portfolio(uuid,boolean,uuid)'),('private.reactivate_member(uuid,text)')) f(signature)),'the deactivation RPCs run for authenticated and never for anon');
select test_support.assert((select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace='private'::regnamespace and has_function_privilege('anon',p.oid,'execute'))='{instance_status}','anon still executes only instance_status in the private schema');

-- 2. Who grants which role, in one place (the 2A.2 adds manager there).
select test_support.assert((select count(*) filter (where private.role_change_allowed(a,f,t))=20 from unnest(array['owner']) a cross join unnest(array[null,'owner','admin','member','viewer']) f cross join unnest(array['owner','admin','member','viewer']) t),'role rule: an owner changes any role, to any role');
select test_support.assert((select count(*) filter (where private.role_change_allowed(a,f,t))=12 from unnest(array['admin']) a cross join unnest(array[null,'owner','admin','member','viewer']) f cross join unnest(array['owner','admin','member','viewer']) t),'role rule: an administrator changes the 12 combinations without an owner on either side');
select test_support.assert(not private.role_change_allowed('admin','owner','owner') and not private.role_change_allowed('admin','member','owner') and not private.role_change_allowed('admin',null,'owner') and private.role_change_allowed('admin','member','admin') and private.role_change_allowed('admin',null,'viewer'),'role rule: an administrator never touches an owner nor grants the owner role');
select test_support.assert((select count(*) filter (where private.role_change_allowed(a,f,t))=0 from unnest(array['member','viewer',null]) a cross join unnest(array[null,'owner','admin','member','viewer']) f cross join unnest(array['owner','admin','member','viewer']) t),'role rule: collaborators, viewers and an unknown actor change no role');

-- 3. Before: the portfolio of M, written as owner A, and the invitations M created (as the database owner, with M as
-- the author recorded by protect_record_metadata).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,status,lost_reason) values
 ('cd000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Aberta de M 1',1000,'00000000-0000-0000-0000-0000000000c3','open',null),
 ('cd000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Aberta de M 2',2000,'00000000-0000-0000-0000-0000000000c3','open',null),
 ('cd000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Ganha por M',3000,'00000000-0000-0000-0000-0000000000c3','won',null),
 ('cd000000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Perdida por M',4000,'00000000-0000-0000-0000-0000000000c3','lost','Preço'),
 ('cd000000-0000-0000-0000-000000000005',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Aberta de R',5000,'00000000-0000-0000-0000-0000000000c4','open',null),
 ('cd000000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Ganha por R',6000,'00000000-0000-0000-0000-0000000000c4','won',null);
insert into public.activities(id,org_id,type,title,user_id,deal_id,due_date,completed_at) values
 ('ca000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'task','Tarefa pendente de M','00000000-0000-0000-0000-0000000000c3','cd000000-0000-0000-0000-000000000001',now()+interval '1 day',null),
 ('ca000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'call','Ligação pendente de M','00000000-0000-0000-0000-0000000000c3',null,now()+interval '2 days',null),
 ('ca000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'task','Tarefa concluída por M','00000000-0000-0000-0000-0000000000c3',null,now()-interval '1 day',now()),
 ('ca000000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'note','Nota de M','00000000-0000-0000-0000-0000000000c3',null,null,null),
 ('ca000000-0000-0000-0000-000000000005',current_setting('test.org_a')::uuid,'task','Tarefa pendente de R','00000000-0000-0000-0000-0000000000c4',null,now()+interval '1 day',null),
 ('ca000000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,'task','Tarefa concluída por R','00000000-0000-0000-0000-0000000000c4',null,now()-interval '1 day',now());
insert into public.contacts(id,org_id,first_name,owner_id) values
 ('cc000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Contato de M 1','00000000-0000-0000-0000-0000000000c3'),
 ('cc000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Contato de M 2','00000000-0000-0000-0000-0000000000c3'),
 ('cc000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'Contato de R','00000000-0000-0000-0000-0000000000c4');
insert into public.companies(id,org_id,name,owner_id) values
 ('ce000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Empresa de M','00000000-0000-0000-0000-0000000000c3'),
 ('ce000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Empresa de R','00000000-0000-0000-0000-0000000000c4');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
insert into public.invitations(id,org_id,email,role,expires_at,accepted_at) values
 ('c1000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'convite-de-m@example.test','member',now()+interval '5 days',null),
 ('c1000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'vencido-de-m@example.test','viewer',now()-interval '1 day',null),
 ('c1000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'aceito-de-m@example.test','member',now()+interval '5 days',now());
-- Older versions, so the transfer visibly renews updated_at (now() is fixed for the whole test transaction).
set local session_replication_role=replica;
update public.deals set updated_at='2026-09-01 10:00:00+00' where id::text like 'cd000000-%';
update public.activities set updated_at='2026-09-01 10:00:00+00' where id::text like 'ca000000-%';
update public.contacts set updated_at='2026-09-01 10:00:00+00' where id::text like 'cc000000-%';
update public.companies set updated_at='2026-09-01 10:00:00+00' where id::text like 'ce000000-%';
set local session_replication_role=origin;
select test_support.sign_out();
-- M reads and writes the organization with the claims of a sign-in, kept for section 9 (the same token).
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-0000000000c3','password');
select set_config('test.m_claims',current_setting('request.jwt.claims'),true);
select test_support.assert(private.current_org()=current_setting('test.org_a')::uuid and private.can_write()
 and (select count(*)>=3 from public.contacts) and (select count(*)>=6 from public.deals) and (select count(*)>=6 from public.activities),'before: the collaborator M reads the contacts, deals and activities of the organization');
insert into public.contacts(org_id,first_name) values(current_setting('test.org_a')::uuid,'Criado por M antes');
select test_support.assert(exists(select 1 from public.contacts where first_name='Criado por M antes'),'before: M creates a contact');
-- The administrator D reads the configuration and the audit, with its own claims kept for the RPC refusals.
select test_support.sign_in('00000000-0000-0000-0000-0000000000c6','password');
select set_config('test.d_claims',current_setting('request.jwt.claims'),true);
select test_support.assert(private.can_manage() and (select count(*)>0 from public.audit_logs) and (select count(*)=1 from public.organizations),'before: the administrator D reads the organization and the audit');
select set_config('test.d_invite_viewer',public.create_invitation('leitura-por-d@example.test','viewer')::text,true)::uuid;
select set_config('test.d_invite_admin',public.create_invitation('admin-por-d@example.test','admin')::text,true)::uuid;
select test_support.sign_out();

-- 15. member_portfolio: the preview, counted as the transfer counts.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert((select deals=2 and activities=2 and contacts=2 and companies=1 and invitations=2 from public.member_portfolio('00000000-0000-0000-0000-0000000000c3')),'member_portfolio counts the open deals, the pending activities (no note, no completed), the contacts, the companies and the pending invitations');
reset role;
select test_support.assert((select row(c.*)::text from private.portfolio_counts(current_setting('test.org_a')::uuid,'00000000-0000-0000-0000-0000000000c3') c)='(2,2,2,1,2)','member_portfolio and portfolio_counts agree');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',true);
select test_support.denied_with('select * from public.member_portfolio(''00000000-0000-0000-0000-0000000000c3'')','Somente donos e administradores veem a carteira de outra pessoa.','a collaborator cannot read the portfolio of another person');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.denied_with('select * from public.member_portfolio(''00000000-0000-0000-0000-0000000000c3'')','Pessoa indisponível nesta organização.','an owner of another organization cannot read the portfolio');

-- 4. Who deactivates whom. Each accepted case is undone by a sentinel error, so the next case starts from the same state.
do $$
declare c record; v_state text; v_message text;
begin
 for c in select * from (values
  ('an owner deactivates an administrator','00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-0000000000c2'::uuid,null),
  ('an owner deactivates a collaborator','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c7',null),
  ('an owner deactivates a viewer','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c5',null),
  ('an owner deactivates another owner','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1',null),
  ('an administrator deactivates an administrator','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c6',null),
  ('an administrator deactivates a collaborator','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c7',null),
  ('an administrator deactivates a viewer','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c5',null),
  ('an administrator cannot deactivate an owner','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','Somente um dono pode desativar outro dono.'),
  ('a collaborator cannot deactivate','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000c7','Somente donos e administradores podem desativar pessoas.'),
  ('a viewer cannot deactivate','00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000c7','Somente donos e administradores podem desativar pessoas.'),
  ('an owner cannot deactivate their own access','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Você não pode desativar o seu próprio acesso. Peça a outro dono ou administrador.'),
  ('an administrator cannot deactivate their own access','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c2','Você não pode desativar o seu próprio acesso. Peça a outro dono ou administrador.'),
  ('a person of another organization is refused','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Pessoa indisponível nesta organização.'),
  ('an unknown person is refused','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000ff','Pessoa indisponível nesta organização.'),
  ('an owner of another organization cannot deactivate here','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000c7','Pessoa indisponível nesta organização.'),
  ('an account without organization cannot deactivate','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000c7','Somente donos e administradores podem desativar pessoas.')
 ) cases(label,actor,target,refusal) loop
  perform set_config('request.jwt.claim.sub',c.actor::text,true);
  begin
   perform 1 from public.deactivate_member(c.target,false,null);
   if c.refusal is not null then raise exception 'FAIL: deactivation: % (accepted)',c.label; end if;
   perform test_support.assert(exists(select 1 from public.user_roles where user_id=c.target and deactivated_at is not null),'deactivation: '||c.label);
   raise exception using errcode='CRM02',message='undo';
  exception
   when sqlstate 'CRM02' then null;
   when raise_exception then
    get stacked diagnostics v_message=message_text;
    if c.refusal is null or v_message<>c.refusal then raise exception 'FAIL: deactivation: % (rejected with "%")',c.label,v_message; end if;
    perform test_support.assert(true,'deactivation: '||c.label);
  end;
 end loop;
end $$;

-- 7 (before 6). The recipient. A deactivation without a portfolio needs none, and is recorded with zeros.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert((select row(m.*)::text='(0,0,0,0,0)' from public.deactivate_member('00000000-0000-0000-0000-0000000000c7',true) m),'a deactivation without a portfolio needs no recipient and returns zeros');
select test_support.assert((select count(*)=1 and bool_and(to_user_id is null and performed_by=auth.uid() and deactivation and accounts_transferred and deals+activities+contacts+companies+invitations=0)
 from public.portfolio_transfers where from_user_id='00000000-0000-0000-0000-0000000000c7'),'the transfer without a portfolio is recorded with zeros and no recipient');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c7'',false)','Esta pessoa já está desativada.','a person already deactivated is refused');
do $$
declare v_detail text; v_message text;
begin
 begin
  perform 1 from public.deactivate_member('00000000-0000-0000-0000-0000000000c3',false,null);
 exception when raise_exception then
  get stacked diagnostics v_message=message_text,v_detail=pg_exception_detail;
  perform test_support.assert(v_message='Membro M tem 2 oportunidades em aberto e 2 atividades pendentes. Escolha quem recebe a carteira.','without a recipient, the refusal names the person and lists the open deals and the pending activities');
  perform test_support.assert(v_detail::jsonb='{"deals":2,"activities":2,"contacts":2,"companies":1,"invitations":2}'::jsonb,'without a recipient, the refusal sends the counts as JSON in the detail');
 end;
 begin
  perform 1 from public.deactivate_member('00000000-0000-0000-0000-0000000000c3',true,null);
 exception when raise_exception then
  get stacked diagnostics v_message=message_text;
  perform test_support.assert(v_message='Membro M tem 2 oportunidades em aberto, 2 atividades pendentes, 2 contatos e 1 empresa. Escolha quem recebe a carteira.','with the contacts and companies, the refusal lists them too');
  return;
 end;
 raise exception 'FAIL: a deactivation with a portfolio and without a recipient was accepted';
end $$;
select test_support.assert((select deactivated_at is null from public.user_roles where user_id='00000000-0000-0000-0000-0000000000c3'),'a refused deactivation leaves the person active');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c3'',false,''00000000-0000-0000-0000-0000000000c3'')','Escolha outra pessoa para receber a carteira.','the person cannot receive their own portfolio');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c3'',false,''00000000-0000-0000-0000-0000000000c7'')','Quem recebe a carteira precisa estar ativo na equipe e poder editar (dono, administrador ou colaborador).','a deactivated recipient is refused');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c3'',false,''00000000-0000-0000-0000-0000000000c5'')','Quem recebe a carteira precisa estar ativo','a viewer recipient is refused');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c3'',false,''00000000-0000-0000-0000-000000000002'')','Quem recebe a carteira precisa estar ativo','a recipient of another organization is refused');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c3'',false,gen_random_uuid())','Quem recebe a carteira precisa estar ativo','an unknown recipient is refused');

-- 8 (before 6). Atomicity: a failure forced in the middle (the company update, after the deals, activities and
-- contacts) undoes everything.
reset role;
create function test_support.refuse_company_update() returns trigger language plpgsql as $$ begin raise exception 'Falha forçada no meio da transferência.'; end $$;
create trigger test_refuse_company_update before update on public.companies for each row execute function test_support.refuse_company_update();
set local role authenticated;
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-0000000000c4'')','Falha forçada no meio da transferência.','a failure in the middle of the transfer refuses the deactivation');
reset role;
drop trigger test_refuse_company_update on public.companies;
drop function test_support.refuse_company_update();
select test_support.assert((select deactivated_at is null from public.user_roles where user_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=4 from public.deals where owner_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=4 from public.activities where user_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=2 from public.contacts where owner_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=3 from public.invitations where invited_by='00000000-0000-0000-0000-0000000000c3')
 and not exists(select 1 from public.portfolio_transfers where from_user_id='00000000-0000-0000-0000-0000000000c3'),'the failed transfer leaves the person active, with the whole portfolio, the invitations and no transfer record');

-- 6. The transfer: M deactivated by owner A, with R as the recipient and the contacts and companies kept.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert((select row(m.*)::text='(2,2,0,0,2)' from public.deactivate_member('00000000-0000-0000-0000-0000000000c3',false,'00000000-0000-0000-0000-0000000000c4') m),'deactivate_member returns what changed: 2 deals, 2 activities, no contact or company and 2 invitations');
select test_support.assert((select deactivated_at=now() from public.user_roles where user_id='00000000-0000-0000-0000-0000000000c3'),'the person is deactivated');
select test_support.assert((select bool_and(owner_id='00000000-0000-0000-0000-0000000000c4' and updated_at=now()) from public.deals where id in ('cd000000-0000-0000-0000-000000000001','cd000000-0000-0000-0000-000000000002')),'the open deals go to the recipient, with a new version');
select test_support.assert((select bool_and(owner_id='00000000-0000-0000-0000-0000000000c3' and updated_at='2026-09-01 10:00:00+00') from public.deals where id in ('cd000000-0000-0000-0000-000000000003','cd000000-0000-0000-0000-000000000004'))
 and (select owner_id='00000000-0000-0000-0000-0000000000c4' from public.deals where id='cd000000-0000-0000-0000-000000000005'),'won and lost deals stay with the person, untouched, and the deals of others do not change');
select test_support.assert((select bool_and(user_id='00000000-0000-0000-0000-0000000000c4' and updated_at=now()) from public.activities where id in ('ca000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000002')),'the pending activities go to the recipient, with a new version');
select test_support.assert((select bool_and(user_id='00000000-0000-0000-0000-0000000000c3' and updated_at='2026-09-01 10:00:00+00') from public.activities where id in ('ca000000-0000-0000-0000-000000000003','ca000000-0000-0000-0000-000000000004')),'the completed activity and the note stay with the person, untouched');
select test_support.assert((select count(*)=2 and bool_and(updated_at='2026-09-01 10:00:00+00') from public.contacts where owner_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=1 from public.companies where owner_id='00000000-0000-0000-0000-0000000000c3'),'without p_transfer_accounts, the contacts and companies stay with the person');
select test_support.assert((select count(*)=1 and bool_and(to_user_id='00000000-0000-0000-0000-0000000000c4' and performed_by=auth.uid() and deactivation and not accounts_transferred
 and deals=2 and activities=2 and contacts=0 and companies=0 and invitations=2 and created_at=now()) from public.portfolio_transfers where from_user_id='00000000-0000-0000-0000-0000000000c3'),'the transfer is recorded in portfolio_transfers, with the author and the counts');
select test_support.assert((select count(*)=4 and bool_and(user_id=auth.uid() and changed_fields=case entity_type when 'deals' then '{owner_id}'::text[] else '{user_id}'::text[] end)
 from public.audit_logs where action='update' and entity_id in ('cd000000-0000-0000-0000-000000000001','cd000000-0000-0000-0000-000000000002','ca000000-0000-0000-0000-000000000001','ca000000-0000-0000-0000-000000000002')),'each transferred record has one audit row with the author and only the responsible field');
select test_support.assert(exists(select 1 from public.audit_logs l join public.user_roles r on r.id=l.entity_id where r.user_id='00000000-0000-0000-0000-0000000000c3' and l.entity_type='user_roles' and l.user_id=auth.uid() and l.changed_fields='{deactivated_at}'),'the deactivation itself is audited with the author');
select test_support.assert(not exists(select 1 from public.invitations where id in ('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002'))
 and exists(select 1 from public.invitations where id='c1000000-0000-0000-0000-000000000003')
 and (select count(*)=2 from public.audit_logs where entity_type='invitations' and action='delete' and user_id=auth.uid() and entity_id in ('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002')),'the pending invitations of the person, valid or expired, are revoked with audit, and the accepted one stays');
-- 13. "Passar carteira": what stayed with a deactivated person, with the recipient rules and the atomicity of
-- deactivate_member (AC-12).
do $$
declare v_detail text; v_message text;
begin
 begin
  perform 1 from public.transfer_portfolio('00000000-0000-0000-0000-0000000000c3',true,null);
 exception when raise_exception then
  get stacked diagnostics v_message=message_text,v_detail=pg_exception_detail;
  perform test_support.assert(v_message='Membro M tem 2 contatos e 1 empresa. Escolha quem recebe a carteira.','transfer_portfolio without a recipient names the person and lists what is left');
  perform test_support.assert(v_detail::jsonb='{"deals":0,"activities":0,"contacts":2,"companies":1,"invitations":0}'::jsonb,'transfer_portfolio without a recipient sends the counts as JSON in the detail');
  return;
 end;
 raise exception 'FAIL: transfer_portfolio with a portfolio and without a recipient was accepted';
end $$;
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-0000000000c3'')','Escolha outra pessoa para receber a carteira.','transfer_portfolio: the person cannot receive their own portfolio');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-0000000000c5'')','Quem recebe a carteira precisa estar ativo na equipe e poder editar (dono, administrador ou colaborador).','transfer_portfolio: a viewer recipient is refused');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-0000000000c7'')','Quem recebe a carteira precisa estar ativo','transfer_portfolio: a deactivated recipient is refused');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-000000000002'')','Quem recebe a carteira precisa estar ativo','transfer_portfolio: a recipient of another organization is refused');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,gen_random_uuid())','Quem recebe a carteira precisa estar ativo','transfer_portfolio: an unknown recipient is refused');
-- A failure forced in the middle (the company update, after the contacts) undoes the whole "Passar carteira".
reset role;
create function test_support.refuse_company_update() returns trigger language plpgsql as $$ begin raise exception 'Falha forçada no meio da transferência.'; end $$;
create trigger test_refuse_company_update before update on public.companies for each row execute function test_support.refuse_company_update();
set local role authenticated;
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-0000000000c4'')','Falha forçada no meio da transferência.','transfer_portfolio: a failure in the middle refuses the transfer');
reset role;
drop trigger test_refuse_company_update on public.companies;
drop function test_support.refuse_company_update();
select test_support.assert((select count(*)=2 from public.contacts where owner_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=1 from public.companies where owner_id='00000000-0000-0000-0000-0000000000c3')
 and not exists(select 1 from public.portfolio_transfers where from_user_id='00000000-0000-0000-0000-0000000000c3' and not deactivation),'the failed transfer_portfolio leaves the contacts and companies with the person and records no transfer');
set local role authenticated;
select test_support.assert((select row(m.*)::text='(0,0,2,1,0)' from public.transfer_portfolio('00000000-0000-0000-0000-0000000000c3',true,'00000000-0000-0000-0000-0000000000c4') m),'transfer_portfolio passes the contacts and companies kept on the deactivation');
select test_support.assert(not exists(select 1 from public.contacts where owner_id='00000000-0000-0000-0000-0000000000c3') and not exists(select 1 from public.companies where owner_id='00000000-0000-0000-0000-0000000000c3')
 and (select count(*)=1 from public.portfolio_transfers where from_user_id='00000000-0000-0000-0000-0000000000c3' and not deactivation and accounts_transferred and contacts=2 and companies=1),'the contacts and companies are with the recipient, and the transfer is recorded as not a deactivation');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-0000000000c4'')','Esta pessoa não tem mais carteira para passar.','transfer_portfolio refuses a person without a portfolio left');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c4'',true,''00000000-0000-0000-0000-000000000001'')','Esta pessoa está ativa. Para passar a carteira dela, use “Desativar”.','transfer_portfolio refuses an active person');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c7'',false,''00000000-0000-0000-0000-0000000000c4'')','Esta pessoa não tem mais carteira para passar.','transfer_portfolio refuses a deactivated person who never had a portfolio');
-- An administrator passes the portfolio of a deactivated owner: it is reassignment of data, which the administrator
-- already does record by record (design, section 4.4). Undone by the savepoint.
savepoint owner_portfolio;
insert into public.contacts(id,org_id,first_name,owner_id) values('cc000000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'Contato do segundo dono','00000000-0000-0000-0000-0000000000c1');
select test_support.assert((select row(m.*)::text='(0,0,0,0,0)' from public.deactivate_member('00000000-0000-0000-0000-0000000000c1',false) m),'an owner deactivates the second owner and keeps the contact with them');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.assert((select row(m.*)::text='(0,0,1,0,0)' from public.transfer_portfolio('00000000-0000-0000-0000-0000000000c1',true,'00000000-0000-0000-0000-0000000000c4') m),'an administrator passes the portfolio of a deactivated owner');
select test_support.assert((select owner_id='00000000-0000-0000-0000-0000000000c4' from public.contacts where id='cc000000-0000-0000-0000-000000000004'),'the contact of the deactivated owner is with the recipient');
rollback to savepoint owner_portfolio;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
-- The administrator C deactivates the administrator D, whose two pending invitations are revoked.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.assert((select row(m.*)::text='(0,0,0,0,2)' from public.deactivate_member('00000000-0000-0000-0000-0000000000c6',true) m),'an administrator deactivates another administrator, and the invitations D created are revoked');
select test_support.assert(not exists(select 1 from public.invitations where id in (current_setting('test.d_invite_viewer')::uuid,current_setting('test.d_invite_admin')::uuid)),'the invitations of D are gone');

-- 9. After, with the same claims (the token issued before the deactivation): no read, no write.
select set_config('request.jwt.claims',current_setting('test.m_claims'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
select test_support.assert(private.current_org() is null and not private.can_write() and not private.can_manage() and not private.is_owner(),'after: current_org is null and can_write, can_manage and is_owner are false for M');
select test_support.assert((select count(*)=0 from public.contacts) and (select count(*)=0 from public.deals) and (select count(*)=0 from public.activities),'after: M reads no contact, deal or activity with the same token');
select test_support.denied(format('insert into public.contacts(org_id,first_name) values(%L,''Criado por M depois'')',current_setting('test.org_a')),'after: M cannot create a contact');
with changed as (update public.profiles set name='Nome trocado por M' where id=auth.uid() returning 1) select test_support.assert(count(*)=0,'after: M cannot change their own profile') from changed;
with changed as (update public.contacts set first_name='Trocado' returning 1) select test_support.assert(count(*)=0,'after: M changes no contact') from changed;
select set_config('request.jwt.claims',current_setting('test.d_claims'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c6',true);
do $$
declare t text; n integer;
begin
 foreach t in array array['organizations','companies','contacts','pipelines','pipeline_stages','deals','activities','deal_stage_history','payments','risk_rules',
  'automations','automation_logs','integration_configs','email_templates','invitations','onboarding_progress','audit_logs','portfolio_transfers'] loop
  execute format('select count(*) from public.%I',t) into n;
  perform test_support.assert(n=0,'after: the deactivated administrator D reads no row of '||t);
 end loop;
end $$;
select test_support.assert((select count(*)=1 and bool_and(id=auth.uid() and org_id=current_setting('test.org_a')::uuid) from public.profiles),'after: D reads only their own profile, still in the organization');
select test_support.assert((select count(*)=1 and bool_and(user_id=auth.uid() and role='admin' and deactivated_at=now()) from public.user_roles),'after: D reads only their own role, with the deactivation date');
with removed as (delete from public.contacts returning 1) select test_support.assert(count(*)=0,'after: D deletes no contact') from removed;
select test_support.denied_with(format('select public.move_deal(''cd000000-0000-0000-0000-000000000005'',%L)',current_setting('test.stage_a_next')),'Você não tem permissão para alterar oportunidades.','after: move_deal refuses D');
select test_support.denied_with('select public.delete_deal(''cd000000-0000-0000-0000-000000000005'',true)','Somente administradores podem excluir oportunidades.','after: delete_deal refuses D');
select test_support.denied_with('select public.create_invitation(''depois@example.test'',''member'')','Somente donos e administradores podem convidar pessoas.','after: create_invitation refuses D');
select test_support.denied_with('select public.set_member_role(''00000000-0000-0000-0000-0000000000c4'',''viewer'')','Somente donos e administradores podem alterar papéis.','after: set_member_role refuses D');
select test_support.denied_with('select * from public.member_portfolio(''00000000-0000-0000-0000-0000000000c4'')','Somente donos e administradores veem a carteira de outra pessoa.','after: member_portfolio refuses D');
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-0000000000c4'',true,''00000000-0000-0000-0000-000000000001'')','Somente donos e administradores podem desativar pessoas.','after: deactivate_member refuses D');
select test_support.denied_with('select * from public.transfer_portfolio(''00000000-0000-0000-0000-0000000000c3'',true,''00000000-0000-0000-0000-000000000001'')','Somente donos e administradores podem passar a carteira de outra pessoa.','after: transfer_portfolio refuses D');
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-0000000000c6'',''admin'')','Somente donos e administradores podem reativar pessoas.','after: D cannot reactivate themselves');
select test_support.denied_with('select * from public.automation_log_errors(gen_random_uuid())','Somente administradores veem o detalhe técnico das falhas.','after: automation_log_errors refuses D');
select test_support.denied_with('select public.accept_invitation(gen_random_uuid())','Sua conta já pertence a uma organização.','after: accept_invitation refuses D, whose profile is still in the organization');
select test_support.denied_with('select public.create_workspace(''Empresa da conta desativada'')','Este CRM já tem uma empresa.','after: create_workspace refuses D');
select test_support.sign_out();
-- The other side of profile_update (Configurações saves the name with it): an active member and an account without
-- organization still change their own profile, and nobody changes the profile of another person.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',true);
with changed as (update public.profiles set name='Recebedora R' where id=auth.uid() returning 1) select test_support.assert(count(*)=1,'profile_update: the active collaborator R changes their own profile') from changed;
with changed as (update public.profiles set name='Trocado por R' where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c3') returning 1) select test_support.assert(count(*)=0,'profile_update: an active member changes no profile of another person, active or deactivated') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select test_support.assert((select org_id is null from public.profiles where id=auth.uid()),'profile_update: the account 5 has no organization');
with changed as (update public.profiles set name=name where id=auth.uid() returning 1) select test_support.assert(count(*)=1,'profile_update: an account without organization changes their own profile') from changed;
select test_support.sign_out();

-- 10. Assignment trigger: no new work for a deactivated member (M), as owner A.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.denied_with(format('insert into public.deals(org_id,pipeline_id,stage_id,title,owner_id) values(%L,%L,%L,''Nova para M'',''00000000-0000-0000-0000-0000000000c3'')',current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),
 'O responsável escolhido foi desativado e não recebe oportunidades em aberto. Escolha outra pessoa em “Responsável”.','trigger: an open deal cannot be created for a deactivated member');
select test_support.denied_with('update public.deals set owner_id=''00000000-0000-0000-0000-0000000000c3'' where id=''cd000000-0000-0000-0000-000000000005''','O responsável escolhido foi desativado','trigger: an open deal cannot be assigned to a deactivated member');
select test_support.denied_with(format('select public.move_deal(''cd000000-0000-0000-0000-000000000003'',%L,''open'')',current_setting('test.stage_a')),
 'O responsável desta oportunidade foi desativado. Para reabri-la, troque antes o “Responsável” em “Editar”.','trigger: a won deal of a deactivated member cannot be reopened');
select test_support.denied_with('update public.deals set status=''open'',owner_id=''00000000-0000-0000-0000-0000000000c3'' where id=''cd000000-0000-0000-0000-000000000006''','O responsável escolhido foi desativado','trigger: a closed deal cannot be reopened for a deactivated member');
select test_support.denied_with(format('insert into public.activities(org_id,type,title,user_id,due_date) values(%L,''task'',''Nova tarefa para M'',''00000000-0000-0000-0000-0000000000c3'',now())',current_setting('test.org_a')),
 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.','trigger: a pending activity cannot be created for a deactivated member');
select test_support.denied_with('update public.activities set user_id=''00000000-0000-0000-0000-0000000000c3'' where id=''ca000000-0000-0000-0000-000000000005''','A pessoa escolhida como responsável foi desativada','trigger: a pending activity cannot be assigned to a deactivated member');
select test_support.denied_with('update public.activities set completed_at=null where id=''ca000000-0000-0000-0000-000000000003''',
 'O responsável desta atividade foi desativado. Para reabri-la, troque antes o “Responsável” ao editar a atividade.','trigger: a completed activity of a deactivated member cannot be reopened');
select test_support.denied_with('update public.activities set type=''task'',due_date=now() where id=''ca000000-0000-0000-0000-000000000004''','A pessoa escolhida como responsável foi desativada','trigger: a note of a deactivated member cannot become a pending task');
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,owner_id) values(%L,''Novo de M'',''00000000-0000-0000-0000-0000000000c3'')',current_setting('test.org_a')),
 'A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.','trigger: a contact cannot be created for a deactivated member');
select test_support.denied_with('update public.contacts set owner_id=''00000000-0000-0000-0000-0000000000c3'' where id=''cc000000-0000-0000-0000-000000000003''','A pessoa escolhida como responsável foi desativada','trigger: a contact cannot be assigned to a deactivated member');
select test_support.denied_with(format('insert into public.companies(org_id,name,owner_id) values(%L,''Nova de M'',''00000000-0000-0000-0000-0000000000c3'')',current_setting('test.org_a')),'A pessoa escolhida como responsável foi desativada','trigger: a company cannot be created for a deactivated member');
select test_support.denied_with('update public.companies set owner_id=''00000000-0000-0000-0000-0000000000c3'' where id=''ce000000-0000-0000-0000-000000000002''','A pessoa escolhida como responsável foi desativada','trigger: a company cannot be assigned to a deactivated member');
reset role;
-- A profile of the organization without any role (written by SQL after the migration) counts as inactive.
update public.profiles set org_id=current_setting('test.org_a')::uuid where id='00000000-0000-0000-0000-000000000005';
set local role authenticated;
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,owner_id) values(%L,''Sem papel'',''00000000-0000-0000-0000-000000000005'')',current_setting('test.org_a')),'A pessoa escolhida como responsável foi desativada','trigger: a profile without a role counts as inactive');
reset role;
update public.profiles set org_id=null where id='00000000-0000-0000-0000-000000000005';
set local role authenticated;
-- Accepted: editing what was already with M, history fixes and notes.
update public.deals set title='Ganha por M (revisada)' where id='cd000000-0000-0000-0000-000000000003';
update public.activities set title='Nota de M (revisada)' where id='ca000000-0000-0000-0000-000000000004';
update public.deals set owner_id='00000000-0000-0000-0000-0000000000c3' where id='cd000000-0000-0000-0000-000000000006';
update public.activities set user_id='00000000-0000-0000-0000-0000000000c3' where id='ca000000-0000-0000-0000-000000000006';
insert into public.activities(id,org_id,type,title,user_id) values('ca000000-0000-0000-0000-000000000007',current_setting('test.org_a')::uuid,'note','Nota sobre M','00000000-0000-0000-0000-0000000000c3');
insert into public.activities(id,org_id,type,title,user_id,due_date,completed_at) values('ca000000-0000-0000-0000-000000000008',current_setting('test.org_a')::uuid,'call','Ligação registrada de M','00000000-0000-0000-0000-0000000000c3',now(),now());
select test_support.assert((select title='Ganha por M (revisada)' from public.deals where id='cd000000-0000-0000-0000-000000000003')
 and (select title='Nota de M (revisada)' from public.activities where id='ca000000-0000-0000-0000-000000000004'),'trigger: other fields of a record already with a deactivated member can be edited');
select test_support.assert((select owner_id='00000000-0000-0000-0000-0000000000c3' from public.deals where id='cd000000-0000-0000-0000-000000000006')
 and (select user_id='00000000-0000-0000-0000-0000000000c3' from public.activities where id='ca000000-0000-0000-0000-000000000006'),'trigger: the responsible of a closed deal or a completed activity can be fixed to a deactivated member');
select test_support.assert((select count(*)=2 from public.activities where id in ('ca000000-0000-0000-0000-000000000007','ca000000-0000-0000-0000-000000000008')),'trigger: a note or an already completed activity can name a deactivated member');
-- An automation that would create a task for the deactivated owner of a lost deal records a failure, and the move stays.
insert into public.automations(id,org_id,name,trigger_type,task_title,is_active) values('c2000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Tarefa ao mover','deal_moved','Retomar contato',true);
select public.move_deal('cd000000-0000-0000-0000-000000000004',current_setting('test.stage_a_next')::uuid);
select test_support.assert((select stage_id=current_setting('test.stage_a_next')::uuid and status='lost' from public.deals where id='cd000000-0000-0000-0000-000000000004'),'trigger: moving a lost deal of a deactivated member still changes the stage');
reset role;
select test_support.assert((select count(*)=1 and bool_and(status='failed' and activity_id is null and error_message='Não foi possível criar a tarefa. Revise os vínculos e o responsável.' and error_detail like 'P0001: %foi desativada%')
 from public.automation_logs where automation_id='c2000000-0000-0000-0000-000000000001'),'trigger: the automation task for a deactivated owner is a failed run with the technical detail');
set local role authenticated;
update public.automations set is_active=false where id='c2000000-0000-0000-0000-000000000001';

-- 11. set_member_role: a deactivated person, the new text for non-managers and the invitations the new role could not
-- create.
select test_support.denied_with('select public.set_member_role(''00000000-0000-0000-0000-0000000000c3'',''admin'')','Esta pessoa está desativada. Use “Reativar” para devolver o acesso.','set_member_role refuses a deactivated person');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',true);
select test_support.denied_with('select public.set_member_role(''00000000-0000-0000-0000-0000000000c5'',''member'')','Somente donos e administradores podem alterar papéis.','set_member_role tells a collaborator that owners and administrators change roles');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
select set_config('test.y_owner_invite',public.create_invitation('dono-por-segundo@example.test','owner')::text,true)::uuid;
select set_config('test.y_member_invite',public.create_invitation('colab-por-segundo@example.test','member')::text,true)::uuid;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
savepoint role_invitations;
select public.set_member_role('00000000-0000-0000-0000-0000000000c1','admin');
select test_support.assert(not exists(select 1 from public.invitations where id=current_setting('test.y_owner_invite')::uuid) and exists(select 1 from public.invitations where id=current_setting('test.y_member_invite')::uuid)
 and exists(select 1 from public.audit_logs where entity_type='invitations' and entity_id=current_setting('test.y_owner_invite')::uuid and action='delete' and user_id=auth.uid()),'from owner to administrator, only the owner invitations of the person are revoked, with audit');
select public.set_member_role('00000000-0000-0000-0000-0000000000c1','member');
select test_support.assert(not exists(select 1 from public.invitations where id=current_setting('test.y_member_invite')::uuid),'to collaborator, every pending invitation of the person is revoked');
rollback to savepoint role_invitations;
select public.set_member_role('00000000-0000-0000-0000-0000000000c1','owner');
select test_support.assert((select count(*)=2 from public.invitations where id in (current_setting('test.y_owner_invite')::uuid,current_setting('test.y_member_invite')::uuid)),'a role that can still create the invitations keeps them');

-- 10 (continued). The last active owner. With the other owners deactivated by SQL, the only active owner cannot step
-- down; and even if the role rule broke (an administrator allowed to touch owners), deactivate_member would keep an
-- active owner. Both undone by the savepoint.
savepoint last_owner;
reset role;
update public.user_roles set deactivated_at=now() where org_id=current_setting('test.org_a')::uuid and role='owner' and user_id<>'00000000-0000-0000-0000-000000000001';
set local role authenticated;
select test_support.denied_with('select public.set_member_role(auth.uid(),''admin'')','Mantenha pelo menos um dono ativo na organização.','set_member_role counts only active owners: the only active owner cannot step down');
reset role;
create or replace function private.role_change_allowed(p_actor_role text,p_from_role text,p_to_role text) returns boolean language sql immutable set search_path='' as $$ select p_actor_role in ('owner','admin') $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.denied_with('select * from public.deactivate_member(''00000000-0000-0000-0000-000000000001'',true)','Mantenha pelo menos um dono ativo na organização.','deactivate_member keeps an active owner even if the role rule breaks');
rollback to savepoint last_owner;
reset role;
select test_support.assert(not private.role_change_allowed('admin','owner','owner'),'the role rule is back after the savepoint');
set local role authenticated;

-- 12. reactivate_member.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-0000000000c3'',''owner'')','Somente um dono pode reativar um dono ou dar o papel de Dono.','an administrator cannot reactivate someone as owner');
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-0000000000c3'',''manager'')','Papel inválido.','reactivate_member refuses an unknown role');
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-0000000000c4'',''member'')','Esta pessoa já está ativa.','reactivate_member refuses an active person');
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-000000000002'',''member'')','Pessoa indisponível nesta organização.','reactivate_member refuses a person of another organization');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',true);
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-0000000000c3'',''member'')','Somente donos e administradores podem reativar pessoas.','a collaborator cannot reactivate');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
savepoint owner_reactivation;
select test_support.assert((select row(m.*)::text='(0,0,0,0,2)' from public.deactivate_member('00000000-0000-0000-0000-0000000000c1',true) m),'an owner deactivates the second owner, whose two invitations are revoked');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.denied_with('select public.reactivate_member(''00000000-0000-0000-0000-0000000000c1'',''admin'')','Somente um dono pode reativar um dono ou dar o papel de Dono.','an administrator cannot reactivate an owner, not even as administrator');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.reactivate_member('00000000-0000-0000-0000-0000000000c1','admin');
select test_support.assert((select role='admin' and deactivated_at is null from public.user_roles where user_id='00000000-0000-0000-0000-0000000000c1'),'an owner reactivates an owner with another role');
rollback to savepoint owner_reactivation;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select public.reactivate_member('00000000-0000-0000-0000-0000000000c3','viewer');
select test_support.assert((select role='viewer' and deactivated_at is null from public.user_roles where user_id='00000000-0000-0000-0000-0000000000c3')
 and exists(select 1 from public.audit_logs l join public.user_roles r on r.id=l.entity_id where r.user_id='00000000-0000-0000-0000-0000000000c3' and l.user_id=auth.uid() and l.changed_fields='{deactivated_at,role}'),'an administrator reactivates a collaborator with the chosen role, audited');
select set_config('request.jwt.claims',current_setting('test.m_claims'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
select test_support.assert(private.current_org()=current_setting('test.org_a')::uuid and not private.can_write() and (select count(*)>=3 from public.contacts),'after the reactivation, M reads again with the same token, with the new role');
select test_support.denied(format('insert into public.contacts(org_id,first_name) values(%L,''Leitura não grava'')',current_setting('test.org_a')),'after the reactivation as viewer, M still cannot write');
select test_support.assert((select bool_and(owner_id='00000000-0000-0000-0000-0000000000c4') from public.deals where id in ('cd000000-0000-0000-0000-000000000001','cd000000-0000-0000-0000-000000000002'))
 and not exists(select 1 from public.contacts where owner_id=auth.uid()),'the reactivation does not bring the portfolio back');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.set_member_role('00000000-0000-0000-0000-0000000000c3','member');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',true);
insert into public.contacts(org_id,first_name) values(current_setting('test.org_a')::uuid,'Criado por M reativado');
select test_support.assert(exists(select 1 from public.contacts where first_name='Criado por M reativado'),'reactivated as collaborator, M writes again');

-- 14. create_invitation and restore_owner.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.denied_with('select public.create_invitation('' Membro-X@Example.test '',''member'')','Esta pessoa está desativada. Para devolver o acesso, use “Reativar” em “Equipe”.','create_invitation points a deactivated member to the reactivation');
select test_support.denied_with('select public.create_invitation(''recebedora-r@example.test'',''member'')','Esta pessoa já faz parte da equipe.','create_invitation still refuses an active member');
select set_config('test.partner_invite',public.create_invitation('socio-novo@example.test','owner')::text,true)::uuid;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.denied_with('select public.create_invitation(''Socio-Novo@example.test'',''member'')','Já existe um convite de dono válido para este e-mail. Só um dono pode copiar o link ou revogar esse convite.','an administrator who runs into a valid owner invitation is told to ask an owner');
reset role;
select test_support.sign_out();
savepoint restore_reactivation;
select test_support.assert(private.restore_owner('Admin-D@example.test')='A conta admin-d@example.test foi reativada com o papel de Dono.','restore_owner reactivates a deactivated account of the company as owner');
select test_support.assert((select role='owner' and deactivated_at is null from public.user_roles where user_id='00000000-0000-0000-0000-0000000000c6')
 and exists(select 1 from public.audit_logs l join public.user_roles r on r.id=l.entity_id where r.user_id='00000000-0000-0000-0000-0000000000c6' and l.user_id is null and l.changed_fields='{deactivated_at,role}'),'the reactivation from the SQL editor is audited without author');
rollback to savepoint restore_reactivation;
select test_support.assert(private.restore_owner('segundo-dono@example.test')='A conta segundo-dono@example.test agora tem o papel de Dono.','restore_owner keeps the old answer for an active account');

-- 15 (continued). Reading portfolio_transfers: only owners and administrators of the organization.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
select test_support.assert((select count(*)>=4 from public.portfolio_transfers),'an administrator reads the transfers of the organization');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',true);
select test_support.assert((select count(*)=0 from public.portfolio_transfers),'a collaborator reads no transfer');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c5',true);
select test_support.assert((select count(*)=0 from public.portfolio_transfers),'a viewer reads no transfer');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.assert((select count(*)=0 from public.portfolio_transfers),'an owner of another organization reads no transfer');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.privilege_denied(format('insert into public.portfolio_transfers(org_id,from_user_id,deactivation,accounts_transferred) values(%L,auth.uid(),false,false)',current_setting('test.org_a')),'an owner cannot insert a transfer directly');
select test_support.privilege_denied('update public.portfolio_transfers set deals=0','an owner cannot change a transfer');
select test_support.privilege_denied('delete from public.portfolio_transfers','an owner cannot delete a transfer');
reset role;

-- 16. Instance in use before the migration: the legacy organization.
select test_support.assert((select role='viewer' and deactivated_at is not null from public.user_roles where user_id='00000000-0000-0000-0000-000000000095' and org_id='90000000-0000-0000-0000-000000000001')
 and exists(select 1 from public.audit_logs l join public.user_roles r on r.id=l.entity_id where r.user_id='00000000-0000-0000-0000-000000000095' and l.action='create' and l.user_id is null),'upgrade: the orphan profile becomes a deactivated viewer, audited without author');
select test_support.assert((select owner_id='00000000-0000-0000-0000-000000000095' and status='open' and updated_at='2026-09-20 10:00:00+00' from public.deals where id='95000000-0000-0000-0000-000000000002')
 and (select owner_id='00000000-0000-0000-0000-000000000095' from public.contacts where id='95000000-0000-0000-0000-000000000001'),'upgrade: the portfolio of the orphan does not change');
select test_support.assert(not exists(select 1 from public.invitations where id in ('94000000-0000-0000-0000-000000000006','94000000-0000-0000-0000-000000000008'))
 and (select count(*)=2 from public.audit_logs where entity_type='invitations' and action='delete' and user_id is null and entity_id in ('94000000-0000-0000-0000-000000000006','94000000-0000-0000-0000-000000000008')),'upgrade: the pending invitations of a demoted administrator and the owner invitation of an administrator are revoked, audited without author');
select test_support.assert((select count(*)=2 from public.invitations where id in ('94000000-0000-0000-0000-000000000007','94000000-0000-0000-0000-000000000009'))
 and (select count(*)=2 from public.invitations where id in ('94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000003')),'upgrade: the invitations their authors could still create, and the accepted ones, stay');
select test_support.assert((select invited_by is null and role='owner' and accepted_at is null and expires_at>now() from public.invitations where id='94000000-0000-0000-0000-000000000010'),'upgrade: a pending owner invitation without author (from the SQL editor, like the one of restore_owner) stays');
select test_support.assert((select role='owner' and deactivated_at is null from public.user_roles where user_id='00000000-0000-0000-0000-000000000099')
 and (select count(*)=2 from public.user_roles where org_id='90000000-0000-0000-0000-000000000001' and user_id in ('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000094') and deactivated_at is null),'upgrade: the members keep their roles, active');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000095',true);
select test_support.assert(private.current_org() is null and (select count(*)=0 from public.deals) and (select count(*)=0 from public.contacts)
 and (select count(*)=1 from public.user_roles where deactivated_at is not null),'upgrade: the orphan reads nothing but its own role');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
select test_support.assert((select count(*)=1 and bool_and(not active) from (select r.deactivated_at is null as active from public.user_roles r where r.user_id='00000000-0000-0000-0000-000000000095') s),'upgrade: the legacy owner sees the orphan among the deactivated people');
select test_support.assert((select row(m.*)::text='(1,0,1,0,0)' from public.transfer_portfolio('00000000-0000-0000-0000-000000000095',true,'00000000-0000-0000-0000-000000000093') m),'upgrade: the legacy owner passes the portfolio of the orphan with "Passar carteira"');
reset role;
select test_support.sign_out();
rollback to savepoint member_deactivation;
select test_support.assert(not exists(select 1 from auth.users where email='membro-m@example.test') and not exists(select 1 from public.portfolio_transfers where org_id=current_setting('test.org_a')::uuid),'the checks of item 1.2 were undone for the files that follow');
