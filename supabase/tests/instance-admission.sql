-- Included last inside commercial-security.sql's rollback transaction: section 9 empties the instance.
-- Item 1.1: single company with admission by invitation only
-- (supabase/migrations/20261012100000_single_company_admission.sql, design in docs/arquitetura/1.1.md).
-- Run through `npm run test:db`: the upgrade checks need the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261012100000_single_company_admission.sql right before that migration. The race between
-- two first signups needs two sessions and runs in scripts/test-database.mjs, after this transaction.
-- Accounts: 1 owner A, 2 owner B, 3 collaborator A, 4 administrator A, 5 confirmed without organization,
-- 6 viewer A, 98 orphan from before the item, 99 legacy owner.
reset role;
select set_config('request.jwt.claim.sub','',true);
grant usage on schema test_support to anon;
grant execute on function test_support.assert(boolean,text),test_support.privilege_denied(text,text) to anon;

-- 1. Schema.
select test_support.assert(exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='enforce_invite_only_signup' and tgfoid='private.enforce_invite_only_signup()'::regprocedure and tgtype=7 and tgenabled='O'),'the signup gate is an enabled BEFORE INSERT row trigger on auth.users');
select test_support.assert((select count(*)=11 and bool_and(p.prosecdef=expected.definer and p.proconfig @> array['search_path=""']) from (values
 ('private.provision_organization(uuid,text)',false),
 ('private.is_owner()',true),
 ('private.create_workspace(text)',true),
 ('private.instance_status()',true),
 ('public.instance_status()',false),
 ('private.signup_allowed(text)',false),
 ('private.enforce_invite_only_signup()',true),
 ('private.create_invitation(text,text)',true),
 ('public.create_invitation(text,text)',false),
 ('private.accept_invitation(uuid)',true),
 ('private.restore_owner(text,uuid)',false)
) expected(signature,definer) join pg_proc p on p.oid=expected.signature::regprocedure),'admission functions are SECURITY DEFINER or INVOKER as designed, all with an empty search_path');
select test_support.assert((select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.invitations'::regclass and conname='invitations_role_check') like '%owner%admin%member%viewer%','invitations accept the owner role');
select test_support.assert(not has_table_privilege('authenticated','public.invitations','insert') and not has_any_column_privilege('authenticated','public.invitations','insert') and not has_any_column_privilege('authenticated','public.invitations','update'),'authenticated cannot insert or update invitations directly, not even by column');
select test_support.assert((select array_agg(policyname::text) from pg_policies where schemaname='public' and tablename='invitations' and cmd in ('SELECT','ALL','INSERT'))='{invitations_manager_read}','invitations have a single read policy, for managers, and no insert policy');
select test_support.assert((select array_agg(policyname::text) from pg_policies where schemaname='public' and tablename='invitations' and cmd='DELETE')='{invitations_manager_delete}','invitations have a single delete policy, for managers');
select test_support.assert(has_function_privilege('authenticated','private.is_owner()','execute') and not has_function_privilege('anon','private.is_owner()','execute'),'the owner check used by the invitation policies runs for authenticated, not for anon');
select test_support.assert(not has_function_privilege('anon','private.restore_owner(text,uuid)','execute') and not has_function_privilege('authenticated','private.restore_owner(text,uuid)','execute') and not has_function_privilege('service_role','private.restore_owner(text,uuid)','execute'),'no API role executes restore_owner');
select test_support.assert(not exists(select 1 from (values ('private.provision_organization(uuid,text)'),('private.signup_allowed(text)'),('private.enforce_invite_only_signup()')) f(signature) cross join (values ('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(r.role,f.signature,'execute')),'no API role executes the provisioning, the signup check or the gate function');

-- 2. anon: only whether the instance has a company.
select test_support.assert(pg_get_function_result('public.instance_status()'::regprocedure)='TABLE(has_organization boolean)','instance_status returns only has_organization');
select test_support.assert((select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace='private'::regnamespace and has_function_privilege('anon',p.oid,'execute'))='{instance_status}','anon executes only instance_status in the private schema');
select test_support.assert((select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('anon',p.oid,'execute'))='{instance_status}','anon executes only instance_status among the public RPCs');
set local role anon;
select test_support.assert((select count(*)=1 and bool_and(has_organization) from public.instance_status()),'anon reads that the instance already has a company');
select test_support.privilege_denied('select public.create_workspace(''Empresa anônima'')','anon cannot call create_workspace');
select test_support.privilege_denied('select public.create_invitation(''anon@example.test'',''member'')','anon cannot call create_invitation');
select test_support.privilege_denied('select public.accept_invitation(gen_random_uuid())','anon cannot call accept_invitation');
select test_support.privilege_denied('select private.signup_allowed(''anon@example.test'')','anon cannot call the signup check');
select test_support.privilege_denied('select count(*) from public.organizations','anon still reads no table');
reset role;

-- 3. Signup gate with a company: only an email with a pending, valid invitation.
select test_support.denied_with('insert into auth.users(id,email) values(gen_random_uuid(),''stranger@example.test'')','aceita novas contas só por convite','with a company, an email without invitation cannot sign up');
select test_support.denied_with('insert into auth.users(id,email) values(gen_random_uuid(),null)','aceita novas contas só por convite','with a company, an account without email cannot sign up');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select set_config('test.invite_gate',public.create_invitation('Convidada@Example.test','viewer')::text,true)::uuid;
select set_config('test.invite_expired',public.create_invitation('vencida@example.test','member')::text,true)::uuid;
reset role;
update public.invitations set expires_at=now()-interval '1 minute' where id=current_setting('test.invite_expired')::uuid;
select test_support.denied_with('insert into auth.users(id,email) values(gen_random_uuid(),''vencida@example.test'')','aceita novas contas só por convite','an expired invitation does not open the signup');
select test_support.denied_with('insert into auth.users(id,email) values(gen_random_uuid(),''NEW@example.test'')','aceita novas contas só por convite','an invitation already used does not open the signup');
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000010','  CONVIDADA@example.TEST ');
select test_support.assert(exists(select 1 from public.profiles where id='00000000-0000-0000-0000-000000000010' and org_id is null),'a valid invitation opens the signup regardless of case and surrounding spaces, and the profile is created');
select test_support.assert((select email='convidada@example.test' from public.invitations where id=current_setting('test.invite_gate')::uuid),'create_invitation stores the email in lowercase, without spaces');

-- 4. create_invitation: who invites whom, validation, duplicates and the expired invitation.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert((select count(*)=4 from (select public.create_invitation(r||'-by-owner@example.test',r) from unnest(array['owner','admin','member','viewer']) r) created),'an owner invites owners, administrators, collaborators and viewers');
select test_support.assert((select count(*)=4 from public.invitations where email like '%-by-owner@example.test' and split_part(email,'-',1)=role and invited_by=auth.uid() and expires_at between now()+interval '7 days'-interval '1 minute' and now()+interval '7 days'),'invitations keep the requested role, the inviter and the 7-day validity');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select test_support.assert((select count(*)=3 from (select public.create_invitation(r||'-by-admin@example.test',r) from unnest(array['admin','member','viewer']) r) created),'an administrator invites administrators, collaborators and viewers');
select test_support.denied_with('select public.create_invitation(''owner-by-admin@example.test'',''owner'')','Somente um dono pode convidar outro dono','an administrator cannot invite an owner');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select test_support.denied_with('select public.create_invitation(''by-member@example.test'',''viewer'')','Somente donos e administradores podem convidar pessoas','a collaborator cannot invite');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
select test_support.denied_with('select public.create_invitation(''by-viewer@example.test'',''viewer'')','Somente donos e administradores podem convidar pessoas','a viewer cannot invite');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select test_support.denied_with('select public.create_invitation(''by-orphan@example.test'',''viewer'')','Somente donos e administradores podem convidar pessoas','an account without organization cannot invite');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select set_config('test.invite_b',public.create_invitation('member-by-owner@example.test','member')::text,true)::uuid;
select test_support.assert((select org_id=current_setting('test.org_b')::uuid from public.invitations where id=current_setting('test.invite_b')::uuid),'an owner of another organization invites only into their own organization');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.denied_with('select public.create_invitation(''sem-arroba.example.test'',''member'')','Informe um e-mail válido','an email without @ is refused');
select test_support.denied_with('select public.create_invitation(''pessoa @example.test'',''member'')','Informe um e-mail válido','an email with inner spaces is refused');
select test_support.denied_with('select public.create_invitation(''pessoa@dominio'',''member'')','Informe um e-mail válido','an email without a top-level domain is refused');
select test_support.denied_with('select public.create_invitation(null,''member'')','Informe um e-mail válido','a missing email is refused');
select test_support.denied_with(format('select public.create_invitation(%L,''member'')',repeat('a',250)||'@example.test'),'Informe um e-mail válido','an email longer than 254 characters is refused');
select test_support.denied_with('select public.create_invitation(''papel@example.test'',''manager'')','Papel inválido','an unknown role is refused');
select test_support.denied_with('select public.create_invitation(''papel@example.test'',null)','Papel inválido','a missing role is refused');
select test_support.denied_with('select public.create_invitation('' Viewer@Example.test '',''admin'')','Esta pessoa já faz parte da equipe','an email of someone already in the team is refused');
select test_support.denied_with('select public.create_invitation('' MEMBER-by-owner@example.test '',''viewer'')','Já existe um convite válido para este e-mail','a second valid invitation for the same email is refused');
select set_config('test.invite_renewed',public.create_invitation('Vencida@example.test','viewer')::text,true)::uuid;
select test_support.assert(current_setting('test.invite_renewed')<>current_setting('test.invite_expired')
 and not exists(select 1 from public.invitations where id=current_setting('test.invite_expired')::uuid)
 and exists(select 1 from public.invitations where id=current_setting('test.invite_renewed')::uuid and role='viewer' and email='vencida@example.test' and accepted_at is null and expires_at>now()),'an expired invitation gives way to a new one, with a new id');
select test_support.assert(exists(select 1 from public.audit_logs where entity_type='invitations' and entity_id=current_setting('test.invite_expired')::uuid and action='delete' and user_id=auth.uid()),'replacing an expired invitation is audited as a deletion by the inviter');
reset role;
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000014','vencida@example.test');
select test_support.assert(exists(select 1 from public.profiles where id='00000000-0000-0000-0000-000000000014'),'the renewed invitation opens the signup');

-- 5. Reading and revoking invitations.
set local role authenticated;
do $$
declare actor record; visible integer;
begin
 for actor in select * from (values
  ('owner','00000000-0000-0000-0000-000000000001'::uuid,1),
  ('administrator','00000000-0000-0000-0000-000000000004'::uuid,1),
  ('collaborator','00000000-0000-0000-0000-000000000003'::uuid,0),
  ('viewer','00000000-0000-0000-0000-000000000006'::uuid,0),
  ('other-organization owner','00000000-0000-0000-0000-000000000002'::uuid,0),
  ('account without organization','00000000-0000-0000-0000-000000000005'::uuid,0)
 ) as actors(label,user_id,expected) loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  select count(*) into visible from public.invitations where id=current_setting('test.invite_gate')::uuid;
  perform test_support.assert(visible=actor.expected,'invitations: '||actor.label||' reads '||actor.expected||' invitation of organization A');
 end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
with removed as (delete from public.invitations where email='viewer-by-admin@example.test' returning 1) select test_support.assert(count(*)=0,'a collaborator cannot revoke an invitation') from removed;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
with removed as (delete from public.invitations where email='viewer-by-admin@example.test' returning 1) select test_support.assert(count(*)=1,'an administrator revokes an invitation') from removed;
-- The owner invitation: only an owner reads and revokes it. With its email, an administrator could create the invited
-- account first, with a password of their own, and sign in as an owner after the acceptance.
select test_support.assert((select count(*)=0 from public.invitations where role='owner'),'an administrator reads no owner invitation');
with removed as (delete from public.invitations where email='owner-by-owner@example.test' returning 1) select test_support.assert(count(*)=0,'an administrator cannot revoke an owner invitation') from removed;
-- Without a column read (no WHERE, RETURNING a constant), only the delete policy filters the rows; the savepoint
-- undoes the bulk revocation, and the role and the session it set.
savepoint bulk_revocation;
with removed as (delete from public.invitations returning 1) select test_support.assert(count(*)>0,'an administrator revokes in bulk only the invitations they manage') from removed;
reset role;
select test_support.assert(exists(select 1 from public.invitations where email='owner-by-owner@example.test'),'a bulk revocation by an administrator keeps the owner invitation');
rollback to savepoint bulk_revocation;
select test_support.assert(current_user='authenticated' and auth.uid()='00000000-0000-0000-0000-000000000004' and exists(select 1 from public.invitations where email='viewer-by-owner@example.test'),'the bulk revocation was undone');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.assert((select count(*)=1 from public.invitations where email='owner-by-owner@example.test' and role='owner'),'an owner reads the owner invitation, which the administrator did not revoke');
with removed as (delete from public.invitations where email='owner-by-owner@example.test' returning 1) select test_support.assert(count(*)=1,'an owner revokes an owner invitation') from removed;

-- 6. accept_invitation: the owner invitation and each refusal, in an order that tells another account only that the
-- invitation is not theirs.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select set_config('test.invite_owner',public.create_invitation('segunda-dona@example.test','owner')::text,true)::uuid;
select set_config('test.invite_used',public.create_invitation('usado@example.test','member')::text,true)::uuid;
select set_config('test.invite_late',public.create_invitation('atrasada@example.test','member')::text,true)::uuid;
reset role;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000011','segunda-dona@example.test',now()),
 ('00000000-0000-0000-0000-000000000012','usado@example.test',now()),
 ('00000000-0000-0000-0000-000000000013','atrasada@example.test',now());
-- Used by someone with this email who left the organization; expired after the signup.
update public.invitations set accepted_at=now() where id=current_setting('test.invite_used')::uuid;
update public.invitations set expires_at=now()-interval '1 minute' where id=current_setting('test.invite_late')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
-- Checks of what an RPC wrote go in the next statement: the snapshot of the calling statement does not see them.
select test_support.assert(public.accept_invitation(current_setting('test.invite_owner')::uuid)=current_setting('test.org_a')::uuid,'an owner invitation is accepted');
select test_support.assert((select role='owner' from public.user_roles where user_id=auth.uid()),'an owner invitation makes the account an owner');
select set_config('request.jwt.claim.sub','',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_gate')),'Entre na sua conta para aceitar','accepting needs a session');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000010',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_gate')),'Confirme seu e-mail antes de aceitar o convite','accepting needs a confirmed email');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_gate')),'Sua conta já pertence a uma organização','an account in an organization cannot accept');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
select test_support.denied_with('select public.accept_invitation(gen_random_uuid())','Convite não encontrado. Ele pode ter sido revogado ou trocado por um novo','a revoked or replaced invitation is reported as not found');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_expired')),'Convite não encontrado','the id of a replaced expired invitation is reported as not found');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_gate')),'Este convite é para outro e-mail','an invitation for another email is refused');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_used')),'Este convite é para outro e-mail','another account learns only that a used invitation is not theirs');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_late')),'Este convite é para outro e-mail','another account learns only that an expired invitation is not theirs');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_used')),'Este convite já foi usado','a used invitation is refused as used');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000013',true);
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_late')),'Este convite expirou. Peça um novo a quem administra','an expired invitation is refused as expired');
select test_support.assert(private.current_org() is null,'a refused acceptance leaves the account without organization');
reset role;

-- 8 (before 7, which changes the orphan account). Instance in use before the migration: the legacy organization.
select test_support.assert((select role='owner' from public.user_roles where user_id='00000000-0000-0000-0000-000000000099'),'upgrade: the legacy owner is still the owner');
insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-0000-0000-000000000020','pendente@example.test',now());
select test_support.assert(exists(select 1 from public.profiles where id='00000000-0000-0000-0000-000000000020'),'upgrade: a valid legacy invitation stored with capitals and spaces still opens the signup');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
select test_support.assert(private.can_manage() and private.current_org()='90000000-0000-0000-0000-000000000001' and (select count(*)=3 from public.invitations),'upgrade: the legacy owner still manages the company and reads its invitations');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000020',true);
select test_support.assert(public.accept_invitation('94000000-0000-0000-0000-000000000001')='90000000-0000-0000-0000-000000000001','upgrade: the legacy invitation is accepted');
select test_support.assert(private.can_write() and not private.can_manage(),'upgrade: the legacy invitation gives its role');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
select set_config('test.legacy_renewed',public.create_invitation('expirado@example.test','viewer')::text,true)::uuid;
select test_support.assert(not exists(select 1 from public.invitations where id='94000000-0000-0000-0000-000000000002') and exists(select 1 from public.invitations where id=current_setting('test.legacy_renewed')::uuid and expires_at>now()),'upgrade: the legacy owner renews an expired invitation');
select test_support.assert((select accepted_at is not null from public.invitations where id='94000000-0000-0000-0000-000000000003'),'upgrade: an accepted legacy invitation stays accepted');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000098',true);
select test_support.denied_with('select public.create_workspace(''Empresa da conta órfã'')','Este CRM já tem uma empresa','upgrade: an account without organization from before the item cannot create a company');
select test_support.privilege_denied('select private.restore_owner(''orfa@example.test'')','the API cannot call restore_owner');
reset role;

-- 7. Break-glass, as the database owner (SQL editor of the dashboard): no session, so the audit has no author.
select set_config('request.jwt.claim.sub','',true);
select test_support.assert(private.restore_owner(' Viewer@Example.test ')='A conta viewer@example.test agora tem o papel de Dono.','restore_owner reports the owner role given back');
select test_support.assert((select role='owner' from public.user_roles where user_id='00000000-0000-0000-0000-000000000003'),'restore_owner gives the owner role back to an account of the company');
select test_support.assert(exists(select 1 from public.audit_logs l join public.user_roles r on r.id=l.entity_id where r.user_id='00000000-0000-0000-0000-000000000003' and l.entity_type='user_roles' and l.action='update' and l.user_id is null and 'role'=any(l.changed_fields)),'the role restored from the SQL editor is audited without author');
select test_support.assert(private.restore_owner('owner-a@example.test',current_setting('test.org_a')::uuid)='A conta owner-a@example.test agora tem o papel de Dono.','restore_owner keeps an owner as owner');
select test_support.denied_with('select private.restore_owner(''orfa@example.test'')','Este CRM tem 3 organizações. Informe qual em p_org_id','with several organizations, an account without organization needs p_org_id');
select test_support.assert(private.restore_owner('orfa@example.test','90000000-0000-0000-0000-000000000001')='A conta orfa@example.test entrou na empresa com o papel de Dono.','restore_owner reports the account that joined as owner');
select test_support.assert((select org_id='90000000-0000-0000-0000-000000000001' from public.profiles where id='00000000-0000-0000-0000-000000000098') and (select role='owner' from public.user_roles where user_id='00000000-0000-0000-0000-000000000098'),'restore_owner makes an account without organization an owner of the company');
select test_support.denied_with('select private.restore_owner(''novo-dono@example.test'')','Este CRM tem 3 organizações','without an account and with several organizations, restore_owner needs p_org_id');
select set_config('test.restore_message',private.restore_owner('novo-dono@example.test',current_setting('test.org_a')::uuid),true);
select test_support.assert(exists(select 1 from public.invitations where org_id=current_setting('test.org_a')::uuid and email='novo-dono@example.test' and role='owner' and accepted_at is null and current_setting('test.restore_message')=format('Não há conta com este e-mail. Convite de dono criado: abra <endereço do CRM>/?invite=%s, cadastre-se com este e-mail e confirme-o.',id)),'without an account, restore_owner creates an owner invitation and returns its link');
select test_support.assert(private.restore_owner('Member-By-Owner@example.test',current_setting('test.org_a')::uuid) like 'Não há conta com este e-mail.%','restore_owner creates an owner invitation for an email with a pending invitation');
select test_support.assert((select count(*)=1 and bool_and(role='owner') from public.invitations where org_id=current_setting('test.org_a')::uuid and email='member-by-owner@example.test' and accepted_at is null),'the owner invitation replaces the pending invitation for the same email');
select test_support.denied_with('select private.restore_owner(''owner-b@example.test'',current_setting(''test.org_a'')::uuid)','pertence a outra organização deste CRM','restore_owner does not move an account between organizations');
select test_support.denied_with('select private.restore_owner(''owner-a@example.test'',gen_random_uuid())','não existe neste CRM','restore_owner refuses an unknown organization');
select test_support.denied_with('select private.restore_owner(''  '')','Informe o e-mail da conta','restore_owner needs an email');
-- An unconfirmed account may have been created by someone else with the owner's email (any signup passes while the
-- instance has no company), with a password the Auth keeps on a new signup.
select test_support.denied_with('select private.restore_owner(''convidada@example.test'',current_setting(''test.org_a'')::uuid)','ainda não confirmou o e-mail, e o papel de Dono só vai para conta confirmada','restore_owner refuses an unconfirmed account without organization');
update auth.users set email_confirmed_at=null where id='00000000-0000-0000-0000-000000000006';
select test_support.denied_with('select private.restore_owner(''metadata@example.test'')','ainda não confirmou o e-mail','restore_owner refuses an unconfirmed account of the company');
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000006';
select test_support.assert((select org_id is null from public.profiles where id='00000000-0000-0000-0000-000000000010') and not exists(select 1 from public.user_roles where user_id='00000000-0000-0000-0000-000000000010') and (select role='viewer' from public.user_roles where user_id='00000000-0000-0000-0000-000000000006'),'a refused restore_owner leaves the unconfirmed accounts as they were');

-- 9. Empty instance (D6), undone by the final rollback: the first confirmed account creates the company and becomes
-- its owner, and then the instance is closed.
-- Without the cascade notices for each table; the PASS notices come back right after.
set local client_min_messages=warning;
truncate auth.users, public.organizations cascade;
set local client_min_messages=notice;
select test_support.assert(not exists(select 1 from public.organizations) and not exists(select 1 from public.profiles),'empty instance: no company and no account');
set local role anon;
select test_support.assert((select count(*)=1 and not bool_or(has_organization) from public.instance_status()),'empty instance: anon reads that there is no company yet');
reset role;
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000031','primeira@example.test');
insert into auth.users(id,email,email_confirmed_at) values('00000000-0000-0000-0000-000000000032','segunda@example.test',now());
select test_support.assert((select count(*)=2 from public.profiles where org_id is null),'empty instance: any signup is accepted');
select test_support.denied_with('select private.restore_owner(''segunda@example.test'')','Este CRM ainda não tem empresa. Entre com esta conta','empty instance: restore_owner points an existing account to creating the company');
select test_support.denied_with('select private.restore_owner(''primeira@example.test'')','A conta primeira@example.test ainda não confirmou o e-mail','empty instance: restore_owner refuses an unconfirmed account too');
select test_support.denied_with('select private.restore_owner(''ninguem@example.test'')','Este CRM ainda não tem empresa. Cadastre-se','empty instance: restore_owner points a missing account to the signup');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000031',true);
select test_support.denied_with('select public.create_workspace(''Primeira Empresa'')','Confirme seu e-mail antes de criar a empresa','empty instance: an unconfirmed account cannot create the company');
reset role;
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000031';
set local role authenticated;
select test_support.denied_with('select public.create_workspace('' x '')','Use um nome de empresa com 2 a 160 caracteres','empty instance: the company name is validated');
select set_config('test.first_company',public.create_workspace('  Primeira Empresa ')::text,true)::uuid;
select test_support.assert((select name='Primeira Empresa' from public.organizations where id=current_setting('test.first_company')::uuid) and private.current_org()=current_setting('test.first_company')::uuid and (select role='owner' from public.user_roles where user_id=auth.uid()),'empty instance: the first confirmed account creates the company and becomes its owner');
select test_support.assert((select count(*)=1 from public.pipelines where is_default and name='Comercial') and (select count(*)=4 from public.pipeline_stages) and (select count(*)=4 from public.risk_rules),'the company starts with the Comercial pipeline, four stages and four attention rules');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000032',true);
select test_support.denied_with('select public.create_workspace(''Segunda Empresa'')','Este CRM já tem uma empresa','an account created before the company cannot create a second one');
reset role;
select test_support.assert((select count(*)=1 from public.organizations),'the instance keeps a single company');
select test_support.denied_with('insert into auth.users(id,email) values(gen_random_uuid(),''depois@example.test'')','aceita novas contas só por convite','after the first company, a signup without invitation is refused');
set local role anon;
select test_support.assert((select bool_and(has_organization) from public.instance_status()),'after the first company, instance_status reports it');
reset role;
