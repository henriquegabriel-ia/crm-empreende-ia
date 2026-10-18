-- Included by commercial-security.sql, after channels.sql and before instance-admission.sql (whose section 9 empties the
-- instance), inside a savepoint that is rolled back at the end: the accounts and records of this file do not reach the
-- checks that follow it.
-- Item 1.10: LGPD of the controlling company (supabase/migrations/20261013120000_contact_privacy.sql, design in
-- docs/arquitetura/1.10.md). The legal basis of each contact, stamped by the database, with the company default when
-- nobody chooses another; the refusal of planned contact actions for "Não contatar"; the anonymization and the export
-- of a contact, only by owners and administrators, recorded in privacy_actions; audit_logs stays without values.
-- Run through `npm run test:db`: section 9 needs the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261013120000_contact_privacy.sql right before that migration. The races between the
-- anonymization and other sessions, and the volume of item 0.10, run in scripts/test-database.mjs (anonymizationRace
-- and anonymizationVolume).
-- now() is fixed for the whole transaction: older versions and stamps are written with the triggers off
-- (session_replication_role=replica) when a check needs them.
-- Accounts (organization A): 1 owner A, b1 administrator, b2 collaborator, b3 viewer, b4 collaborator deactivated, b5
-- collaborator whose portfolio is passed on; 2 owner B; 99 legacy owner.
reset role;
select test_support.sign_out();
savepoint contact_privacy;
-- Only the automations created here run while deals are created in this file.
update public.automations set is_active=false where org_id=current_setting('test.org_a')::uuid;
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000b1','admin-privacidade@example.test',now()),
 ('00000000-0000-0000-0000-0000000000b2','colaboracao-privacidade@example.test',now()),
 ('00000000-0000-0000-0000-0000000000b3','leitura-privacidade@example.test',now()),
 ('00000000-0000-0000-0000-0000000000b4','desativada-privacidade@example.test',now()),
 ('00000000-0000-0000-0000-0000000000b5','carteira-privacidade@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
update public.profiles p set org_id=current_setting('test.org_a')::uuid,name=v.name from (values
 ('00000000-0000-0000-0000-0000000000b1'::uuid,'Administração da Privacidade'),
 ('00000000-0000-0000-0000-0000000000b2'::uuid,'Colaboração da Privacidade'),
 ('00000000-0000-0000-0000-0000000000b3'::uuid,'Leitura da Privacidade'),
 ('00000000-0000-0000-0000-0000000000b4'::uuid,'Desativada da Privacidade'),
 ('00000000-0000-0000-0000-0000000000b5'::uuid,'Carteira da Privacidade')
) v(id,name) where p.id=v.id;
insert into public.user_roles(user_id,org_id,role,deactivated_at) values
 ('00000000-0000-0000-0000-0000000000b1',current_setting('test.org_a')::uuid,'admin',null),
 ('00000000-0000-0000-0000-0000000000b2',current_setting('test.org_a')::uuid,'member',null),
 ('00000000-0000-0000-0000-0000000000b3',current_setting('test.org_a')::uuid,'viewer',null),
 ('00000000-0000-0000-0000-0000000000b4',current_setting('test.org_a')::uuid,'member',now()),
 ('00000000-0000-0000-0000-0000000000b5',current_setting('test.org_a')::uuid,'member',null);
grant usage on schema test_support to anon;
grant execute on function test_support.privilege_denied(text,text) to anon;

-- 1. Schema and privileges.
select test_support.assert((select count(*)=6 from pg_attribute a join (values
  ('legal_basis','text',true),('legal_basis_note','text',false),('legal_basis_at','timestamp with time zone',false),
  ('legal_basis_by','uuid',false),('anonymized_at','timestamp with time zone',false),('anonymized_by','uuid',false)
 ) expected(name,type,not_null) on a.attname=expected.name
 where a.attrelid='public.contacts'::regclass and format_type(a.atttypid,a.atttypmod)=expected.type and a.attnotnull=expected.not_null)
 and (select count(*)=3 from pg_attribute a join (values
  ('default_legal_basis','text',true),('default_legal_basis_at','timestamp with time zone',false),('default_legal_basis_by','uuid',false)
 ) expected(name,type,not_null) on a.attname=expected.name
 where a.attrelid='public.organizations'::regclass and format_type(a.atttypid,a.atttypmod)=expected.type and a.attnotnull=expected.not_null)
 and (select count(*)=2 and bool_and(pg_get_expr(d.adbin,d.adrelid)='''not_informed''::text') from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
  where (d.adrelid='public.contacts'::regclass and a.attname='legal_basis') or (d.adrelid='public.organizations'::regclass and a.attname='default_legal_basis')),
 'contacts have the legal basis and the anonymization columns, and organizations the default legal basis, "not_informed" by default');
select test_support.assert((select count(*)=9 from pg_constraint c where
  (c.conrelid='public.contacts'::regclass and c.conname='contacts_legal_basis_valid'
   and pg_get_constraintdef(c.oid) like all (array['%''not_informed''%','%''consent''%','%''contract''%','%''legitimate_interest''%','%''legal_obligation''%','%''exercise_of_rights''%']))
  or (c.conrelid='public.organizations'::regclass and c.conname='organizations_default_legal_basis_valid'
   and pg_get_constraintdef(c.oid) like all (array['%''not_informed''%','%''contract''%','%''legitimate_interest''%','%''legal_obligation''%','%''exercise_of_rights''%'])
   and pg_get_constraintdef(c.oid) not like '%consent%')
  or (c.conrelid='public.contacts'::regclass and c.conname='contacts_legal_basis_note_length' and pg_get_constraintdef(c.oid) like '%length(legal_basis_note) <= 500%')
  or (c.conrelid='public.contacts'::regclass and c.conname='contacts_legal_basis_consent_note'
   and pg_get_constraintdef(c.oid) like all (array['%''consent''%','%legal_basis_note IS NOT NULL%','%anonymized_at IS NOT NULL%']))
  or (c.conrelid='public.contacts'::regclass and c.conname='contacts_anonymized_by_needs_at'
   and pg_get_constraintdef(c.oid) like all (array['%anonymized_by IS NULL%','%anonymized_at IS NOT NULL%']))
  or (c.conname in ('contacts_legal_basis_at_finite','contacts_anonymized_at_finite','organizations_default_legal_basis_at_finite','privacy_actions_created_at_finite')
   and pg_get_constraintdef(c.oid) like '%isfinite(%')),
 'the basis, the default without consent, the 500-character note, the consent with its note, the anonymization and the finite dates have their checks');
select test_support.assert((select count(*)=5 from pg_constraint c where c.contype='f' and (
  (c.conrelid='public.contacts'::regclass and c.conname in ('contacts_legal_basis_by_org_id_fkey','contacts_anonymized_by_org_id_fkey')
   and c.confrelid='public.profiles'::regclass and c.confdeltype='a' and cardinality(c.conkey)=2
   and (select attname from pg_attribute where attrelid=c.conrelid and attnum=c.conkey[2])='org_id')
  or (c.conrelid='public.organizations'::regclass and c.conname='organizations_default_legal_basis_by_id_fkey'
   and c.confrelid='public.profiles'::regclass and c.confdeltype='a'
   and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num)='{default_legal_basis_by,id}')
  or (c.conrelid='public.privacy_actions'::regclass and c.conname='privacy_actions_contact_id_org_id_fkey'
   and c.confrelid='public.contacts'::regclass and c.confdeltype='n'
   and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.confdelsetcols))='{contact_id}')
  or (c.conrelid='public.privacy_actions'::regclass and c.conname='privacy_actions_performed_by_org_id_fkey'
   and c.confrelid='public.profiles'::regclass and c.confdeltype='a')))
 and (select count(*)=5 from pg_indexes where schemaname='public' and indexname in ('contacts_legal_basis_by_org_id_fkey_idx','contacts_anonymized_by_org_id_fkey_idx',
  'organizations_default_legal_basis_by_id_fkey_idx','privacy_actions_contact_id_org_id_fkey_idx','privacy_actions_performed_by_org_id_fkey_idx'))
 and (select indexdef like '%(org_id, created_at DESC)%' from pg_indexes where schemaname='public' and indexname='privacy_actions_org_time'),
 'the authors point to the profiles of the organization by composite foreign keys, the privacy record keeps itself without the contact, and every foreign key is indexed');
select test_support.assert((select relrowsecurity from pg_class where oid='public.privacy_actions'::regclass)
 and (select array_agg(policyname::text)='{privacy_actions_manager_read}' and bool_and(cmd='SELECT') from pg_policies where schemaname='public' and tablename='privacy_actions')
 and has_table_privilege('authenticated','public.privacy_actions','select')
 and not has_table_privilege('authenticated','public.privacy_actions','insert,update,delete,truncate')
 and not has_any_column_privilege('authenticated','public.privacy_actions','insert,update')
 and not has_any_column_privilege('anon','public.privacy_actions','select,insert,update'),
 'privacy_actions: RLS on, a single read policy for managers, SELECT only for authenticated and nothing for anon');
select test_support.assert(has_column_privilege('authenticated','public.organizations','default_legal_basis','update')
 and not has_column_privilege('authenticated','public.organizations','default_legal_basis_at','update')
 and not has_column_privilege('authenticated','public.organizations','default_legal_basis_by','update'),
 'authenticated updates the company default, and not its stamp');
select test_support.assert((select count(*)=7 and bool_and(t.tgtype=23 and t.tgenabled='O') from pg_trigger t join (values
  ('public.contacts','protect_anonymized_contact','private.protect_anonymized_contact()'),
  ('public.contacts','stamp_legal_basis','private.stamp_legal_basis()'),
  ('public.organizations','stamp_default_legal_basis','private.stamp_default_legal_basis()'),
  ('public.activities','guard_anonymized_contact','private.guard_anonymized_contact()'),
  ('public.deals','guard_anonymized_contact','private.guard_anonymized_contact()'),
  ('public.payments','guard_anonymized_contact','private.guard_anonymized_contact()'),
  ('public.activities','refuse_do_not_contact_action','private.refuse_do_not_contact_action()')
 ) expected(tbl,name,fn) on t.tgrelid=expected.tbl::regclass and t.tgname=expected.name and t.tgfoid=expected.fn::regprocedure),
 'the item triggers are enabled BEFORE INSERT OR UPDATE row triggers on the right tables');
select test_support.assert((select count(*)=17 and bool_and(p.prosecdef=expected.definer and p.provolatile=expected.volatility and p.proconfig @> array['search_path=""']) from (values
  ('private.privacy_term_regex(text)',false,'i'),
  ('private.privacy_phone_regex(text)',false,'i'),
  ('private.contact_privacy_regex(text,text,text,text,boolean)',false,'i'),
  ('private.redact_personal_terms(text,text)',false,'i'),
  ('private.contact_privacy_counts(uuid,public.contacts)',false,'s'),
  ('private.stamp_default_legal_basis()',false,'v'),
  ('private.stamp_legal_basis()',true,'v'),
  ('private.protect_anonymized_contact()',false,'v'),
  ('private.stamp_do_not_contact()',false,'v'),
  ('private.guard_anonymized_contact()',true,'v'),
  ('private.refuse_do_not_contact_action()',true,'v'),
  ('private.contact_privacy_summary(uuid)',true,'s'),
  ('private.anonymize_contact(uuid,timestamp with time zone)',true,'v'),
  ('private.export_contact_data(uuid)',true,'v'),
  ('public.contact_privacy_summary(uuid)',false,'s'),
  ('public.anonymize_contact(uuid,timestamp with time zone)',false,'v'),
  ('public.export_contact_data(uuid)',false,'v')
 ) expected(signature,definer,volatility) join pg_proc p on p.oid=expected.signature::regprocedure)
 and (select proconfig @> array['statement_timeout=60s'] from pg_proc where oid='public.anonymize_contact(uuid,timestamp with time zone)'::regprocedure),
 'the item functions are SECURITY DEFINER or INVOKER as designed, with an empty search_path, and the anonymization declares 60 s');
select test_support.assert(not exists(select 1 from (values ('private.privacy_term_regex(text)'),('private.privacy_phone_regex(text)'),
  ('private.contact_privacy_regex(text,text,text,text,boolean)'),('private.redact_personal_terms(text,text)'),('private.contact_privacy_counts(uuid,public.contacts)'),
  ('private.stamp_default_legal_basis()'),('private.stamp_legal_basis()'),('private.protect_anonymized_contact()'),
  ('private.guard_anonymized_contact()'),('private.refuse_do_not_contact_action()')) f(signature)
 cross join (values ('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(r.role,f.signature,'execute')),
 'no API role executes the pure, counting and trigger functions');
select test_support.assert(not exists(select 1 from (values ('private.contact_privacy_summary(uuid)'),('private.anonymize_contact(uuid,timestamp with time zone)'),
  ('private.export_contact_data(uuid)'),('public.contact_privacy_summary(uuid)'),('public.anonymize_contact(uuid,timestamp with time zone)'),('public.export_contact_data(uuid)')) f(signature)
 where not has_function_privilege('authenticated',f.signature,'execute') or has_function_privilege('anon',f.signature,'execute'))
 and (select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace='private'::regnamespace and has_function_privilege('anon',p.oid,'execute'))='{instance_status}',
 'the three RPCs run for authenticated and never for anon, and instance_status is still the only private function anon executes');
-- Item 1.11 (supabase/migrations/20261018100000_privacy_followup.sql; findings 3 and 11 of the review of item 1.10):
-- the summary declares the same 60 s as the anonymization, and the cut of the fields limited to 500 characters does not
-- leave a broken "[anonimizad" behind. The function limit is applied by PostgREST before the call; a direct SQL call
-- keeps the session limit, so the check reads the definition.
select test_support.assert((select proconfig @> array['statement_timeout=60s'] and not prosecdef and provolatile='s'
  from pg_proc where oid='public.contact_privacy_summary(uuid)'::regprocedure)
 and (select proconfig @> array['statement_timeout=60s'] from pg_proc where oid='public.anonymize_contact(uuid,timestamp with time zone)'::regprocedure)
 and (select not prosecdef and provolatile='i' and proconfig @> array['search_path=""'] from pg_proc where oid='private.fit_redacted_text(text,integer)'::regprocedure)
 and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='private.anonymize_contact(uuid,timestamp with time zone)'::regprocedure)
 and has_function_privilege('authenticated','private.anonymize_contact(uuid,timestamp with time zone)','execute')
 and not has_function_privilege('anon','private.anonymize_contact(uuid,timestamp with time zone)','execute')
 and not exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role)
  where has_function_privilege(r.role,'private.fit_redacted_text(text,integer)','execute')),
 'item 1.11: the summary and the anonymization declare 60 s, the anonymization stays SECURITY DEFINER with its grants, and the cut function is pure and runs for no API role');
select test_support.assert(private.fit_redacted_text(null,500) is null
 and private.fit_redacted_text(repeat('x',500),500)=repeat('x',500)
 and private.fit_redacted_text('Pedido de [anonimizado].',500)='Pedido de [anonimizado].'
 and private.fit_redacted_text(repeat('x',501),500)=repeat('x',499)||'…'
 and length(private.fit_redacted_text(repeat('x',501),500))=500
 and private.fit_redacted_text(repeat('x',488)||' [anonimizado]',500)=repeat('x',488)||'…'
 and private.fit_redacted_text(repeat('x',490)||' [anonimizado] fim',500)=repeat('x',490)||'…'
 and private.fit_redacted_text('[anonimizado] '||repeat('x',490),500)='[anonimizado] '||repeat('x',485)||'…'
 and private.fit_redacted_text(repeat('x',470)||' [anonimizado] e mais texto aqui',500)=repeat('x',470)||' [anonimizado] e mais texto a…'
 and (select bool_and(private.fit_redacted_text(repeat('y',n)||'[anonimizado]'||repeat('z',20),500) !~ '\[a?n?o?n?i?m?i?z?a?d?o?…?$'
   and length(private.fit_redacted_text(repeat('y',n)||'[anonimizado]'||repeat('z',20),500))<=500) from generate_series(470,500) n)
 -- Review of item 1.11: the cut text ends with "…", so the pattern accepts it before the end; and every position that
 -- would break the marker (12 characters, "[anonimizado", down to 1, "[") gives the text before it and "…".
 and (select bool_and(private.fit_redacted_text(repeat('y',n)||'[anonimizado]'||repeat('z',20),500)=repeat('y',n)||'…')
  from generate_series(487,498) n)
 and private.fit_redacted_text(repeat('y',486)||'[anonimizado]'||repeat('z',20),500)=repeat('y',486)||'[anonimizado]…',
 'item 1.11: the cut keeps a text within the limit as it is, cuts before the limit with "…" and never leaves a broken "[anonimizado]" at the end');

-- 2. The company default (AC-3): only owners and administrators change it, stamped by the database; consent cannot be
-- the default.
select test_support.assert((select default_legal_basis='not_informed' and default_legal_basis_at is null and default_legal_basis_by is null
 from public.organizations where id=current_setting('test.org_a')::uuid),'default: a company is born "not_informed", without a stamp');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
with changed as (update public.organizations set default_legal_basis='contract' returning 1) select test_support.assert(count(*)=0,'default: a collaborator cannot change it') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',true);
with changed as (update public.organizations set default_legal_basis='contract' returning 1) select test_support.assert(count(*)=0,'default: a viewer cannot change it') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b4',true);
with changed as (update public.organizations set default_legal_basis='contract' returning 1) select test_support.assert(count(*)=0,'default: a deactivated account cannot change it') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
with changed as (update public.organizations set default_legal_basis='contract' where id=current_setting('test.org_a')::uuid returning 1) select test_support.assert(count(*)=0,'default: another organization cannot change it') from changed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
select test_support.denied_with('update public.organizations set default_legal_basis=''consent''','organizations_default_legal_basis_valid','default: consent cannot be the default');
select test_support.denied_with('update public.organizations set default_legal_basis=''marketing''','organizations_default_legal_basis_valid','default: a value outside the list is refused');
select test_support.privilege_denied('update public.organizations set default_legal_basis_by=auth.uid()','default: the client cannot write the stamp');
update public.organizations set default_legal_basis='contract';
select test_support.assert((select default_legal_basis='contract' and default_legal_basis_at=now() and default_legal_basis_by=auth.uid()
 from public.organizations where id=current_setting('test.org_a')::uuid),'default: an administrator changes it, with the date and the author from the database');
reset role;
set local session_replication_role=replica;
update public.organizations set default_legal_basis_at='2026-10-01 10:00:00+00' where id=current_setting('test.org_a')::uuid;
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.organizations set name='Organização A da Privacidade' where id=current_setting('test.org_a')::uuid;
select test_support.assert((select name='Organização A da Privacidade' and default_legal_basis_at='2026-10-01 10:00:00+00' and default_legal_basis_by='00000000-0000-0000-0000-0000000000b1'
 from public.organizations where id=current_setting('test.org_a')::uuid),'default: editing the name keeps the stamp');
update public.organizations set default_legal_basis='legitimate_interest' where id=current_setting('test.org_a')::uuid;
select test_support.assert((select default_legal_basis='legitimate_interest' and default_legal_basis_at=now() and default_legal_basis_by=auth.uid()
 from public.organizations where id=current_setting('test.org_a')::uuid),'default: an owner changes it, stamped again');

-- 3. The legal basis of each contact (AC-2), written by a collaborator: the default of the company on insert, the
-- date and the author from the database, the note trimmed and required for consent.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
insert into public.contacts(id,org_id,first_name) values('b1000000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Base Padrão');
insert into public.contacts(id,org_id,first_name,legal_basis) values('b1000000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Base Não Informada','not_informed');
select test_support.assert((select count(*)=2 and bool_and(legal_basis='legitimate_interest' and legal_basis_note is null and legal_basis_at=now() and legal_basis_by=auth.uid())
 from public.contacts where id in ('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002')),'basis: a contact without a basis, or "not_informed", receives the company default, stamped by the database');
insert into public.contacts(id,org_id,first_name,legal_basis,legal_basis_note,legal_basis_at,legal_basis_by) values
 ('b1000000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'Base Contrato','contract','  Contrato 123 assinado.  ','2020-01-01 00:00:00+00','00000000-0000-0000-0000-000000000001');
select test_support.assert((select legal_basis='contract' and legal_basis_note='Contrato 123 assinado.' and legal_basis_at=now() and legal_basis_by=auth.uid()
 from public.contacts where id='b1000000-0000-0000-0000-000000000003'),'basis: an explicit basis stays, the note is trimmed, and the date and the author sent by the client are ignored');
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,legal_basis) values(%L,''Consentimento sem registro'',''consent'')',current_setting('test.org_a')),'contacts_legal_basis_consent_note','basis: consent without the note is refused');
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,legal_basis,legal_basis_note) values(%L,''Consentimento em branco'',''consent'',''   '')',current_setting('test.org_a')),'contacts_legal_basis_consent_note','basis: consent with a blank note is refused');
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,legal_basis,legal_basis_note) values(%L,''Registro longo'',''contract'',%L)',current_setting('test.org_a'),repeat('x',501)),'contacts_legal_basis_note_length','basis: a note with 501 characters is refused');
select test_support.denied_with(format('insert into public.contacts(org_id,first_name,legal_basis) values(%L,''Base inválida'',''marketing'')',current_setting('test.org_a')),'contacts_legal_basis_valid','basis: a value outside the list is refused');
insert into public.contacts(id,org_id,first_name,legal_basis,legal_basis_note) values
 ('b1000000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'Base Consentimento','consent','Marcou a caixa do formulário em 10/10/2026.');
select test_support.assert((select legal_basis='consent' and legal_basis_note='Marcou a caixa do formulário em 10/10/2026.' and legal_basis_by=auth.uid()
 from public.contacts where id='b1000000-0000-0000-0000-000000000004'),'basis: consent with the note is saved');
reset role;
set local session_replication_role=replica;
update public.contacts set legal_basis_at='2026-10-01 10:00:00+00' where id='b1000000-0000-0000-0000-000000000004';
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.contacts set last_name='Silva',legal_basis_note='  Marcou a caixa do formulário em 10/10/2026.  ',legal_basis_at=null,legal_basis_by=auth.uid()
 where id='b1000000-0000-0000-0000-000000000004';
select test_support.assert((select last_name='Silva' and legal_basis_note='Marcou a caixa do formulário em 10/10/2026.' and legal_basis_at='2026-10-01 10:00:00+00'
 and legal_basis_by='00000000-0000-0000-0000-0000000000b2' from public.contacts where id='b1000000-0000-0000-0000-000000000004'),'basis: editing another field, or sending the same note with spaces, keeps the note and the stamp, even if the client sends others');
update public.contacts set legal_basis_note='Confirmou por e-mail em 11/10/2026.' where id='b1000000-0000-0000-0000-000000000004';
select test_support.assert((select legal_basis='consent' and legal_basis_note='Confirmou por e-mail em 11/10/2026.' and legal_basis_at=now() and legal_basis_by=auth.uid()
 from public.contacts where id='b1000000-0000-0000-0000-000000000004'),'basis: changing the note stamps again, with whoever changed it');
update public.contacts set legal_basis='legitimate_interest',legal_basis_note=null where id='b1000000-0000-0000-0000-000000000003';
select test_support.assert((select legal_basis='legitimate_interest' and legal_basis_note is null and legal_basis_at=now() and legal_basis_by=auth.uid()
 from public.contacts where id='b1000000-0000-0000-0000-000000000003'),'basis: changing the basis stamps again');
select test_support.denied_with('update public.contacts set legal_basis_note=''  '' where id=''b1000000-0000-0000-0000-000000000004''','contacts_legal_basis_consent_note','basis: the note of a consent cannot be removed');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',true);
with changed as (update public.contacts set legal_basis='contract' where id='b1000000-0000-0000-0000-000000000001' returning 1) select test_support.assert(count(*)=0,'basis: a viewer cannot change it') from changed;
reset role;
select test_support.assert((select count(*)=1 from public.audit_logs where entity_id='b1000000-0000-0000-0000-000000000004' and action='update' and user_id='00000000-0000-0000-0000-000000000001'
  and changed_fields @> '{legal_basis_note,legal_basis_at}')
 and (select count(*)=1 from public.audit_logs where entity_id='b1000000-0000-0000-0000-000000000003' and action='update' and user_id='00000000-0000-0000-0000-000000000001'
  and changed_fields @> '{legal_basis,legal_basis_note,legal_basis_by}'),'basis: the audit records each change with the author, by the names of the fields');
-- Changing the company default does not change the contacts already saved; the next ones receive the new default.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
update public.organizations set default_legal_basis='legal_obligation';
insert into public.contacts(id,org_id,first_name) values('b1000000-0000-0000-0000-000000000005',current_setting('test.org_a')::uuid,'Base Depois da Troca');
select test_support.assert((select legal_basis='legitimate_interest' from public.contacts where id='b1000000-0000-0000-0000-000000000001')
 and (select legal_basis='legal_obligation' from public.contacts where id='b1000000-0000-0000-0000-000000000005'),'basis: a new default applies to the next contacts and does not change the saved ones');
update public.organizations set default_legal_basis='legitimate_interest';
-- Without an account: the service_role key (integrations, the intake of leads) inserts with the default and edits, with a
-- null author. service_role has no USAGE on the private schema: a SECURITY INVOKER trigger that prepared private.*
-- would fail every one of these writes with 42501.
reset role;
select test_support.sign_out();
set local role service_role;
insert into public.contacts(id,org_id,first_name) values('b1000000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,'Base pela Integração');
insert into public.contacts(id,org_id,first_name,legal_basis,legal_basis_note) values('b1000000-0000-0000-0000-000000000007',current_setting('test.org_a')::uuid,'Consentimento pela Integração','consent',' Formulário do site. ');
reset role;
select test_support.assert((select legal_basis='legitimate_interest' and legal_basis_at=now() and legal_basis_by is null from public.contacts where id='b1000000-0000-0000-0000-000000000006')
 and (select legal_basis='consent' and legal_basis_note='Formulário do site.' and legal_basis_by is null from public.contacts where id='b1000000-0000-0000-0000-000000000007'),'basis: the service_role key inserts with the company default or its own basis, with a null author');
set local role service_role;
update public.contacts set legal_basis='contract',legal_basis_note='Pedido pelo site.' where id='b1000000-0000-0000-0000-000000000006';
reset role;
select test_support.assert((select legal_basis='contract' and legal_basis_note='Pedido pelo site.' and legal_basis_at=now() and legal_basis_by is null
 from public.contacts where id='b1000000-0000-0000-0000-000000000006'),'basis: the service_role key changes the basis, with a null author');

-- 4. Planned contact actions for "Não contatar" (AC-4). A marked contact and a marked company; a pending call and a
-- task for the contact written before the mark; a liberated contact of the marked company.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.companies(id,org_id,name,phone,do_not_contact,do_not_contact_reason) values
 ('b2000000-0000-0000-0000-000000000021',current_setting('test.org_a')::uuid,'Empresa Não Contatar','+551130000021',true,'Pediu por e-mail.'),
 ('b2000000-0000-0000-0000-000000000022',current_setting('test.org_a')::uuid,'Empresa Liberada','+551130000022',false,null);
insert into public.contacts(id,org_id,first_name,last_name,phone,email,company_id,owner_id) values
 ('b1000000-0000-0000-0000-000000000021',current_setting('test.org_a')::uuid,'Marta','Marcada','+5511900000021','marta@example.test','b2000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-0000000000b2'),
 ('b1000000-0000-0000-0000-000000000022',current_setting('test.org_a')::uuid,'Lívia','Liberada','+5511900000022',null,'b2000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-0000000000b2');
insert into public.activities(id,org_id,type,title,contact_id,user_id,due_date) values
 ('b3000000-0000-0000-0000-000000000021',current_setting('test.org_a')::uuid,'call','Ligação agendada antes da marca','b1000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-0000000000b2',now()+interval '1 day'),
 ('b3000000-0000-0000-0000-000000000022',current_setting('test.org_a')::uuid,'task','Tarefa da Marta','b1000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-0000000000b2',now()+interval '1 day'),
 ('b3000000-0000-0000-0000-000000000025',current_setting('test.org_a')::uuid,'meeting','Reunião da carteira antes da marca','b1000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-0000000000b5',now()+interval '2 days');
update public.activities set end_date=due_date+interval '1 hour' where id='b3000000-0000-0000-0000-000000000025';
update public.contacts set do_not_contact=true,do_not_contact_reason='Pediu para não ligar.' where id='b1000000-0000-0000-0000-000000000021';
-- 4.1 The five contact types, pending, for the marked contact are refused; a task, a note and a completed call pass.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select test_support.denied_with(format('insert into public.activities(org_id,type,title,contact_id,user_id,due_date,end_date) values(%L,%L,''Ação para a Marta'',''b1000000-0000-0000-0000-000000000021'',auth.uid(),now()+interval ''1 day'',%s)',
  current_setting('test.org_a'),t.type,case when t.type in ('meeting','visit') then 'now()+interval ''25 hours''' else 'null' end),
 'Este contato está marcado como','refusal: a pending '||t.type||' for a marked contact is refused')
 from (values ('call'),('whatsapp'),('email'),('meeting'),('visit')) t(type);
insert into public.activities(id,org_id,type,title,contact_id,user_id,due_date,completed_at,outcome) values
 ('b3000000-0000-0000-0000-000000000023',current_setting('test.org_a')::uuid,'task','Preparar o documento da Marta','b1000000-0000-0000-0000-000000000021',auth.uid(),now()+interval '1 day',null,null),
 ('b3000000-0000-0000-0000-000000000024',current_setting('test.org_a')::uuid,'note','Nota sobre a Marta','b1000000-0000-0000-0000-000000000021',auth.uid(),null,null,null),
 ('b3000000-0000-0000-0000-000000000026',current_setting('test.org_a')::uuid,'call','Ligação recebida da Marta','b1000000-0000-0000-0000-000000000021',auth.uid(),now(),now(),'answered');
select test_support.assert((select count(*)=3 from public.activities where id in ('b3000000-0000-0000-0000-000000000023','b3000000-0000-0000-0000-000000000024','b3000000-0000-0000-0000-000000000026')),
 'refusal: a task, a note and a completed call for a marked contact pass');
-- 4.2 Reopening, changing the type, the contact or the company into a planned action for a marked target is refused.
select test_support.denied_with('update public.activities set completed_at=null where id=''b3000000-0000-0000-0000-000000000026''','Este contato está marcado como','refusal: reopening a call of a marked contact is refused');
select test_support.denied_with('update public.activities set type=''call'' where id=''b3000000-0000-0000-0000-000000000022''','Este contato está marcado como','refusal: turning a task of a marked contact into a call is refused');
insert into public.activities(id,org_id,type,title,contact_id,company_id,user_id,due_date) values
 ('b3000000-0000-0000-0000-000000000027',current_setting('test.org_a')::uuid,'call','Ligar para a Lívia','b1000000-0000-0000-0000-000000000022','b2000000-0000-0000-0000-000000000021',auth.uid(),now()+interval '1 day'),
 ('b3000000-0000-0000-0000-000000000028',current_setting('test.org_a')::uuid,'call','Ligar para a empresa liberada',null,'b2000000-0000-0000-0000-000000000022',auth.uid(),now()+interval '1 day');
select test_support.assert((select count(*)=2 from public.activities where id in ('b3000000-0000-0000-0000-000000000027','b3000000-0000-0000-0000-000000000028')),
 'refusal: a call for a liberated contact of a marked company, and for a liberated company, pass');
select test_support.denied_with('update public.activities set contact_id=''b1000000-0000-0000-0000-000000000021'' where id=''b3000000-0000-0000-0000-000000000027''','Este contato está marcado como','refusal: moving a pending call to a marked contact is refused');
select test_support.denied_with('update public.activities set company_id=''b2000000-0000-0000-0000-000000000021'' where id=''b3000000-0000-0000-0000-000000000028''','Esta empresa está marcada como','refusal: moving a pending call to a marked company without contact is refused');
-- 4.3 An action that already existed before the mark keeps going: the title, the details, the deadline and the person
-- change.
update public.activities set title='Ligação reagendada',body='Confirmar o contrato.',due_date=now()+interval '3 days',user_id='00000000-0000-0000-0000-0000000000b1'
 where id='b3000000-0000-0000-0000-000000000021';
select test_support.assert((select title='Ligação reagendada' and due_date=now()+interval '3 days' and user_id='00000000-0000-0000-0000-0000000000b1' and completed_at is null
 from public.activities where id='b3000000-0000-0000-0000-000000000021'),'refusal: rescheduling, renaming and reassigning an action written before the mark pass');
-- 4.4 A marked company without a contact: a call and a WhatsApp are refused, an email, a meeting and a visit pass.
select test_support.denied_with(format('insert into public.activities(org_id,type,title,company_id,user_id,due_date) values(%L,%L,''Ação para a empresa'',''b2000000-0000-0000-0000-000000000021'',auth.uid(),now()+interval ''1 day'')',current_setting('test.org_a'),t.type),
 'Esta empresa está marcada como','refusal: a pending '||t.type||' for a marked company without contact is refused')
 from (values ('call'),('whatsapp')) t(type);
insert into public.activities(org_id,type,title,company_id,user_id,due_date,end_date) values
 (current_setting('test.org_a')::uuid,'email','E-mail para a empresa marcada','b2000000-0000-0000-0000-000000000021',auth.uid(),now()+interval '1 day',null),
 (current_setting('test.org_a')::uuid,'meeting','Reunião com a empresa marcada','b2000000-0000-0000-0000-000000000021',auth.uid(),now()+interval '1 day',now()+interval '25 hours'),
 (current_setting('test.org_a')::uuid,'visit','Visita à empresa marcada','b2000000-0000-0000-0000-000000000021',auth.uid(),now()+interval '1 day',now()+interval '25 hours');
select test_support.assert((select count(*)=3 from public.activities where company_id='b2000000-0000-0000-0000-000000000021' and contact_id is null and type in ('email','meeting','visit')),
 'refusal: an email, a meeting and a visit for a marked company pass');
-- 4.5 complete_activity: a next contact action for the marked contact is refused, and the completion undone; a next
-- task passes.
select test_support.denied_with(format('select public.complete_activity(''b3000000-0000-0000-0000-000000000022'',%L,null,''Anotação'',%L)',
  (select updated_at from public.activities where id='b3000000-0000-0000-0000-000000000022'),
  jsonb_build_object('id','b3000000-0000-0000-0000-000000000101','type','call','title','Ligar para a Marta','due_date',now()+interval '1 day')),
 'Este contato está marcado como','refusal: complete_activity with a next call for a marked contact is refused');
select test_support.assert((select completed_at is null and body is null from public.activities where id='b3000000-0000-0000-0000-000000000022')
 and not exists(select 1 from public.activities where id='b3000000-0000-0000-0000-000000000101'),'refusal: the refused next action undoes the completion');
select public.complete_activity('b3000000-0000-0000-0000-000000000022',(select updated_at from public.activities where id='b3000000-0000-0000-0000-000000000022'),null,null,
 jsonb_build_object('id','b3000000-0000-0000-0000-000000000102','title','Preparar o documento','due_date',now()+interval '1 day'));
select test_support.assert((select type='task' and contact_id='b1000000-0000-0000-0000-000000000021' and completed_at is null from public.activities where id='b3000000-0000-0000-0000-000000000102')
 and (select completed_at is not null from public.activities where id='b3000000-0000-0000-0000-000000000022'),'refusal: complete_activity with a next task for a marked contact passes');
-- 4.6 The task of an automation on a deal of the marked contact passes.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
with created as (insert into public.automations(org_id,name,trigger_type,task_title,is_active)
  values(current_setting('test.org_a')::uuid,'Tarefa da privacidade','deal_created','Preparar a proposta da Marta',true) returning id)
 select set_config('test.privacy_automation',(select id from created)::text,true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,owner_id) values
 ('b4000000-0000-0000-0000-000000000021',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Oportunidade da Marta',800,'b1000000-0000-0000-0000-000000000021',auth.uid());
select test_support.assert((select count(*)=1 from public.automation_logs l join public.activities a on a.id=l.activity_id
 where l.automation_id=current_setting('test.privacy_automation')::uuid and l.status='success' and a.type='task' and a.contact_id='b1000000-0000-0000-0000-000000000021' and a.completed_at is null),
 'refusal: the task of an automation on a deal of the marked contact passes');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
update public.automations set is_active=false where id=current_setting('test.privacy_automation')::uuid;
-- 4.7 The portfolio transfer of item 1.2 (it only changes the person) passes an action written before the mark.
select set_config('test.privacy_transfer',(select row(m.*)::text from public.deactivate_member('00000000-0000-0000-0000-0000000000b5',false,'00000000-0000-0000-0000-0000000000b2') m),true);
select test_support.assert(current_setting('test.privacy_transfer')='(0,1,0,0,0)'
 and (select user_id='00000000-0000-0000-0000-0000000000b2' and completed_at is null from public.activities where id='b3000000-0000-0000-0000-000000000025'),
 'refusal: deactivate_member passes a meeting of a marked contact written before the mark');
-- 4.8 The service_role key is refused with the same message.
reset role;
select test_support.sign_out();
grant usage on schema test_support to service_role;
grant execute on function test_support.denied_with(text,text,text) to service_role;
set local role service_role;
select test_support.denied_with(format('insert into public.activities(org_id,type,title,contact_id,due_date) values(%L,''call'',''Ligação pela integração'',''b1000000-0000-0000-0000-000000000021'',now()+interval ''1 day'')',current_setting('test.org_a')),
 'Este contato está marcado como','refusal: the service_role key is refused with the same message');
reset role;

-- 5. The terms (AC-8), on texts built here: the name with and without accents and in any case, the full name with
-- varied spaces, the email, the phone in seven formats and regular-expression symbols in the name are replaced; "Ana"
-- does not touch Banana, Mariana nor Anápolis; particles are not terms; a one-word name is not a strong term.
select set_config('test.terms_all',private.contact_privacy_regex('Ana','Souza','ana.souza@example.test','+5511955550000',false),true);
select set_config('test.terms_strong',private.contact_privacy_regex('Ana','Souza','ana.souza@example.test','+5511955550000',true),true);
select test_support.assert((select bool_and(private.redact_personal_terms(v.t,current_setting('test.terms_all'))=v.e) from (values
  ('Ligar para ana souza amanhã','Ligar para [anonimizado] amanhã'),
  ('Reunião com ANA  SOUZA e o time','Reunião com [anonimizado] e o time'),
  ('Ana ligou; Souza retornou','[anonimizado] ligou; [anonimizado] retornou'),
  ('Banana, Mariana e Anápolis','Banana, Mariana e Anápolis'),
  ('Escrever para ANA.SOUZA@EXAMPLE.TEST.','Escrever para [anonimizado].')
 ) v(t,e)),'terms: the full name in any case and with varied spaces, each name and the email are replaced, and "Ana" does not touch Banana, Mariana nor Anápolis');
select test_support.assert((select bool_and(private.redact_personal_terms(v.t,current_setting('test.terms_strong'))=v.e) from (values
  ('Tel: +55 11 95555-0000.','Tel: [anonimizado].'),
  ('+5511955550000','[anonimizado]'),
  ('(11) 95555-0000','[anonimizado]'),
  ('11955550000','[anonimizado]'),
  ('95555-0000','[anonimizado]'),
  ('5555-0000','[anonimizado]'),
  ('11 9 5555 0000','[anonimizado]'),
  ('Pedido 1195555000012 e código 555500001','Pedido 1195555000012 e código 555500001'),
  ('Ana ligou para Ana Souza','Ana ligou para [anonimizado]')
 ) v(t,e)),'terms: the phone in seven formats is replaced, not inside a longer number, and the strong terms leave the first name alone');
select test_support.assert((select bool_and(private.redact_personal_terms(v.t,private.contact_privacy_regex('João','Conceição',null,null,true))=v.e) from (values
  ('joao conceicao','[anonimizado]'),('JOÃO CONCEIÇÃO','[anonimizado]'),('Joáo Conceiçao','[anonimizado]'),('João Conceições','João Conceições')
 ) v(t,e)),'terms: the name matches with and without accents and in any case, and only as whole words');
select test_support.assert((select bool_and(private.redact_personal_terms(v.t,private.contact_privacy_regex('Ana+Bia','O''Brien (Tia)',null,null,true))=v.e) from (values
  ('Falar com Ana+Bia O''Brien (Tia) hoje','Falar com [anonimizado] hoje'),
  ('Falar com AnaaBia O''Brien (Tia) hoje','Falar com AnaaBia O''Brien (Tia) hoje'),
  ('Falar com Ana+Bia O''Brien Tia hoje','Falar com Ana+Bia O''Brien Tia hoje')
 ) v(t,e)),'terms: regular-expression symbols in the name are literal');
select test_support.assert(private.redact_personal_terms('Passe da casa dos fundos, do Sr. Del Rey',private.contact_privacy_regex('Maria','da Silva dos Santos Del',null,null,false))='Passe da casa dos fundos, do Sr. Del Rey'
 and private.redact_personal_terms('Maria e Santos vieram',private.contact_privacy_regex('Maria','da Silva dos Santos Del',null,null,false))='[anonimizado] e [anonimizado] vieram',
 'terms: particles are not terms');
select test_support.assert(private.contact_privacy_regex('Ana',null,null,null,true) is null
 and private.redact_personal_terms('Ana ligou',private.contact_privacy_regex('Ana',null,'ana@example.test',null,true))='Ana ligou'
 and private.redact_personal_terms('Ana ligou',private.contact_privacy_regex('Ana',null,null,null,false))='[anonimizado] ligou'
 and private.privacy_phone_regex('1234-567') is null
 and private.redact_personal_terms(null,current_setting('test.terms_all')) is null
 and private.redact_personal_terms('Texto sem termos',null)='Texto sem termos',
 'terms: a one-word name is not a strong term, a short phone is not a term, and nulls pass through');
-- Text pasted from a PDF, from macOS or by an integration may come decomposed (NFD: the letter followed by the combining
-- mark), and the name may be stored either way: both forms match, still only as whole words.
select test_support.assert((select bool_and(private.redact_personal_terms(v.t,private.contact_privacy_regex(v.first_name,v.last_name,null,null,v.strong))=v.e) from (values
  ('João','Conceição',true,'Proposta '||U&'Joa\0303o Conceic\0327a\0303o','Proposta [anonimizado]'),
  (U&'Joa\0303o',U&'Conceic\0327a\0303o',true,'Proposta João Conceição','Proposta [anonimizado]'),
  (U&'Joa\0303o',U&'Conceic\0327a\0303o',true,'Proposta '||U&'JOA\0303O CONCEIC\0327A\0303O','Proposta [anonimizado]'),
  ('João','Conceição',false,U&'Joa\0303ozinho e Joa\0303o','Joa'||U&'\0303'||'ozinho e [anonimizado]'),
  (U&'Joa\0303o','Conceição',false,'Joãozinho e João','Joãozinho e [anonimizado]'),
  ('Joa',null,false,U&'Joa\0303o veio',U&'Joa\0303o veio'),
  ('Ana',null,false,U&'Joa\0303ana',U&'Joa\0303ana')
 ) v(first_name,last_name,strong,t,e)),'terms: a decomposed (NFD) text matches a composed (NFC) name and vice versa, only as whole words');
-- A phone stored with an extension, or with two numbers: each number is a term, and the extension is not.
select test_support.assert(private.redact_personal_terms('Ligar (11) 95555-0000 ou 95555-0000',
  private.contact_privacy_regex('Ana','Souza',null,'+55 (11) 95555-0000 ramal 12',true))='Ligar [anonimizado] ou [anonimizado]'
 and private.redact_personal_terms('Ramal 12 da recepção',private.contact_privacy_regex('Ana','Souza',null,'+55 (11) 95555-0000 ramal 12',true))='Ramal 12 da recepção'
 and private.redact_personal_terms('Fixo 3333-4444, celular 95555-0000',
  private.contact_privacy_regex('Ana','Souza',null,'(11) 95555-0000 / (11) 3333-4444',true))='Fixo [anonimizado], celular [anonimizado]'
 and private.redact_personal_terms('Ligar 95555-0000',private.contact_privacy_regex('Ana','Souza',null,'+55 11 95555-0000 x12',true))='Ligar [anonimizado]'
 and private.privacy_phone_regex('ramal 12') is null,
 'terms: a phone with an extension or a second number yields the terms of each number, and the extension alone is not a term');
-- Two numbers in the field separated only by spaces, by " - " or by nothing before the parenthesis (the screen and the
-- import store as typed what they do not recognize): each number is a term. A bare extension after the number neither
-- becomes a term nor swallows the number, and one number written with spaces stays one number.
select test_support.assert((select bool_and(private.redact_personal_terms('Fixo 3333-4444, celular 95555-0000',
  private.contact_privacy_regex('Ana','Souza',null,v.phone,true))='Fixo [anonimizado], celular [anonimizado]') from (values
  ('(11) 3333-4444 - (11) 95555-0000'),('(11)3333-4444 (11)95555-0000'),('(11)3333-4444(11)95555-0000'),('11 3333-4444 11 95555-0000'),
  ('11955550000 1133334444'),('(11) 95555-0000 (11) 3333-4444'),('+55 11 3333 4444 +55 11 9 5555 0000'),('11 3333 4444 11 9 5555 0000')
 ) v(phone))
 and private.redact_personal_terms('Ligar (11) 3333-4444, ramal 1234',private.contact_privacy_regex('Ana','Souza',null,'(11) 3333-4444 1234',true))='Ligar [anonimizado], ramal 1234'
 and private.redact_personal_terms('Tel: +55 11 9 5555 0000 ou (11) 95555-0000.',private.contact_privacy_regex('Ana','Souza',null,'+55 11 9 5555 0000',true))
  ='Tel: [anonimizado] ou [anonimizado].'
 and private.redact_personal_terms('Tel: +55 (11) 95555-0000 e 95555-0000',private.contact_privacy_regex('Ana','Souza',null,'+55(11)95555-0000',true))
  ='Tel: [anonimizado] e [anonimizado]',
 'terms: two numbers in the field separated by spaces, by " - " or by a parenthesis yield two terms, and a bare extension does not swallow the number');

-- 6. The anonymization (AC-5, AC-6, AC-7). The person: a contact with every personal field, a consent, a company and
-- the history (completed and pending activities, a note, the tasks of an automation, two deals, one of them lost, and
-- payments); another contact with the same first name; a third one, and records of the rest of the organization,
-- citing the full name, the email and the phone; a fourth contact that cites her in the source, the job title, the
-- note of the basis and the reason of the mark, a marked company that cites her in the reason, a contact anonymized
-- before whose source cites her; and records of organization B that cite her, which the sweep must not reach.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.companies(id,org_id,name) values('b2000000-0000-0000-0000-000000000041',current_setting('test.org_a')::uuid,'Empresa da Pessoa');
insert into public.contacts(id,org_id,first_name,last_name,email,phone,job_title,source,notes,company_id,owner_id,status,legal_basis,legal_basis_note) values
 ('b1000000-0000-0000-0000-000000000041',current_setting('test.org_a')::uuid,'Ana','Souza Lima','ana.souza@example.test','+5511955550000','Gerente de compras','Indicação da Ana na feira',
  'Ana prefere WhatsApp à tarde.','b2000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-0000000000b2','customer','consent','Aceitou no formulário do site em 10/10/2026.'),
 ('b1000000-0000-0000-0000-000000000042',current_setting('test.org_a')::uuid,'Ana','Ribeiro',null,null,null,null,'Ana Ribeiro gosta de café.',null,'00000000-0000-0000-0000-0000000000b2','lead','legitimate_interest',null),
 ('b1000000-0000-0000-0000-000000000043',current_setting('test.org_a')::uuid,'Carlos','Souto',null,null,null,null,
  'Conheceu a Ana Souza Lima na feira; e-mail ana.souza@example.test, tel (11) 95555-0000.',null,'00000000-0000-0000-0000-0000000000b2','prospect','legitimate_interest',null),
 ('b1000000-0000-0000-0000-000000000047',current_setting('test.org_a')::uuid,'Bia','Terceira',null,null,'Assistente de Ana Souza Lima','Indicação de Ana Souza Lima',null,
  null,'00000000-0000-0000-0000-0000000000b2','lead','consent','Consentimento dado pela mãe, Ana Souza Lima (ana.souza@example.test, +55 11 95555-0000).');
update public.contacts set do_not_contact=true,do_not_contact_reason='Pedido feito por Ana Souza Lima por e-mail.' where id='b1000000-0000-0000-0000-000000000047';
-- A reason of 499 characters whose phone grows with the replacement: the sweep keeps it within the 500 of the check.
-- The same for the note of the basis of another contact and for the reason of a company: without the limit, the
-- UPDATE of the sweep would break the check and the whole anonymization would fail. Item 1.11: the full name at the
-- start keeps its whole marker, and the phone marker cut at the end leaves with the "…" of the cut, without a broken
-- "[anonimizad".
insert into public.contacts(id,org_id,first_name,do_not_contact,do_not_contact_reason) values
 ('b1000000-0000-0000-0000-000000000049',current_setting('test.org_a')::uuid,'Caio Longo',true,'Pedido de Ana Souza Lima. '||repeat('x',462)||' 95555-0000');
insert into public.contacts(id,org_id,first_name,legal_basis,legal_basis_note) values
 ('b1000000-0000-0000-0000-00000000004b',current_setting('test.org_a')::uuid,'Dora Longa','consent','Pedido de Ana Souza Lima. '||repeat('x',462)||' 95555-0000');
insert into public.companies(id,org_id,name,do_not_contact,do_not_contact_reason) values
 ('b2000000-0000-0000-0000-000000000042',current_setting('test.org_a')::uuid,'Empresa Marcada',true,'Pedido de Ana Souza Lima, sócia.'),
 ('b2000000-0000-0000-0000-000000000043',current_setting('test.org_a')::uuid,'Empresa do Motivo Longo',true,'Pedido de Ana Souza Lima. '||repeat('x',462)||' 95555-0000');
with created as (insert into public.automations(org_id,name,trigger_type,task_title,is_active)
  values(current_setting('test.org_a')::uuid,'Proposta da pessoa','deal_created','Enviar a proposta',true) returning id)
 select set_config('test.person_automation',(select id from created)::text,true);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,company_id,owner_id,status,lost_reason) values
 ('b4000000-0000-0000-0000-000000000041',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Proposta Ana Souza Lima',1000,
  'b1000000-0000-0000-0000-000000000041','b2000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-0000000000b2','open',null),
 ('b4000000-0000-0000-0000-000000000042',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Renovação Ana',500,
  'b1000000-0000-0000-0000-000000000041',null,'00000000-0000-0000-0000-0000000000b2','lost','Ana achou caro'),
 ('b4000000-0000-0000-0000-000000000043',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Contrato com Ana Souza Lima e Carlos',700,
  'b1000000-0000-0000-0000-000000000043',null,'00000000-0000-0000-0000-0000000000b2','open',null);
update public.automations set is_active=false where id=current_setting('test.person_automation')::uuid;
insert into public.activities(id,org_id,type,title,body,contact_id,company_id,deal_id,user_id,due_date,end_date,completed_at,outcome) values
 ('b3000000-0000-0000-0000-000000000041',current_setting('test.org_a')::uuid,'call','Ligação com a Ana','Ana pediu desconto.','b1000000-0000-0000-0000-000000000041',
  'b2000000-0000-0000-0000-000000000041','b4000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-0000000000b2',now(),null,now(),'answered'),
 ('b3000000-0000-0000-0000-000000000042',current_setting('test.org_a')::uuid,'note','Nota da Ana','Contexto: Ana Souza Lima ligou de (11) 95555-0000.','b1000000-0000-0000-0000-000000000041',
  null,null,'00000000-0000-0000-0000-0000000000b2',null,null,null,null),
 ('b3000000-0000-0000-0000-000000000043',current_setting('test.org_a')::uuid,'whatsapp','Mandar proposta para Ana',null,'b1000000-0000-0000-0000-000000000041',
  null,'b4000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-0000000000b2',now()+interval '1 day',null,null,null),
 ('b3000000-0000-0000-0000-000000000044',current_setting('test.org_a')::uuid,'task','Preparar contrato da Ana',null,'b1000000-0000-0000-0000-000000000041',
  null,null,'00000000-0000-0000-0000-0000000000b2',now()+interval '2 days',null,null,null),
 ('b3000000-0000-0000-0000-000000000045',current_setting('test.org_a')::uuid,'email','E-mail para ana.souza@example.test','Enviado o catálogo.','b1000000-0000-0000-0000-000000000041',
  null,'b4000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-0000000000b2',now(),null,now(),null),
 ('b3000000-0000-0000-0000-000000000046',current_setting('test.org_a')::uuid,'task','Revisar proposta da Ana','Ana quer 10%.',null,
  null,'b4000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-0000000000b2',now()+interval '1 day',null,null,null),
 ('b3000000-0000-0000-0000-000000000047',current_setting('test.org_a')::uuid,'call','Alinhar com Carlos a proposta da Souza',null,'b1000000-0000-0000-0000-000000000043',
  null,'b4000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-0000000000b2',now()+interval '1 day',null,null,null),
 ('b3000000-0000-0000-0000-000000000048',current_setting('test.org_a')::uuid,'task','Ligar para Carlos','Ele citou o telefone (11) 95555-0000 da Ana.','b1000000-0000-0000-0000-000000000043',
  null,null,'00000000-0000-0000-0000-0000000000b2',now()+interval '1 day',null,null,null),
 ('b3000000-0000-0000-0000-000000000049',current_setting('test.org_a')::uuid,'meeting','Café com Ana Ribeiro',null,'b1000000-0000-0000-0000-000000000042',
  null,null,'00000000-0000-0000-0000-0000000000b2',now()+interval '1 day',now()+interval '25 hours',null,null),
 ('b3000000-0000-0000-0000-00000000004a',current_setting('test.org_a')::uuid,'task','Enviar material para Ana Souza Lima',null,'b1000000-0000-0000-0000-000000000042',
  null,null,'00000000-0000-0000-0000-0000000000b2',now(),null,now(),null);
insert into public.payments(id,org_id,description,amount,status,contact_id,deal_id,due_date,paid_at) values
 ('b5000000-0000-0000-0000-000000000041',current_setting('test.org_a')::uuid,'Entrada Ana Souza Lima',300,'pending','b1000000-0000-0000-0000-000000000041',null,current_date,null),
 ('b5000000-0000-0000-0000-000000000042',current_setting('test.org_a')::uuid,'Parcela 2 da proposta Ana',200,'paid',null,'b4000000-0000-0000-0000-000000000041',current_date,now()),
 ('b5000000-0000-0000-0000-000000000043',current_setting('test.org_a')::uuid,'Mensalidade de ana.souza@example.test',100,'pending','b1000000-0000-0000-0000-000000000042',null,current_date,null),
 ('b5000000-0000-0000-0000-000000000044',current_setting('test.org_a')::uuid,'Mensalidade do Carlos',100,'pending','b1000000-0000-0000-0000-000000000043',null,current_date,null),
 ('b5000000-0000-0000-0000-000000000045',current_setting('test.org_a')::uuid,'Parcela 3 da proposta Ana Souza Lima',150,'paid','b1000000-0000-0000-0000-000000000043','b4000000-0000-0000-0000-000000000041',current_date,now());
-- A contact already marked "Não contatar" by a collaborator, some days ago.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
insert into public.contacts(id,org_id,first_name,last_name,email,do_not_contact,do_not_contact_reason) values
 ('b1000000-0000-0000-0000-000000000044',current_setting('test.org_a')::uuid,'Paula','Prévia','paula@example.test',true,'Pediu para sair da lista.');
-- Organization B cites the same person: the sweep runs as the owner of the database and only the filter by organization
-- keeps it out.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
insert into public.contacts(id,org_id,first_name,notes) values
 ('b1000000-0000-0000-0000-000000000bb1',current_setting('test.org_b')::uuid,'Contato da B','Ana Souza Lima, ana.souza@example.test, (11) 95555-0000.');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,status,lost_reason) values
 ('b4000000-0000-0000-0000-000000000bb1',current_setting('test.org_b')::uuid,current_setting('test.pipeline_b')::uuid,current_setting('test.stage_b')::uuid,
  'Proposta Ana Souza Lima na B',300,'lost','Ana Souza Lima achou caro');
insert into public.activities(id,org_id,type,title,body,user_id,due_date,completed_at) values
 ('b3000000-0000-0000-0000-000000000bb1',current_setting('test.org_b')::uuid,'task','Ligar para Ana Souza Lima','Telefone (11) 95555-0000, e-mail ana.souza@example.test.',auth.uid(),now(),now());
insert into public.payments(id,org_id,description,amount,status,due_date) values
 ('b5000000-0000-0000-0000-000000000bb1',current_setting('test.org_b')::uuid,'Entrada de Ana Souza Lima',50,'pending',current_date);
insert into public.companies(id,org_id,name,do_not_contact,do_not_contact_reason) values
 ('b2000000-0000-0000-0000-000000000bb1',current_setting('test.org_b')::uuid,'Empresa Marcada da B',true,'Pedido de Ana Souza Lima, sócia.');
reset role;
set local session_replication_role=replica;
update public.contacts set do_not_contact_at='2026-10-01 10:00:00+00' where id='b1000000-0000-0000-0000-000000000044';
update public.contacts set do_not_contact_at='2026-10-02 10:00:00+00',do_not_contact_by='00000000-0000-0000-0000-0000000000b2',
 legal_basis_at='2026-10-02 10:00:00+00',legal_basis_by='00000000-0000-0000-0000-0000000000b2' where id='b1000000-0000-0000-0000-000000000047';
insert into public.contacts(id,org_id,first_name,source,do_not_contact,do_not_contact_at,anonymized_at,anonymized_by,legal_basis,created_at,updated_at) values
 ('b1000000-0000-0000-0000-000000000048',current_setting('test.org_a')::uuid,'Contato anonimizado','Indicação de Ana Souza Lima',true,'2026-10-03 10:00:00+00',
  '2026-10-03 10:00:00+00','00000000-0000-0000-0000-000000000001','legitimate_interest','2026-09-01 10:00:00+00','2026-10-03 10:00:00+00');
set local session_replication_role=origin;
select set_config('test.org_b_texts',(select string_agg(t,'|' order by t) from (
  select concat_ws(' ',title,body) as t from public.activities where org_id=current_setting('test.org_b')::uuid
  union all select concat_ws(' ',title,lost_reason) from public.deals where org_id=current_setting('test.org_b')::uuid
  union all select description from public.payments where org_id=current_setting('test.org_b')::uuid
  union all select notes from public.contacts where org_id=current_setting('test.org_b')::uuid and notes is not null
  union all select do_not_contact_reason from public.companies where org_id=current_setting('test.org_b')::uuid and do_not_contact_reason is not null) r),true);
-- What the reports count, the audit rows and the terms of the person, before the anonymization.
create function test_support.privacy_aggregates(p_org uuid) returns jsonb language sql security invoker as $$
 select jsonb_build_object(
  'deals',(select jsonb_object_agg(status,total) from (select status,sum(value) as total from public.deals where org_id=p_org group by status) x),
  'payments',(select jsonb_object_agg(status,total) from (select status,sum(amount) as total from public.payments where org_id=p_org group by status) x),
  'activities',(select jsonb_object_agg(k,n) from (select concat_ws('|',type,outcome,user_id) as k,count(*) as n from public.activities
    where org_id=p_org and completed_at is not null group by 1) x),
  'contacts',(select jsonb_object_agg(status,n) from (select status,count(*) as n from public.contacts where org_id=p_org group by status) x));
$$;
select set_config('test.aggregates',test_support.privacy_aggregates(current_setting('test.org_a')::uuid)::text,true);
select set_config('test.audit_ids',(select array_agg(id)::text from public.audit_logs),true);
select set_config('test.audit_md5',(select md5(string_agg(row(a.*)::text,',' order by a.id)) from public.audit_logs a),true);
select set_config('test.person_strong',private.contact_privacy_regex('Ana','Souza Lima','ana.souza@example.test','+5511955550000',true),true);
select set_config('test.person_all',private.contact_privacy_regex('Ana','Souza Lima','ana.souza@example.test','+5511955550000',false),true);
-- 6.1 Only owners and administrators: the collaborator, the viewer, the deactivated account, another organization and
-- anon are refused, and so are a contact that does not exist and an old version, without changing anything.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select test_support.denied_with('select public.contact_privacy_summary(''b1000000-0000-0000-0000-000000000041'')','Somente donos e administradores anonimizam contatos.','anonymize: a collaborator cannot read the summary');
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now())','Somente donos e administradores anonimizam contatos.','anonymize: a collaborator cannot anonymize');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',true);
select test_support.denied_with('select public.contact_privacy_summary(''b1000000-0000-0000-0000-000000000041'')','Somente donos e administradores anonimizam contatos.','anonymize: a viewer cannot read the summary');
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now())','Somente donos e administradores anonimizam contatos.','anonymize: a viewer cannot anonymize');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b4',true);
select test_support.denied_with('select public.contact_privacy_summary(''b1000000-0000-0000-0000-000000000041'')','Somente donos e administradores anonimizam contatos.','anonymize: a deactivated account cannot read the summary');
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now())','Somente donos e administradores anonimizam contatos.','anonymize: a deactivated account cannot anonymize');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.denied_with('select public.contact_privacy_summary(''b1000000-0000-0000-0000-000000000041'')','Este contato não está mais disponível.','anonymize: another organization does not see the contact in the summary');
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now())','Este contato não está mais disponível.','anonymize: another organization cannot anonymize the contact');
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select test_support.privilege_denied('select public.contact_privacy_summary(''b1000000-0000-0000-0000-000000000041'')','anonymize: anon cannot read the summary');
select test_support.privilege_denied('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now())','anonymize: anon cannot anonymize');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
select test_support.denied_with('select public.anonymize_contact(gen_random_uuid(),now())','Este contato não está mais disponível.','anonymize: a contact that does not exist is refused');
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now()-interval ''1 second'')','Este contato mudou desde o resumo.','anonymize: an old version is refused');
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',null)','Este contato mudou desde o resumo.','anonymize: a missing version is refused');
select test_support.assert((select first_name='Ana' and email='ana.souza@example.test' and anonymized_at is null from public.contacts where id='b1000000-0000-0000-0000-000000000041')
 and (select count(*)=7 from public.activities where contact_id='b1000000-0000-0000-0000-000000000041')
 and not exists(select 1 from public.privacy_actions),'anonymize: the refusals changed nothing and recorded nothing');
-- 6.2 The summary and the anonymization, by an administrator: the counts returned are those of the summary.
select set_config('test.summary',public.contact_privacy_summary('b1000000-0000-0000-0000-000000000041')::text,true);
select test_support.assert((select (s->>'version')::timestamptz=now() and s->'anonymized_at'='null'::jsonb
 and (s-'version'-'anonymized_at')='{"activities_scrubbed":3,"activities_deleted":4,"deals":2,"open_deals":1,"payments":3,"pending_payments":1,"other_records":13}'::jsonb
 from (select current_setting('test.summary')::jsonb as s) r),'anonymize: the summary has the version and the counts of what will change, without the records of organization B');
select set_config('test.anonymized',public.anonymize_contact('b1000000-0000-0000-0000-000000000041',(current_setting('test.summary')::jsonb->>'version')::timestamptz)::text,true);
select test_support.assert(current_setting('test.anonymized')::jsonb=(current_setting('test.summary')::jsonb-'version'-'anonymized_at'),'anonymize: the counts returned are those of the summary');
reset role;
-- 6.3 The effects, record by record (section 4.6 of the design).
select test_support.assert((select first_name='Contato anonimizado' and last_name is null and email is null and phone is null and job_title is null and notes is null
  and company_id is null and source='Indicação da [anonimizado] na feira' and do_not_contact and do_not_contact_at=now() and do_not_contact_by='00000000-0000-0000-0000-0000000000b1'
  and do_not_contact_reason is null and legal_basis='consent' and legal_basis_note is null and legal_basis_by='00000000-0000-0000-0000-000000000001'
  and anonymized_at=now() and anonymized_by='00000000-0000-0000-0000-0000000000b1' and owner_id='00000000-0000-0000-0000-0000000000b2' and status='customer'
 from public.contacts where id='b1000000-0000-0000-0000-000000000041'),'anonymize: the contact becomes "Contato anonimizado", without personal data, marked "Não contatar", with the basis kept without its note');
select test_support.assert(not exists(select 1 from public.activities where contact_id='b1000000-0000-0000-0000-000000000041' and completed_at is null and type<>'note')
 and not exists(select 1 from public.activities where id in ('b3000000-0000-0000-0000-000000000043','b3000000-0000-0000-0000-000000000044'))
 and (select count(*)=2 from public.automation_logs where automation_id=current_setting('test.person_automation')::uuid and status='success' and activity_id is null
  and deal_id in ('b4000000-0000-0000-0000-000000000041','b4000000-0000-0000-0000-000000000042')),
 'anonymize: the pending actions with the person are deleted, and the automation logs that created them stay without the link');
select test_support.assert((select string_agg(title||'|'||coalesce(body,'-')||'|'||type||'|'||coalesce(outcome,'-'),';' order by id) from public.activities where contact_id='b1000000-0000-0000-0000-000000000041')
  ='Ligação (contato anonimizado)|-|call|answered;Nota (contato anonimizado)|-|note|-;E-mail (contato anonimizado)|-|email|-'
 and (select completed_at=now() and user_id='00000000-0000-0000-0000-0000000000b2' and deal_id='b4000000-0000-0000-0000-000000000041' and company_id='b2000000-0000-0000-0000-000000000041'
  from public.activities where id='b3000000-0000-0000-0000-000000000041'),
 'anonymize: the activities with the person keep the type, the outcome, the dates, the person, the deal and the company, with the title by the type and no details');
select test_support.assert((select string_agg(title||'|'||coalesce(lost_reason,'-')||'|'||coalesce(contact_id::text,'-')||'|'||status||'|'||value,';' order by id)
  from public.deals where id in ('b4000000-0000-0000-0000-000000000041','b4000000-0000-0000-0000-000000000042','b4000000-0000-0000-0000-000000000043'))
  ='Proposta [anonimizado]|-|-|open|1000.00;Renovação [anonimizado]|[anonimizado] achou caro|-|lost|500.00;Contrato com [anonimizado] e Carlos|-|b1000000-0000-0000-0000-000000000043|open|700.00'
 and (select closed_at=now() and probability=0 and stage_id=current_setting('test.stage_a')::uuid from public.deals where id='b4000000-0000-0000-0000-000000000042'),
 'anonymize: the deals of the person lose the terms and the link and keep value, status, stage and closing; another deal loses only the strong terms');
select test_support.assert((select string_agg(description||'|'||coalesce(contact_id::text,'-')||'|'||coalesce(deal_id::text,'-')||'|'||status,';' order by id)
  from public.payments where id::text like 'b5000000-0000-0000-0000-00000000004_')
  ='Entrada [anonimizado]|-|-|pending;Parcela 2 da proposta [anonimizado]|-|b4000000-0000-0000-0000-000000000041|paid;Mensalidade de [anonimizado]|b1000000-0000-0000-0000-000000000042|-|pending;Mensalidade do Carlos|b1000000-0000-0000-0000-000000000043|-|pending;Parcela 3 da proposta [anonimizado]|b1000000-0000-0000-0000-000000000043|b4000000-0000-0000-0000-000000000041|paid',
 'anonymize: the payments of the person and of her deals lose the terms and the link to her, a payment of her deal keeps the link to another contact, and another payment loses only the strong terms');
select test_support.assert((select string_agg(title||'|'||coalesce(body,'-'),';' order by id) from public.activities where id in ('b3000000-0000-0000-0000-000000000046','b3000000-0000-0000-0000-000000000047',
  'b3000000-0000-0000-0000-000000000048','b3000000-0000-0000-0000-000000000049','b3000000-0000-0000-0000-00000000004a'))
  ='Revisar proposta da [anonimizado]|[anonimizado] quer 10%.;Alinhar com Carlos a proposta da [anonimizado]|-;Ligar para Carlos|Ele citou o telefone [anonimizado] da Ana.;Café com Ana Ribeiro|-;Enviar material para [anonimizado]|-',
 'anonymize: the activities of her deals lose every term; the rest of the organization loses only the full name, the email and the phone');
select test_support.assert((select notes='Conheceu a [anonimizado] na feira; e-mail [anonimizado], tel [anonimizado].' from public.contacts where id='b1000000-0000-0000-0000-000000000043')
 and (select notes='Ana Ribeiro gosta de café.' and first_name='Ana' and last_name='Ribeiro' from public.contacts where id='b1000000-0000-0000-0000-000000000042'),
 'anonymize: the notes of other contacts lose the strong terms, and a person with the same first name is not touched');
select test_support.assert((select source='Indicação de [anonimizado]' and job_title='Assistente de [anonimizado]'
  and legal_basis_note='Consentimento dado pela mãe, [anonimizado] ([anonimizado], [anonimizado]).'
  and do_not_contact_reason='Pedido feito por [anonimizado] por e-mail.' and legal_basis='consent' and do_not_contact
  and legal_basis_at='2026-10-02 10:00:00+00' and legal_basis_by='00000000-0000-0000-0000-0000000000b2'
  and do_not_contact_at='2026-10-02 10:00:00+00' and do_not_contact_by='00000000-0000-0000-0000-0000000000b2'
 from public.contacts where id='b1000000-0000-0000-0000-000000000047')
 and (select do_not_contact_reason='Pedido de [anonimizado], sócia.' and do_not_contact from public.companies where id='b2000000-0000-0000-0000-000000000042')
 and (select source='Indicação de [anonimizado]' and first_name='Contato anonimizado' and anonymized_at='2026-10-03 10:00:00+00'
  and anonymized_by='00000000-0000-0000-0000-000000000001' from public.contacts where id='b1000000-0000-0000-0000-000000000048')
 and (select do_not_contact_reason='Pedido de [anonimizado]. '||repeat('x',462)||'…' and length(do_not_contact_reason)<=500 from public.contacts where id='b1000000-0000-0000-0000-000000000049')
 and (select legal_basis_note='Pedido de [anonimizado]. '||repeat('x',462)||'…' and legal_basis='consent' from public.contacts where id='b1000000-0000-0000-0000-00000000004b')
 and (select do_not_contact_reason='Pedido de [anonimizado]. '||repeat('x',462)||'…' and do_not_contact from public.companies where id='b2000000-0000-0000-0000-000000000043')
 and not exists(select 1 from public.contacts where org_id=current_setting('test.org_a')::uuid and (legal_basis_note ~ '\[a?n?o?n?i?m?i?z?a?d?o?…?$' or do_not_contact_reason ~ '\[a?n?o?n?i?m?i?z?a?d?o?…?$'))
 and not exists(select 1 from public.companies where org_id=current_setting('test.org_a')::uuid and do_not_contact_reason ~ '\[a?n?o?n?i?m?i?z?a?d?o?…?$'),
 'anonymize: the source, the job title, the note of the basis and the reason of the mark of other contacts, and the reason of a company, lose the strong terms, keeping the stamps of the basis and of the mark; a contact anonymized before loses them from its source too, and a long reason of a contact, a long note of the basis and a long reason of a company stay within their limit, cut with "…" and without a broken marker (item 1.11)');
select test_support.assert((select string_agg(t,'|' order by t) from (
  select concat_ws(' ',title,body) as t from public.activities where org_id=current_setting('test.org_b')::uuid
  union all select concat_ws(' ',title,lost_reason) from public.deals where org_id=current_setting('test.org_b')::uuid
  union all select description from public.payments where org_id=current_setting('test.org_b')::uuid
  union all select notes from public.contacts where org_id=current_setting('test.org_b')::uuid and notes is not null
  union all select do_not_contact_reason from public.companies where org_id=current_setting('test.org_b')::uuid and do_not_contact_reason is not null) r)=current_setting('test.org_b_texts')
 and current_setting('test.org_b_texts') ~* current_setting('test.person_strong'),
 'anonymize: the records of organization B that cite the person do not change');
select test_support.assert(not exists(select 1 from (
  select concat_ws(' ',title,body) as t from public.activities where org_id=current_setting('test.org_a')::uuid
  union all select concat_ws(' ',title,lost_reason) from public.deals where org_id=current_setting('test.org_a')::uuid
  union all select description from public.payments where org_id=current_setting('test.org_a')::uuid
  union all select concat_ws(' ',first_name,last_name,email,phone,job_title,source,notes,do_not_contact_reason,legal_basis_note) from public.contacts where org_id=current_setting('test.org_a')::uuid
  union all select concat_ws(' ',name,do_not_contact_reason) from public.companies where org_id=current_setting('test.org_a')::uuid
 ) r where r.t ~* current_setting('test.person_strong'))
 and not exists(select 1 from (
  select concat_ws(' ',title,body) as t from public.activities where org_id=current_setting('test.org_a')::uuid
   and (contact_id='b1000000-0000-0000-0000-000000000041' or deal_id in ('b4000000-0000-0000-0000-000000000041','b4000000-0000-0000-0000-000000000042'))
  union all select concat_ws(' ',title,lost_reason) from public.deals where id in ('b4000000-0000-0000-0000-000000000041','b4000000-0000-0000-0000-000000000042')
  union all select description from public.payments where id in ('b5000000-0000-0000-0000-000000000041','b5000000-0000-0000-0000-000000000042')
  union all select concat_ws(' ',first_name,last_name,email,phone,job_title,source,notes,do_not_contact_reason,legal_basis_note) from public.contacts where id='b1000000-0000-0000-0000-000000000041'
 ) r where r.t ~* current_setting('test.person_all')),
 'anonymize: no free text of the organization has the full name, the email or the phone, and the records of the person do not have even the first name');
select test_support.assert(test_support.privacy_aggregates(current_setting('test.org_a')::uuid)::text=current_setting('test.aggregates'),
 'anonymize: the numbers of the reports (deals and payments by status, completed activities by type, outcome and person, contacts by status) are the same');
select test_support.assert((select count(*)=26 and count(distinct entity_id)=26 and count(*) filter (where action='delete')=4
  and bool_and(user_id='00000000-0000-0000-0000-0000000000b1') from public.audit_logs a where not a.id=any(current_setting('test.audit_ids')::uuid[]))
 and (select md5(string_agg(row(a.*)::text,',' order by a.id)) from public.audit_logs a where a.id=any(current_setting('test.audit_ids')::uuid[]))=current_setting('test.audit_md5')
 and (select count(*) from public.audit_logs a where a.id=any(current_setting('test.audit_ids')::uuid[]))=cardinality(current_setting('test.audit_ids')::uuid[]),
 'anonymize: each record changed or deleted gains one audit row with the author, and no previous audit row changes or disappears');
select test_support.assert((select count(*)=1 and bool_and(action='anonymize' and performed_by='00000000-0000-0000-0000-0000000000b1' and summary=current_setting('test.anonymized')::jsonb and created_at=now())
 from public.privacy_actions where contact_id='b1000000-0000-0000-0000-000000000041'),'anonymize: privacy_actions gains one row with the author and the counts');
-- 6.4 Once anonymized: refused again, and the summary has the date and no counts.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
select test_support.denied_with('select public.anonymize_contact(''b1000000-0000-0000-0000-000000000041'',now())','Este contato já foi anonimizado.','anonymize: a contact already anonymized is refused');
select test_support.assert((select s->>'anonymized_at' is not null
 and (s-'version'-'anonymized_at')='{"activities_scrubbed":0,"activities_deleted":0,"deals":0,"open_deals":0,"payments":0,"pending_payments":0,"other_records":0}'::jsonb
 from (select public.contact_privacy_summary('b1000000-0000-0000-0000-000000000041') as s) r),'anonymize: the summary of an anonymized contact has the date and no counts');
-- 6.5 The frozen record (AC-7): no personal data comes back; the owner and the status still change.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.denied_with(format('update public.contacts set %s where id=''b1000000-0000-0000-0000-000000000041''',s.assignment),
  'Este contato foi anonimizado e não recebe mais dados pessoais','frozen: '||s.label||' of an anonymized contact cannot change')
 from (values ('first_name=''Ana''','the first name'),('last_name=''Souza''','the last name'),('email=''ana@example.test''','the email'),
  ('phone=''+5511955550000''','the phone'),('job_title=''Gerente''','the job title'),('notes=''Voltou a falar.''','the notes'),('source=''Site''','the source'),
  ('company_id=''b2000000-0000-0000-0000-000000000041''','the company'),('do_not_contact=false','the mark'),('legal_basis=''contract''','the basis'),
  ('legal_basis_note=''Novo registro.''','the note of the basis')) s(assignment,label);
update public.contacts set owner_id='00000000-0000-0000-0000-0000000000b1',status='churned' where id='b1000000-0000-0000-0000-000000000041';
select test_support.assert((select owner_id='00000000-0000-0000-0000-0000000000b1' and status='churned' and first_name='Contato anonimizado'
 from public.contacts where id='b1000000-0000-0000-0000-000000000041'),'frozen: the owner and the status of an anonymized contact still change');
update public.contacts set anonymized_at=now(),anonymized_by=auth.uid() where id='b1000000-0000-0000-0000-000000000042';
insert into public.contacts(id,org_id,first_name,anonymized_at,anonymized_by) values('b1000000-0000-0000-0000-000000000045',current_setting('test.org_a')::uuid,'Nova Pessoa',now(),auth.uid());
select test_support.assert((select count(*)=2 and bool_and(anonymized_at is null and anonymized_by is null) from public.contacts
 where id in ('b1000000-0000-0000-0000-000000000042','b1000000-0000-0000-0000-000000000045')),'frozen: the client cannot write anonymized_at nor anonymized_by');
select test_support.denied_with(s.statement,'Este contato foi anonimizado e não recebe novos registros','frozen: '||s.label)
 from (values
  (format('insert into public.activities(org_id,type,title,contact_id,user_id) values(%L,''note'',''Nova nota'',''b1000000-0000-0000-0000-000000000041'',auth.uid())',current_setting('test.org_a')),'a new activity cannot be linked to it'),
  (format('insert into public.deals(org_id,pipeline_id,stage_id,title,contact_id) values(%L,%L,%L,''Nova oportunidade'',''b1000000-0000-0000-0000-000000000041'')',
   current_setting('test.org_a'),current_setting('test.pipeline_a'),current_setting('test.stage_a')),'a new deal cannot be linked to it'),
  (format('insert into public.payments(org_id,description,amount,due_date,contact_id) values(%L,''Novo recebimento'',10,current_date,''b1000000-0000-0000-0000-000000000041'')',current_setting('test.org_a')),'a new payment cannot be linked to it'),
  ('update public.activities set contact_id=''b1000000-0000-0000-0000-000000000041'' where id=''b3000000-0000-0000-0000-000000000049''','an activity of another contact cannot be linked to it'),
  ('update public.deals set contact_id=''b1000000-0000-0000-0000-000000000041'' where id=''b4000000-0000-0000-0000-000000000041''','a deal cannot be linked to it again'),
  ('update public.payments set contact_id=''b1000000-0000-0000-0000-000000000041'' where id=''b5000000-0000-0000-0000-000000000041''','a payment cannot be linked to it again')
 ) s(statement,label);
select test_support.denied_with(format('update public.activities set %s where id=''b3000000-0000-0000-0000-000000000041''',s.assignment),
  'Esta atividade é de um contato anonimizado','frozen: '||s.label)
 from (values ('title=''Ligação com a Ana''','the title of its activity cannot change'),('body=''Detalhes.''','the details of its activity cannot change'),
  ('completed_at=null','its activity cannot be reopened'),('outcome=''no_answer''','the outcome of its activity cannot change'),
  ('due_date=now()-interval ''1 day''','the date of its activity cannot change'),('type=''task''','the type of its activity cannot change')) s(assignment,label);
update public.activities set user_id='00000000-0000-0000-0000-0000000000b1',deal_id=null,company_id=null where id='b3000000-0000-0000-0000-000000000041';
update public.activities set contact_id=null where id='b3000000-0000-0000-0000-000000000042';
select test_support.assert((select user_id='00000000-0000-0000-0000-0000000000b1' and deal_id is null and company_id is null and title='Ligação (contato anonimizado)'
  from public.activities where id='b3000000-0000-0000-0000-000000000041')
 and (select contact_id is null from public.activities where id='b3000000-0000-0000-0000-000000000042'),'frozen: its activities still change person, deal and company, and can be unlinked');
-- 6.6 A contact already marked keeps the date and the author of the mark, and loses the reason.
select public.anonymize_contact('b1000000-0000-0000-0000-000000000044',(select updated_at from public.contacts where id='b1000000-0000-0000-0000-000000000044'));
select test_support.assert((select do_not_contact and do_not_contact_at='2026-10-01 10:00:00+00' and do_not_contact_by='00000000-0000-0000-0000-0000000000b2' and do_not_contact_reason is null
  and email is null and first_name='Contato anonimizado' and anonymized_by=auth.uid() from public.contacts where id='b1000000-0000-0000-0000-000000000044'),
 'anonymize: a contact already marked keeps the date and the author of the mark, and loses the reason');

-- 7. The export (AC-10): only owners and administrators; the contact, the linked company, the activities, the deals and
-- the payments, without any data of the team; recorded in privacy_actions with the counts. The records of her deal
-- linked to another contact, written in the format of the interactions of item 1.9 ("Ligação para <name>", with his
-- phone in the details), go with the terms of that contact replaced, both numbers of a landline and a mobile stored in
-- one field; a contact anonymized before has nothing left to replace.
update public.contacts set email='carlos.souto@example.test',phone='(11) 3333-4444 - (11) 97777-0000' where id='b1000000-0000-0000-0000-000000000043';
insert into public.companies(id,org_id,name) values('b2000000-0000-0000-0000-000000000061',current_setting('test.org_a')::uuid,'Empresa da Eva');
insert into public.contacts(id,org_id,first_name,last_name,email,phone,job_title,source,notes,company_id,owner_id,legal_basis,legal_basis_note,do_not_contact,do_not_contact_reason) values
 ('b1000000-0000-0000-0000-000000000061',current_setting('test.org_a')::uuid,'Eva','Exportada','eva@example.test','+5511944440000','Analista','Site','Prefere e-mail.',
  'b2000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-0000000000b2','contract','Contrato 42.',true,'Pediu só e-mail.'),
 ('b1000000-0000-0000-0000-000000000062',current_setting('test.org_a')::uuid,'Fábio','Sem Vínculos',null,null,null,null,null,null,null,'legitimate_interest',null,false,null);
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,contact_id,owner_id) values
 ('b4000000-0000-0000-0000-000000000061',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Plano anual da Eva',1200,
  'b1000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-0000000000b2');
insert into public.activities(id,org_id,type,title,body,contact_id,deal_id,user_id,due_date,completed_at,outcome) values
 ('b3000000-0000-0000-0000-000000000061',current_setting('test.org_a')::uuid,'call','Ligação de boas-vindas','Eva confirmou o plano.','b1000000-0000-0000-0000-000000000061',
  'b4000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-0000000000b2',now()-interval '1 day',now()-interval '1 day','answered'),
 ('b3000000-0000-0000-0000-000000000062',current_setting('test.org_a')::uuid,'task','Enviar o contrato',null,'b1000000-0000-0000-0000-000000000061',
  null,'00000000-0000-0000-0000-0000000000b2',now()+interval '1 day',null,null),
 ('b3000000-0000-0000-0000-000000000063',current_setting('test.org_a')::uuid,'note','Nota do plano','Eva está em tratamento de saúde e pediu prazo.',null,
  'b4000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-0000000000b2',null,null,null),
 ('b3000000-0000-0000-0000-000000000064',current_setting('test.org_a')::uuid,'call','Ligação para Carlos Souto','Carlos (+55 11 97777-0000, fixo 3333-4444, carlos.souto@example.test) disse que a Eva vai aprovar.',
  'b1000000-0000-0000-0000-000000000043','b4000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-0000000000b2',now()-interval '6 hours',now()-interval '6 hours','answered');
insert into public.payments(id,org_id,description,amount,status,contact_id,deal_id,due_date) values
 ('b5000000-0000-0000-0000-000000000061',current_setting('test.org_a')::uuid,'Adesão da Eva',150,'pending','b1000000-0000-0000-0000-000000000061',null,current_date),
 ('b5000000-0000-0000-0000-000000000062',current_setting('test.org_a')::uuid,'Primeira parcela do plano',100,'pending',null,'b4000000-0000-0000-0000-000000000061',current_date+1),
 ('b5000000-0000-0000-0000-000000000063',current_setting('test.org_a')::uuid,'Recebimento de outra pessoa',100,'pending','b1000000-0000-0000-0000-000000000043',null,current_date),
 ('b5000000-0000-0000-0000-000000000064',current_setting('test.org_a')::uuid,'Parcela do Carlos Souto, tel. (11) 97777-0000',100,'pending','b1000000-0000-0000-0000-000000000043',
  'b4000000-0000-0000-0000-000000000061',current_date+2);
-- A call of her deal with a contact anonymized before (written with the triggers off, as the guard refuses new links).
reset role;
set local session_replication_role=replica;
insert into public.activities(id,org_id,type,title,body,contact_id,deal_id,user_id,due_date,completed_at,outcome,created_at,updated_at) values
 ('b3000000-0000-0000-0000-000000000065',current_setting('test.org_a')::uuid,'call','Ligação (contato anonimizado)',null,'b1000000-0000-0000-0000-000000000048',
  'b4000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-0000000000b2',now()-interval '12 hours',now()-interval '12 hours','answered',now(),now());
set local session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select test_support.denied_with('select public.export_contact_data(''b1000000-0000-0000-0000-000000000061'')','Somente donos e administradores exportam os dados de um contato.','export: a collaborator cannot export');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',true);
select test_support.denied_with('select public.export_contact_data(''b1000000-0000-0000-0000-000000000061'')','Somente donos e administradores exportam os dados de um contato.','export: a viewer cannot export');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b4',true);
select test_support.denied_with('select public.export_contact_data(''b1000000-0000-0000-0000-000000000061'')','Somente donos e administradores exportam os dados de um contato.','export: a deactivated account cannot export');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.denied_with('select public.export_contact_data(''b1000000-0000-0000-0000-000000000061'')','Este contato não está mais disponível.','export: another organization cannot export the contact');
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select test_support.privilege_denied('select public.export_contact_data(''b1000000-0000-0000-0000-000000000061'')','export: anon cannot export');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
select test_support.denied_with('select public.export_contact_data(gen_random_uuid())','Este contato não está mais disponível.','export: a contact that does not exist is refused');
select test_support.assert(not exists(select 1 from public.privacy_actions where action='export'),'export: the refusals recorded nothing');
select set_config('test.export',public.export_contact_data('b1000000-0000-0000-0000-000000000061')::text,true);
select test_support.assert((select (e->>'format')::int=1 and (e->>'generated_at')::timestamptz=now() and e->'organization'->>'name'='Organização A da Privacidade'
  and e->'contact'->>'id'='b1000000-0000-0000-0000-000000000061' and e->'contact'->>'first_name'='Eva' and e->'contact'->>'last_name'='Exportada'
  and e->'contact'->>'email'='eva@example.test' and e->'contact'->>'phone'='+5511944440000' and e->'contact'->>'job_title'='Analista' and e->'contact'->>'notes'='Prefere e-mail.'
  and e->'contact'->>'status'='lead' and e->'contact'->>'legal_basis'='contract' and e->'contact'->>'legal_basis_note'='Contrato 42.' and (e->'contact'->>'legal_basis_at')::timestamptz=now()
  and (e->'contact'->>'do_not_contact')::boolean and e->'contact'->>'do_not_contact_reason'='Pediu só e-mail.' and e->'contact'->'anonymized_at'='null'::jsonb
  and e->'company'=jsonb_build_object('id','b2000000-0000-0000-0000-000000000061','name','Empresa da Eva')
  and jsonb_array_length(e->'activities')=5 and e->'activities'->0->>'title'='Ligação de boas-vindas' and e->'activities'->0->>'outcome'='answered'
  and e->'activities'->0->>'body'='Eva confirmou o plano.' and e->'activities'->0->>'deal_id'='b4000000-0000-0000-0000-000000000061'
  and (select string_agg(a->>'title'||'|'||(a->>'relation'),';' order by a->>'title') from jsonb_array_elements(e->'activities') a)
   ='Enviar o contrato|person;Ligação (contato anonimizado)|other_contact;Ligação de boas-vindas|person;Ligação para [anonimizado]|other_contact;Nota do plano|no_contact'
  and (select a->>'body' from jsonb_array_elements(e->'activities') a where a->>'id'='b3000000-0000-0000-0000-000000000064')
   ='[anonimizado] ([anonimizado], fixo [anonimizado], [anonimizado]) disse que a Eva vai aprovar.'
  and (select a->>'body' from jsonb_array_elements(e->'activities') a where a->>'id'='b3000000-0000-0000-0000-000000000063')
   ='Eva está em tratamento de saúde e pediu prazo.'
  and jsonb_array_length(e->'deals')=1 and e->'deals'->0->>'title'='Plano anual da Eva' and (e->'deals'->0->>'value')::numeric=1200 and e->'deals'->0->>'status'='open'
  and e->'deals'->0->>'pipeline'=(select name from public.pipelines where id=current_setting('test.pipeline_a')::uuid)
  and e->'deals'->0->>'stage'=(select name from public.pipeline_stages where id=current_setting('test.stage_a')::uuid)
  and (select array_agg(p->>'description' order by p->>'description') from jsonb_array_elements(e->'payments') p)
   ='{"Adesão da Eva","Parcela do [anonimizado], tel. [anonimizado]","Primeira parcela do plano"}'
 from (select current_setting('test.export')::jsonb as e) r),
 'export: the contact with the basis, the note and the mark, the linked company, the activities with the person and those of her deal (with or without another contact), the deal with pipeline and stage, and the payments of the person and of her deal');
select test_support.assert(strpos(current_setting('test.export'),'b1000000-0000-0000-0000-000000000043')=0
 and strpos(current_setting('test.export'),'b1000000-0000-0000-0000-000000000048')=0
 and current_setting('test.export') !~* '(carlos|souto|97777|3333-4444|carlos\.souto@example\.test)'
 and strpos(current_setting('test.export'),'Recebimento de outra pessoa')=0,
 'export: the records of her deal linked to another contact go without his id, name, email or either of the two numbers of his phone field (written as the interactions of item 1.9 write them), and the records of other people stay out');
select test_support.assert(current_setting('test.export') !~ '"(owner_id|user_id|created_by|do_not_contact_by|legal_basis_by|anonymized_by|performed_by|probability)"'
 and not exists(select 1 from public.profiles p where p.org_id=current_setting('test.org_a')::uuid
  and (strpos(current_setting('test.export'),p.id::text)>0 or strpos(current_setting('test.export'),coalesce(nullif(p.name,''),'(sem nome)'))>0
   or strpos(current_setting('test.export'),coalesce(nullif(p.email,''),'(sem e-mail)'))>0)),
 'export: no id, name or email of the team, and no probability');
select test_support.assert((select count(*)=1 and bool_and(action='export' and performed_by=auth.uid() and summary='{"activities":5,"deals":1,"payments":3}'::jsonb and created_at=now())
 from public.privacy_actions where contact_id='b1000000-0000-0000-0000-000000000061'),'export: the export is recorded with the author and the counts, in the same transaction');
select set_config('test.export_anonymized',public.export_contact_data('b1000000-0000-0000-0000-000000000041')::text,true);
select test_support.assert((select e->'contact'->>'first_name'='Contato anonimizado' and e->'contact'->>'anonymized_at' is not null and e->'contact'->'email'='null'::jsonb
  from (select current_setting('test.export_anonymized')::jsonb as e) r)
 and (select count(*)=1 from public.privacy_actions where contact_id='b1000000-0000-0000-0000-000000000041' and action='export'),'export: an anonymized contact exports its anonymized record, recorded too');
select public.export_contact_data('b1000000-0000-0000-0000-000000000062');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
with removed as (delete from public.contacts where id='b1000000-0000-0000-0000-000000000062' returning 1) select test_support.assert(count(*)=1,'export: a contact without links is deleted after the export') from removed;
select test_support.assert((select count(*)=1 and bool_and(contact_id is null) from public.privacy_actions where action='export' and summary='{"activities":0,"deals":0,"payments":0}'::jsonb),
 'export: the record of the export stays, without the link to the deleted contact');
-- 7.1 Only owners and administrators read the records, and nobody writes them directly.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',true);
select test_support.assert((select count(*)=0 from public.privacy_actions),'records: a collaborator reads no privacy record');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b3',true);
select test_support.assert((select count(*)=0 from public.privacy_actions),'records: a viewer reads no privacy record');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b4',true);
select test_support.assert((select count(*)=0 from public.privacy_actions),'records: a deactivated account reads no privacy record');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select test_support.assert((select count(*)=0 from public.privacy_actions),'records: another organization reads no privacy record');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert((select count(*)=5 from public.privacy_actions),'records: an owner reads the records of the organization');
select test_support.privilege_denied(format('insert into public.privacy_actions(org_id,action) values(%L,''export'')',current_setting('test.org_a')),'records: an owner cannot insert a record directly');
select test_support.privilege_denied('update public.privacy_actions set summary=''{}''','records: an owner cannot change a record');
select test_support.privilege_denied('delete from public.privacy_actions','records: an owner cannot delete a record');
reset role;

-- 8. The audit (AC-11): audit_logs keeps the names of the fields, never the values.
select test_support.assert((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' order by a.attnum) from pg_attribute a
 where a.attrelid='public.audit_logs'::regclass and a.attnum>0 and not a.attisdropped)
 ='id:uuid,org_id:uuid,user_id:uuid,entity_type:text,entity_id:uuid,action:text,changed_fields:text[],created_at:timestamp with time zone',
 'audit: audit_logs keeps only the entity, the action, the names of the fields, the author and the time, without value columns');

-- 9. Instance in use before the migration (AC-12): the legacy contacts and organization start "not_informed", without a
-- stamp and with the same versions, and a legacy contact with notes and history is anonymized after the migration.
select test_support.sign_out();
select test_support.assert((select count(*)=4 and bool_and(legal_basis='not_informed' and legal_basis_note is null and legal_basis_at is null and legal_basis_by is null
  and anonymized_at is null and anonymized_by is null) from public.contacts where id in ('96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000003',
  '97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000002'))
 and (select count(*)=2 and bool_and(updated_at='2026-09-22 10:00:00+00') from public.contacts where id::text like '97000000-%')
 and (select default_legal_basis='not_informed' and default_legal_basis_at is null and default_legal_basis_by is null from public.organizations where id='90000000-0000-0000-0000-000000000001')
 and not exists(select 1 from public.audit_logs where entity_id::text like '97000000-%'),
 'upgrade: the legacy contacts and organization start "not_informed", without a stamp, with the same versions and no audit row');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
select set_config('test.legacy_summary',public.contact_privacy_summary('97000000-0000-0000-0000-000000000001')::text,true);
select test_support.assert((select (s->>'version')::timestamptz='2026-09-22 10:00:00+00'
 and (s-'version'-'anonymized_at')='{"activities_scrubbed":2,"activities_deleted":1,"deals":1,"open_deals":1,"payments":1,"pending_payments":1,"other_records":1}'::jsonb
 from (select current_setting('test.legacy_summary')::jsonb as s) r),'upgrade: the summary of a legacy contact counts its history');
select public.anonymize_contact('97000000-0000-0000-0000-000000000001','2026-09-22 10:00:00+00');
reset role;
select test_support.assert((select first_name='Contato anonimizado' and last_name is null and email is null and phone is null and job_title is null and notes is null
  and company_id is null and source='Indicação da [anonimizado] no evento' and do_not_contact and legal_basis='not_informed' and anonymized_by='00000000-0000-0000-0000-000000000099'
  from public.contacts where id='97000000-0000-0000-0000-000000000001')
 and (select title='Proposta [anonimizado]' and contact_id is null and value=4200 from public.deals where id='97000000-0000-0000-0000-000000000021')
 and (select description='Entrada da [anonimizado]' and contact_id is null from public.payments where id='97000000-0000-0000-0000-000000000031')
 and (select string_agg(title||'|'||coalesce(body,'-'),';' order by id) from public.activities where id::text like '97000000-%')='Ligação (contato anonimizado)|-;Nota (contato anonimizado)|-'
 and (select notes='Indicado por [anonimizado] ([anonimizado]).' from public.contacts where id='97000000-0000-0000-0000-000000000002'),
 'upgrade: a legacy contact with notes and history is anonymized after the migration');
select test_support.sign_out();
rollback to savepoint contact_privacy;
select test_support.assert(not exists(select 1 from auth.users where email='colaboracao-privacidade@example.test') and not exists(select 1 from public.privacy_actions)
 and (select first_name='Helena' from public.contacts where id='97000000-0000-0000-0000-000000000001'),'the checks of item 1.10 were undone for the files that follow');
