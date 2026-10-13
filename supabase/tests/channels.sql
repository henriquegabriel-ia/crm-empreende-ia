-- Included by commercial-security.sql, after member-deactivation.sql and before instance-admission.sql (whose section 9
-- empties the instance), inside a savepoint that is rolled back at the end: the accounts and records of this file do
-- not reach the checks that follow it.
-- Item 1.9: level 1 channels with the record of the interaction (supabase/migrations/20261013110000_channel_interactions.sql,
-- design in docs/arquitetura/1.9.md). The CRM opens the person's own app and never sends anything; what happened is an
-- activity: the new types whatsapp and visit, the outcome of a completed call (activities.outcome), the "Não contatar"
-- mark on contacts and companies, stamped by the database, and complete_activity, which completes an activity and
-- creates the next action in one transaction.
-- Run through `npm run test:db`: section 6 needs the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261013110000_channel_interactions.sql right before that migration. The race between two
-- sessions completing the same activity runs in scripts/test-database.mjs (completeActivityRace).
-- now() is fixed for the whole transaction: every write below happens at that same instant, so older versions are
-- written with the triggers off (session_replication_role=replica) when a check needs them.
-- Accounts (organization A): 1 owner A, e1 administrator, e2 collaborator, e3 viewer, e4 collaborator deactivated; 2
-- owner B.
reset role;
select test_support.sign_out();
savepoint channel_interactions;
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000e1','admin-canais@example.test',now()),
 ('00000000-0000-0000-0000-0000000000e2','colaboracao-canais@example.test',now()),
 ('00000000-0000-0000-0000-0000000000e3','leitura-canais@example.test',now()),
 ('00000000-0000-0000-0000-0000000000e4','desativada-canais@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
update public.profiles p set org_id=current_setting('test.org_a')::uuid,name=v.name from (values
 ('00000000-0000-0000-0000-0000000000e1'::uuid,'Administração dos Canais'),
 ('00000000-0000-0000-0000-0000000000e2'::uuid,'Colaboração dos Canais'),
 ('00000000-0000-0000-0000-0000000000e3'::uuid,'Leitura dos Canais'),
 ('00000000-0000-0000-0000-0000000000e4'::uuid,'Desativada dos Canais')
) v(id,name) where p.id=v.id;
insert into public.user_roles(user_id,org_id,role,deactivated_at) values
 ('00000000-0000-0000-0000-0000000000e1',current_setting('test.org_a')::uuid,'admin',null),
 ('00000000-0000-0000-0000-0000000000e2',current_setting('test.org_a')::uuid,'member',null),
 ('00000000-0000-0000-0000-0000000000e3',current_setting('test.org_a')::uuid,'viewer',null),
 ('00000000-0000-0000-0000-0000000000e4',current_setting('test.org_a')::uuid,'member',now());

-- 1. Schema.
select test_support.assert((select count(*)=1 and bool_and(c.conname='activities_type_check' and c.convalidated
  and pg_get_constraintdef(c.oid) like all (array['%''task''%','%''meeting''%','%''call''%','%''email''%','%''note''%','%''whatsapp''%','%''visit''%']))
 from pg_constraint c where c.conrelid='public.activities'::regclass and c.contype='c' and pg_get_constraintdef(c.oid) like '%(type = ANY%'),'activities has a single, validated type check with the seven types');
select test_support.assert((select format_type(atttypid,atttypmod)='text' and not attnotnull and not atthasdef from pg_attribute where attrelid='public.activities'::regclass and attname='outcome')
 and (select pg_get_constraintdef(oid) like all (array['%outcome IS NULL%','%''call''%','%completed_at IS NOT NULL%','%''answered''%','%''no_answer''%','%''voicemail''%'])
  from pg_constraint where conrelid='public.activities'::regclass and conname='activities_outcome_valid'),'activities.outcome is a nullable text, valid only in a completed call');
select test_support.assert((select count(*)=8 from pg_attribute a join (values
  ('do_not_contact','boolean',true),('do_not_contact_at','timestamp with time zone',false),('do_not_contact_by','uuid',false),('do_not_contact_reason','text',false)
 ) expected(name,type,not_null) on a.attname=expected.name
 where a.attrelid in ('public.contacts'::regclass,'public.companies'::regclass) and format_type(a.atttypid,a.atttypmod)=expected.type and a.attnotnull=expected.not_null)
 and (select count(*)=2 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
  where d.adrelid in ('public.contacts'::regclass,'public.companies'::regclass) and a.attname='do_not_contact' and pg_get_expr(d.adbin,d.adrelid)='false'),'contacts and companies have the four "Não contatar" columns, the mark false by default');
select test_support.assert((select count(*)=6 from pg_constraint c join (values ('contacts'),('companies')) t(name) on c.conrelid=('public.'||t.name)::regclass
 where (c.conname=t.name||'_do_not_contact_at_finite' and pg_get_constraintdef(c.oid) like '%isfinite(do_not_contact_at)%')
  or (c.conname=t.name||'_do_not_contact_reason_length' and pg_get_constraintdef(c.oid) like '%length(do_not_contact_reason) <= 500%')
  or (c.conname=t.name||'_do_not_contact_state' and pg_get_constraintdef(c.oid) like '%do_not_contact_at IS NOT NULL%' and pg_get_constraintdef(c.oid) like '%do_not_contact_reason IS NULL%')),'the mark has the finite date, the 500-character reason and the consistent state checks on both tables');
select test_support.assert((select count(*)=2 from pg_constraint c where c.conrelid in ('public.contacts'::regclass,'public.companies'::regclass) and c.contype='f'
  and c.confrelid='public.profiles'::regclass and c.conname like '%_do_not_contact_by_org_id_fkey' and cardinality(c.conkey)=2 and c.confdeltype='a'
  and (select attname from pg_attribute where attrelid=c.conrelid and attnum=c.conkey[1])='do_not_contact_by'
  and (select attname from pg_attribute where attrelid=c.conrelid and attnum=c.conkey[2])='org_id')
 and (select count(*)=2 from pg_indexes where schemaname='public' and tablename in ('contacts','companies') and indexname like '%_do_not_contact_by_org_id_fkey_idx' and indexdef like '%(do_not_contact_by, org_id)%'),'the author of the mark points to the profile of the organization by a composite foreign key, without ON DELETE, and is indexed');
select test_support.assert((select count(*)=1 and bool_and(t.tgtype=23 and t.tgenabled='O') from pg_trigger t where t.tgname='normalize_activity_outcome' and t.tgrelid='public.activities'::regclass and t.tgfoid='private.normalize_activity_outcome()'::regprocedure)
 and (select count(*)=2 and bool_and(t.tgtype=23 and t.tgenabled='O') from pg_trigger t where t.tgname='stamp_do_not_contact' and t.tgrelid in ('public.contacts'::regclass,'public.companies'::regclass) and t.tgfoid='private.stamp_do_not_contact()'::regprocedure),'the outcome and the mark triggers are enabled BEFORE INSERT OR UPDATE row triggers');
select test_support.assert((select count(*)=3 and bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid in
 ('private.normalize_activity_outcome()'::regprocedure,'private.stamp_do_not_contact()'::regprocedure,'public.complete_activity(uuid,timestamp with time zone,text,text,jsonb)'::regprocedure)),'the item functions are SECURITY INVOKER, with an empty search_path');
select test_support.assert(not exists(select 1 from (values ('private.normalize_activity_outcome()'),('private.stamp_do_not_contact()')) f(signature)
 cross join (values ('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(r.role,f.signature,'execute')),'no API role executes the trigger functions');
select test_support.assert(has_function_privilege('authenticated','public.complete_activity(uuid,timestamp with time zone,text,text,jsonb)','execute')
 and not has_function_privilege('anon','public.complete_activity(uuid,timestamp with time zone,text,text,jsonb)','execute'),'complete_activity runs for authenticated and never for anon');

-- Records of this file: a company with a phone, a contact of it and a deal of the contact, written by owner A.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.companies(id,org_id,name,phone,owner_id) values
 ('e9200000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Empresa dos Canais','+551130000000','00000000-0000-0000-0000-0000000000e2');
insert into public.contacts(id,org_id,first_name,last_name,email,phone,company_id,owner_id) values
 ('e9100000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Ana','Canais','ana-canais@example.test','+5511999990000','e9200000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2'),
 ('e9100000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Bruno','Canais',null,'+5511988880000',null,'00000000-0000-0000-0000-0000000000e2');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id) values
 ('e9400000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Oportunidade dos Canais',1000,'e9100000-0000-0000-0000-000000000001','e9200000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2'),
 ('e9400000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Segunda oportunidade dos Canais',500,'e9100000-0000-0000-0000-000000000001',null,'00000000-0000-0000-0000-0000000000e2');

-- 2. The new types, written by a collaborator.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',true);
insert into public.activities(id,org_id,type,title,contact_id,user_id,due_date) values
 ('e9300000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'whatsapp','Mandar a proposta pelo WhatsApp','e9100000-0000-0000-0000-000000000001',auth.uid(),now()+interval '1 day');
insert into public.activities(id,org_id,type,title,company_id,user_id,due_date,end_date) values
 ('e9300000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'visit','Visitar a fábrica','e9200000-0000-0000-0000-000000000001',auth.uid(),now()+interval '2 days',now()+interval '2 days 1 hour');
select test_support.assert((select count(*)=2 from public.activities where id in ('e9300000-0000-0000-0000-000000000001','e9300000-0000-0000-0000-000000000002') and type in ('whatsapp','visit') and created_by=auth.uid()),'a collaborator creates a WhatsApp and a visit with start and end');
select test_support.denied(format('insert into public.activities(org_id,type,title,user_id) values(%L,''sms'',''Tipo inexistente'',auth.uid())',current_setting('test.org_a')),'an unknown activity type is refused');

-- 3. The outcome of a call: only in a completed call; reopening or changing the type clears it.
insert into public.activities(id,org_id,type,title,contact_id,user_id,due_date,completed_at,outcome) values
 ('e9300000-0000-0000-0000-000000000011',current_setting('test.org_a')::uuid,'call','Ligação atendida','e9100000-0000-0000-0000-000000000001',auth.uid(),now(),now(),'answered'),
 ('e9300000-0000-0000-0000-000000000012',current_setting('test.org_a')::uuid,'call','Ligação pendente com resultado','e9100000-0000-0000-0000-000000000001',auth.uid(),now()+interval '1 hour',null,'no_answer'),
 ('e9300000-0000-0000-0000-000000000013',current_setting('test.org_a')::uuid,'task','Tarefa concluída com resultado','e9100000-0000-0000-0000-000000000001',auth.uid(),now(),now(),'voicemail');
select test_support.assert((select outcome='answered' from public.activities where id='e9300000-0000-0000-0000-000000000011'),'outcome: a completed call keeps "answered"');
select test_support.assert((select outcome is null from public.activities where id='e9300000-0000-0000-0000-000000000012'),'outcome: a pending call with an outcome is saved without it');
select test_support.assert((select outcome is null from public.activities where id='e9300000-0000-0000-0000-000000000013'),'outcome: a task with an outcome is saved without it');
select test_support.denied(format('insert into public.activities(org_id,type,title,user_id,due_date,completed_at,outcome) values(%L,''call'',''Resultado inválido'',auth.uid(),now(),now(),''busy'')',current_setting('test.org_a')),'outcome: a value outside the list in a completed call is refused');
select test_support.denied('update public.activities set outcome=''busy'' where id=''e9300000-0000-0000-0000-000000000011''','outcome: an update to a value outside the list is refused');
update public.activities set completed_at=null where id='e9300000-0000-0000-0000-000000000011';
select test_support.assert((select outcome is null and completed_at is null from public.activities where id='e9300000-0000-0000-0000-000000000011'),'outcome: reopening the call clears it');
update public.activities set completed_at=now(),outcome='voicemail' where id='e9300000-0000-0000-0000-000000000011';
update public.activities set type='task' where id='e9300000-0000-0000-0000-000000000011';
select test_support.assert((select outcome is null and type='task' and completed_at is not null from public.activities where id='e9300000-0000-0000-0000-000000000011'),'outcome: changing the call to a task clears it');

-- 4. "Não contatar", on contacts and companies.
-- 4.1 A collaborator marks on creation: the date, the author and the trimmed reason come from the database; a date and
-- an author sent by the client are ignored.
insert into public.contacts(id,org_id,first_name,do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason) values
 ('e9100000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'Carla Não Contatar',true,'2020-01-01 00:00:00+00','00000000-0000-0000-0000-000000000001','  Pediu para não ligar mais.  ');
select test_support.assert((select do_not_contact and do_not_contact_at=now() and do_not_contact_by=auth.uid() and do_not_contact_reason='Pediu para não ligar mais.'
 from public.contacts where id='e9100000-0000-0000-0000-000000000003'),'mark: a collaborator marks on creation, with the date, the author and the trimmed reason from the database');
-- 4.2 A reason without the mark is not saved.
insert into public.contacts(id,org_id,first_name,do_not_contact,do_not_contact_reason) values
 ('e9100000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'Daniel Sem Marca',false,'Motivo sem marca');
select test_support.assert((select not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null
 from public.contacts where id='e9100000-0000-0000-0000-000000000004'),'mark: a reason sent without the mark is not saved');
-- 4.3 Marking an existing contact, with a reason too long refused first.
select test_support.denied(format('update public.contacts set do_not_contact=true,do_not_contact_reason=%L where id=''e9100000-0000-0000-0000-000000000002''',repeat('x',501)),'mark: a reason with 501 characters is refused');
update public.contacts set do_not_contact=true,do_not_contact_reason=repeat('y',500),do_not_contact_by='00000000-0000-0000-0000-000000000001' where id='e9100000-0000-0000-0000-000000000002';
select test_support.assert((select do_not_contact and do_not_contact_at=now() and do_not_contact_by=auth.uid() and length(do_not_contact_reason)=500
 from public.contacts where id='e9100000-0000-0000-0000-000000000002'),'mark: a collaborator marks on edit, with 500 characters of reason and the forged author ignored');
-- 4.4 Editing another field (or sending the reason again with the mark already on) keeps the date, the author and the
-- reason: the reason only changes by marking again.
reset role;
set local session_replication_role=replica;
update public.contacts set do_not_contact_at='2026-10-01 10:00:00+00' where id='e9100000-0000-0000-0000-000000000003';
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.contacts set last_name='Silva',do_not_contact_at=null,do_not_contact_by=null,do_not_contact_reason='Outro motivo' where id='e9100000-0000-0000-0000-000000000003';
select test_support.assert((select last_name='Silva' and do_not_contact and do_not_contact_at='2026-10-01 10:00:00+00' and do_not_contact_by='00000000-0000-0000-0000-0000000000e2'
 and do_not_contact_reason='Pediu para não ligar mais.' from public.contacts where id='e9100000-0000-0000-0000-000000000003'),'mark: editing another field keeps the date, the author and the reason, even if the client sends others');
-- 4.5 Only owners and administrators allow the contact again.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',true);
select test_support.denied_with('update public.contacts set do_not_contact=false where id=''e9100000-0000-0000-0000-000000000003''','Só donos e administradores permitem o contato de novo.','mark: a collaborator cannot remove the mark');
select test_support.assert((select do_not_contact from public.contacts where id='e9100000-0000-0000-0000-000000000003'),'mark: the refused removal keeps the mark');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e3',true);
with changed as (update public.contacts set do_not_contact=false where id='e9100000-0000-0000-0000-000000000003' returning 1) select test_support.assert(count(*)=0,'mark: a viewer cannot remove the mark') from changed;
with changed as (update public.contacts set do_not_contact=true where id='e9100000-0000-0000-0000-000000000004' returning 1) select test_support.assert(count(*)=0,'mark: a viewer cannot mark') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
with changed as (update public.contacts set do_not_contact=false where id='e9100000-0000-0000-0000-000000000003' returning 1) select test_support.assert(count(*)=0,'mark: another organization cannot remove the mark') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',true);
update public.contacts set do_not_contact=false where id='e9100000-0000-0000-0000-000000000003';
select test_support.assert((select not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null
 from public.contacts where id='e9100000-0000-0000-0000-000000000003'),'mark: an administrator removes the mark, and the date, the author and the reason go back to null');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.contacts set do_not_contact=false where id='e9100000-0000-0000-0000-000000000002';
select test_support.assert((select not do_not_contact and do_not_contact_reason is null from public.contacts where id='e9100000-0000-0000-0000-000000000002'),'mark: an owner removes the mark');
-- 4.6 The same rules on companies.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',true);
update public.companies set do_not_contact=true,do_not_contact_reason=' Pediu por e-mail. ' where id='e9200000-0000-0000-0000-000000000001';
select test_support.assert((select do_not_contact and do_not_contact_at=now() and do_not_contact_by=auth.uid() and do_not_contact_reason='Pediu por e-mail.'
 from public.companies where id='e9200000-0000-0000-0000-000000000001'),'company mark: a collaborator marks, stamped by the database');
select test_support.denied_with('update public.companies set do_not_contact=false where id=''e9200000-0000-0000-0000-000000000001''','Só donos e administradores permitem o contato de novo.','company mark: a collaborator cannot remove it');
select test_support.denied(format('insert into public.companies(org_id,name,do_not_contact,do_not_contact_reason) values(%L,''Empresa com motivo longo'',true,%L)',current_setting('test.org_a'),repeat('z',501)),'company mark: a reason with 501 characters is refused');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e3',true);
with changed as (update public.companies set do_not_contact=false where id='e9200000-0000-0000-0000-000000000001' returning 1) select test_support.assert(count(*)=0,'company mark: a viewer cannot remove it') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',true);
update public.companies set do_not_contact=false where id='e9200000-0000-0000-0000-000000000001';
select test_support.assert((select not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null
 from public.companies where id='e9200000-0000-0000-0000-000000000001'),'company mark: an administrator removes it');
-- 4.7 The audit records each change of the mark with its author.
reset role;
select test_support.assert((select count(*)=1 from public.audit_logs where entity_id='e9100000-0000-0000-0000-000000000002' and action='update' and user_id='00000000-0000-0000-0000-0000000000e2'
  and changed_fields @> '{do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason}')
 and (select count(*)=1 from public.audit_logs where entity_id='e9100000-0000-0000-0000-000000000003' and action='update' and user_id='00000000-0000-0000-0000-0000000000e1'
  and changed_fields @> '{do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason}')
 and (select count(*)=2 from public.audit_logs where entity_id='e9200000-0000-0000-0000-000000000001' and action='update' and changed_fields @> '{do_not_contact}'),'mark: the audit records the marking and the removal, with the author');
-- 4.8 Without an account: the service_role key (integrations, Edge Functions, the intake of leads) and the SQL editor
-- (the database owner) create contacts and companies with and without the mark, mark and remove it, with a null
-- author. service_role has no USAGE on the private schema: the trigger must only prepare private.can_manage() when
-- there is an account, or every one of these writes fails with 42501.
select test_support.assert(not has_schema_privilege('service_role','private','usage'),'without an account: service_role has no USAGE on the private schema');
select test_support.sign_out();
set local role service_role;
insert into public.companies(id,org_id,name) values
 ('e9200000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Empresa pela chave de serviço');
insert into public.contacts(id,org_id,first_name,company_id) values
 ('e9100000-0000-0000-0000-000000000005',current_setting('test.org_a')::uuid,'Elisa Integração','e9200000-0000-0000-0000-000000000002');
insert into public.contacts(id,org_id,first_name,do_not_contact,do_not_contact_reason) values
 ('e9100000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,'Fábio Integração',true,' Pediu pelo formulário. ');
update public.contacts set do_not_contact=true where id='e9100000-0000-0000-0000-000000000005';
update public.companies set do_not_contact=true where id='e9200000-0000-0000-0000-000000000002';
reset role;
select test_support.assert((select count(*)=3 and bool_and(do_not_contact and do_not_contact_at=now() and do_not_contact_by is null) from (
  select do_not_contact,do_not_contact_at,do_not_contact_by from public.contacts where id in ('e9100000-0000-0000-0000-000000000005','e9100000-0000-0000-0000-000000000006')
  union all select do_not_contact,do_not_contact_at,do_not_contact_by from public.companies where id='e9200000-0000-0000-0000-000000000002') r)
 and (select do_not_contact_reason='Pediu pelo formulário.' from public.contacts where id='e9100000-0000-0000-0000-000000000006'),'without an account: the service_role key creates a company and contacts and marks them, with a null author');
set local role service_role;
update public.contacts set do_not_contact=false where id='e9100000-0000-0000-0000-000000000005';
update public.companies set do_not_contact=false where id='e9200000-0000-0000-0000-000000000002';
reset role;
update public.contacts set do_not_contact=false where id='e9100000-0000-0000-0000-000000000006';
select test_support.assert((select count(*)=3 and bool_and(not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null) from (
  select do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason from public.contacts where id in ('e9100000-0000-0000-0000-000000000005','e9100000-0000-0000-0000-000000000006')
  union all select do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason from public.companies where id='e9200000-0000-0000-0000-000000000002') r),'without an account: the service_role key and the SQL editor remove the mark');

-- 5. complete_activity.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',true);
insert into public.activities(id,org_id,type,title,body,contact_id,company_id,deal_id,user_id,due_date) values
 ('e9300000-0000-0000-0000-000000000021',current_setting('test.org_a')::uuid,'call','Ligar para a Ana','Plano: apresentar a proposta.','e9100000-0000-0000-0000-000000000001','e9200000-0000-0000-0000-000000000001','e9400000-0000-0000-0000-000000000001',auth.uid(),now()+interval '1 hour'),
 ('e9300000-0000-0000-0000-000000000022',current_setting('test.org_a')::uuid,'task','Preparar o contrato',null,'e9100000-0000-0000-0000-000000000001',null,null,auth.uid(),now()+interval '1 day'),
 ('e9300000-0000-0000-0000-000000000023',current_setting('test.org_a')::uuid,'call','Retornar a ligação da Ana',null,'e9100000-0000-0000-0000-000000000001','e9200000-0000-0000-0000-000000000001','e9400000-0000-0000-0000-000000000001',auth.uid(),now()+interval '2 hours'),
 ('e9300000-0000-0000-0000-000000000024',current_setting('test.org_a')::uuid,'email','Mandar o resumo',null,'e9100000-0000-0000-0000-000000000001',null,null,auth.uid(),now()+interval '3 hours');
insert into public.activities(id,org_id,type,title,contact_id,user_id) values
 ('e9300000-0000-0000-0000-000000000025',current_setting('test.org_a')::uuid,'note','Nota da conversa','e9100000-0000-0000-0000-000000000001',auth.uid());
-- 5.1 Refusals with the same message, without changing anything: an old version, a note, an id that does not exist.
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',now()-interval ''1 minute'')','Esta atividade mudou ou não está mais disponível.','complete: an old version is refused');
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',null)','Esta atividade mudou ou não está mais disponível.','complete: a missing version is refused');
select test_support.denied_with(format('select public.complete_activity(''e9300000-0000-0000-0000-000000000025'',%L)',(select updated_at from public.activities where id='e9300000-0000-0000-0000-000000000025')),'Esta atividade mudou ou não está mais disponível.','complete: a note is refused');
select test_support.denied_with('select public.complete_activity(gen_random_uuid(),now())','Esta atividade mudou ou não está mais disponível.','complete: an activity that does not exist is refused');
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000022'',now(),''answered'')','O resultado só vale para ligações','complete: an outcome on a task is refused');
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',now(),''busy'')','O resultado só vale para ligações','complete: an outcome outside the list is refused');
-- 5.2 A refusal in the next action undoes the completion.
select test_support.denied_with(format('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',now(),''no_answer'',''Anotação'',%L)',jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title','  ','due_date',now()+interval '1 day')),'Informe o que precisa acontecer na próxima ação.','complete: a next action without a title is refused');
select test_support.denied_with(format('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',now(),''no_answer'',''Anotação'',%L)',jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title','Ligar de novo')),'Informe o prazo da próxima ação.','complete: a next action without a deadline is refused');
select test_support.denied_with(format('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',now(),''no_answer'',''Anotação'',%L)',jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title','Nota','type','note','due_date',now()+interval '1 day')),'A próxima ação não pode ser uma nota.','complete: a next action of type note is refused');
select test_support.denied_with(format('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',now(),''no_answer'',''Anotação'',%L)',jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title','Ligar de novo','due_date',now()+interval '1 day','user_id','00000000-0000-0000-0000-0000000000e4')),'A pessoa escolhida como responsável foi desativada.','complete: a next action for a deactivated person is refused');
select test_support.assert((select completed_at is null and outcome is null and body='Plano: apresentar a proposta.' from public.activities where id='e9300000-0000-0000-0000-000000000021')
 and not exists(select 1 from public.activities where id='e9300000-0000-0000-0000-000000000101'),'complete: every refusal left the activity pending, unchanged, and created no next action');
-- 5.3 The completion: the outcome, the note at the end of the details and the next action with the id sent and the
-- links and the person copied from the completed activity.
select set_config('test.completed',public.complete_activity('e9300000-0000-0000-0000-000000000021',now(),'no_answer','  Não atendeu; retornar amanhã.  ',
 jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title',' Ligar de novo para a Ana ','due_date',now()+interval '1 day'))::text,true);
select test_support.assert((select completed_at=now() and outcome='no_answer' and body=E'Plano: apresentar a proposta.\n\nNão atendeu; retornar amanhã.' from public.activities where id='e9300000-0000-0000-0000-000000000021'),'complete: the call is completed with the outcome and the note at the end of the details');
select test_support.assert((select type='task' and title='Ligar de novo para a Ana' and completed_at is null and due_date=now()+interval '1 day'
  and contact_id='e9100000-0000-0000-0000-000000000001' and company_id='e9200000-0000-0000-0000-000000000001' and deal_id='e9400000-0000-0000-0000-000000000001'
  and user_id='00000000-0000-0000-0000-0000000000e2' and created_by=auth.uid() from public.activities where id='e9300000-0000-0000-0000-000000000101'),'complete: the next action has the id sent, and the links and the person of the completed activity');
select test_support.assert((select (j->'completed'->>'id')='e9300000-0000-0000-0000-000000000021' and (j->'completed'->>'outcome')='no_answer' and (j->'next'->>'id')='e9300000-0000-0000-0000-000000000101' and not j ? 'replayed'
 from (select current_setting('test.completed')::jsonb as j) r),'complete: the answer carries the completed activity and the next action');
-- 5.4 The same request again (the answer was lost): the pair already saved, without changing anything.
reset role;
set local session_replication_role=replica;
update public.activities set updated_at='2026-10-01 10:00:00+00' where id in ('e9300000-0000-0000-0000-000000000021','e9300000-0000-0000-0000-000000000101');
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e2',true);
select test_support.assert((select (j->>'replayed')::boolean and (j->'next'->>'id')='e9300000-0000-0000-0000-000000000101' and (j->'completed'->>'outcome')='no_answer'
 from (select public.complete_activity('e9300000-0000-0000-0000-000000000021',now(),'no_answer','  Não atendeu; retornar amanhã.  ',
  jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title',' Ligar de novo para a Ana ','due_date',now()+interval '1 day')) as j) r),'complete: the repeated request answers the pair already saved, as replayed');
select test_support.assert((select count(*)=2 and bool_and(updated_at='2026-10-01 10:00:00+00') from public.activities where id in ('e9300000-0000-0000-0000-000000000021','e9300000-0000-0000-0000-000000000101'))
 and (select body=E'Plano: apresentar a proposta.\n\nNão atendeu; retornar amanhã.' from public.activities where id='e9300000-0000-0000-0000-000000000021')
 and (select count(*)=1 from public.activities where title='Ligar de novo para a Ana' and org_id=current_setting('test.org_a')::uuid),'complete: the repetition changes nothing and creates no second next action');
-- 5.5 The completed activity cannot be completed again, and a next id that already exists over a pending activity is
-- refused.
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000021'',''2026-10-01 10:00:00+00'')','Esta atividade mudou ou não está mais disponível.','complete: an activity already completed is refused');
select test_support.denied_with(format('select public.complete_activity(''e9300000-0000-0000-0000-000000000022'',now(),null,null,%L)',jsonb_build_object('id','e9300000-0000-0000-0000-000000000101','title','Outra','due_date',now()+interval '1 day')),'Esta próxima ação já existe. Atualize a página.','complete: a next id that already exists over a pending activity is refused');
-- 5.6 Values sent win over the copied ones, including an explicit null.
select set_config('test.completed',public.complete_activity('e9300000-0000-0000-0000-000000000023',now(),'answered',null,
 jsonb_build_object('id','e9300000-0000-0000-0000-000000000102','type','whatsapp','title','Mandar o contrato','due_date',now()+interval '2 days',
  'contact_id',null,'deal_id','e9400000-0000-0000-0000-000000000002','user_id','00000000-0000-0000-0000-0000000000e1'))::text,true);
select test_support.assert((select type='whatsapp' and contact_id is null and company_id='e9200000-0000-0000-0000-000000000001' and deal_id='e9400000-0000-0000-0000-000000000002'
  and user_id='00000000-0000-0000-0000-0000000000e1' from public.activities where id='e9300000-0000-0000-0000-000000000102')
 and (select outcome='answered' and body is null from public.activities where id='e9300000-0000-0000-0000-000000000023'),'complete: the values sent win over the copied ones, including an explicit null');
-- 5.7 Without a next action: the answer has no next, and the repetition falls into "changed".
select set_config('test.completed',public.complete_activity('e9300000-0000-0000-0000-000000000024',now())::text,true);
select test_support.assert((select completed_at=now() and outcome is null from public.activities where id='e9300000-0000-0000-0000-000000000024')
 and (select (j->'next')='null'::jsonb and (j->'completed'->>'id')='e9300000-0000-0000-0000-000000000024' from (select current_setting('test.completed')::jsonb as j) r),'complete: without a next action, the email is completed and the answer has no next');
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000024'',now())','Esta atividade mudou ou não está mais disponível.','complete: repeating a request without a next action falls into "changed"');
-- 5.8 Another organization, a viewer, a deactivated account and anon.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000022'',now())','Esta atividade mudou ou não está mais disponível.','complete: an activity of another organization is refused with the same message');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e3',true);
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000022'',now())','Você não tem permissão para alterar atividades.','complete: a viewer is refused');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e4',true);
select test_support.denied_with('select public.complete_activity(''e9300000-0000-0000-0000-000000000022'',now())','Você não tem permissão para alterar atividades.','complete: a deactivated account is refused');
reset role;
grant usage on schema test_support to anon;
grant execute on function test_support.privilege_denied(text,text) to anon;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select test_support.privilege_denied('select public.complete_activity(''e9300000-0000-0000-0000-000000000022'',now())','complete: anon cannot execute it');
reset role;
select test_support.assert((select completed_at is null from public.activities where id='e9300000-0000-0000-0000-000000000022'),'complete: the refused calls left the task pending');

-- 6. Instance in use before the migration: the legacy organization keeps every value and version, without outcome, mark
-- or audit rows.
select test_support.assert((select count(*)=2 from public.contacts where id in ('96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000003')
  and updated_at='2026-09-21 10:00:00+00' and not do_not_contact and do_not_contact_at is null and do_not_contact_by is null and do_not_contact_reason is null)
 and (select phone='+5511999990000' from public.contacts where id='96000000-0000-0000-0000-000000000002')
 and (select phone='(11) 3000-0000' from public.contacts where id='96000000-0000-0000-0000-000000000003')
 and (select phone='(11) 3000-0000' and updated_at='2026-09-21 10:00:00+00' and not do_not_contact and do_not_contact_at is null from public.companies where id='96000000-0000-0000-0000-000000000001'),'upgrade: contacts and companies keep the phone as saved and the version, without the mark');
select test_support.assert((select count(*)=6 and bool_and(outcome is null) and array_agg(type order by id)='{call,call,note,meeting,email,task}'
 from public.activities where id::text like '96000000-0000-0000-0000-0000000000__' and id::text>='96000000-0000-0000-0000-000000000011')
 and (select completed_at='2026-09-20 14:20:00+00' and updated_at='2026-09-20 14:20:00+00' from public.activities where id='96000000-0000-0000-0000-000000000011')
 and (select count(*)=5 from public.activities where id in ('96000000-0000-0000-0000-000000000012','96000000-0000-0000-0000-000000000014','96000000-0000-0000-0000-000000000015','96000000-0000-0000-0000-000000000016','96000000-0000-0000-0000-000000000013')
  and updated_at in ('2026-09-21 10:00:00+00','2026-09-19 10:00:00+00')),'upgrade: activities of every old type keep the type and the version, without outcome');
select test_support.assert(not exists(select 1 from public.audit_logs where entity_id::text like '96000000-%'),'upgrade: the migration writes no audit row');
select test_support.sign_out();
rollback to savepoint channel_interactions;
select test_support.assert(not exists(select 1 from auth.users where email='colaboracao-canais@example.test') and not exists(select 1 from public.activities where id::text like 'e93%'),'the checks of item 1.9 were undone for the files that follow');
