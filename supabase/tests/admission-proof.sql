-- Included by commercial-security.sql, before instance-admission.sql (whose section 9 empties the instance).
-- Item 1.1 reinforcement (supabase/migrations/20261012110000_admission_email_proof.sql, design in
-- docs/arquitetura/1.1.md, section 16): the password chosen before the email is proven does not survive the
-- confirmation, and an account only gets a role (accept_invitation, create_workspace) with the proof of its current
-- email, recorded when the session opened by the emailed link is born in the transaction that confirms the account, or
-- carried by a session opened by an emailed link (amr). A confirmation without a link (the confirmation turned off in
-- the Auth) proves nothing. An account without organization cannot change its email (the proof is of the address).
-- Run through `npm run test:db`: section 6 needs the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261012110000_admission_email_proof.sql right before that migration. The two-session check
-- (no read sees the account confirmed with the old password) and the confirmation without a link in separate
-- transactions (the confirmation mark ends with the commit) run in scripts/test-database.mjs.
-- Accounts: 1 owner A, 2 owner B, 99 legacy owner; 40 invited and created first by someone else, with a password;
-- 41 invited, created and confirmed in the same request (Auto Confirm); 42 inserted already confirmed, without proof;
-- 43 confirmed by link, whose email change is refused, and then moved with the trigger off; 44 owner invitation
-- created first by someone else; 45 deleted with its proof; 46 pre-registration confirmed in the transaction that
-- creates 47; 48 pre-registration confirmed without a link (/signup with the confirmation turned off); 49 confirmed
-- with a password session in the same transaction; 50 confirmed with the link session of another account in the same
-- transaction; 51 confirmed by link with the password written again in the same transaction; 96 pre-registration from
-- before the reinforcement; 97 old confirmed account without organization.
reset role;
select test_support.sign_out();

-- 1. Schema.
select test_support.assert((select relrowsecurity from pg_class where oid='private.email_proofs'::regclass) and not exists(select 1 from pg_policies where schemaname='private' and tablename='email_proofs'),'email_proofs has RLS on and no policy');
select test_support.assert(not exists(select 1 from pg_class c cross join aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='private.email_proofs'::regclass and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
 and not exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role) where has_any_column_privilege(r.role,'private.email_proofs','select') or has_any_column_privilege(r.role,'private.email_proofs','insert') or has_any_column_privilege(r.role,'private.email_proofs','update')),'no API role, nor public, has any privilege on email_proofs');
select test_support.assert(exists(select 1 from pg_constraint where conrelid='private.email_proofs'::regclass and contype='p' and conkey=array[(select attnum from pg_attribute where attrelid='private.email_proofs'::regclass and attname='user_id')])
 and exists(select 1 from pg_constraint where conrelid='private.email_proofs'::regclass and contype='f' and confrelid='auth.users'::regclass and confdeltype='c')
 and (select attnotnull from pg_attribute where attrelid='private.email_proofs'::regclass and attname='email'),'email_proofs: one row per account, removed with the account, always with the email');
select test_support.assert(exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='discard_unproven_password' and tgfoid='private.discard_unproven_password()'::regprocedure
 and tgtype=19 and tgenabled='O'),'the confirmation trigger is an enabled BEFORE UPDATE row trigger on auth.users');
select test_support.assert(exists(select 1 from pg_trigger t where t.tgrelid='auth.users'::regclass and t.tgname='refuse_email_change_without_org' and t.tgfoid='private.refuse_email_change_without_org()'::regprocedure
 and t.tgtype=19 and t.tgenabled='O'),'the email change trigger is an enabled BEFORE UPDATE row trigger on auth.users');
select test_support.assert(exists(select 1 from pg_trigger where tgrelid='auth.mfa_amr_claims'::regclass and tgname='record_email_proof' and tgfoid='private.record_email_proof()'::regprocedure
 and tgtype=5 and tgenabled='O'),'the proof trigger is an enabled AFTER INSERT row trigger on auth.mfa_amr_claims');
-- Review of 13/10/2026: no trigger on the auth tables names a column (an UPDATE OF list or a WHEN condition), because a
-- column named in a trigger definition stops the Auth migrations from changing its type (0A000) or dropping it
-- (2BP01). The conditions live at the start of the trigger functions.
select test_support.assert(not exists(select 1 from pg_trigger t where t.tgrelid in ('auth.users'::regclass,'auth.mfa_amr_claims'::regclass) and not t.tgisinternal
  and (t.tgqual is not null or cardinality(t.tgattr::int2[])>0))
 and not exists(select 1 from pg_trigger t join pg_depend d on d.classid='pg_trigger'::regclass and d.objid=t.oid
  where t.tgrelid in ('auth.users'::regclass,'auth.mfa_amr_claims'::regclass) and not t.tgisinternal and d.refclassid='pg_class'::regclass and d.refobjsubid<>0),
 'no trigger on the auth tables names or depends on a column of them');
-- The probe of the review: what an Auth migration does to the columns the triggers read (change the type, drop the
-- column), undone right after.
do $$
declare v_state text; v_message text;
begin
 begin
  alter table auth.users alter column email type varchar(320),alter column email_change type text,
   alter column email_confirmed_at type timestamp using email_confirmed_at at time zone 'UTC';
  alter table auth.mfa_amr_claims alter column authentication_method type varchar(64);
  alter table auth.users drop column email_change;
  raise exception using errcode='CRM01',message='the Auth column changes went through';
 exception when others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
 end;
 perform test_support.assert(v_state='CRM01','the Auth can still change the type of, and drop, the columns the CRM triggers read'
  ||case when v_state is distinct from 'CRM01' then format(' (failed with %s: %s)',v_state,v_message) else '' end);
end $$;
select test_support.assert((select count(*)=7 and bool_and(p.prosecdef=expected.definer and p.proconfig @> array['search_path=""']) from (values
 ('private.discard_unproven_password()',true),
 ('private.record_email_proof()',true),
 ('private.refuse_email_change_without_org()',true),
 ('private.email_proven()',false),
 ('private.enforce_invite_only_signup()',true),
 ('private.create_workspace(text)',true),
 ('private.accept_invitation(uuid)',true)
) expected(signature,definer) join pg_proc p on p.oid=expected.signature::regprocedure),'the proof functions are SECURITY DEFINER or INVOKER as designed, all with an empty search_path');
select test_support.assert(not exists(select 1 from (values ('private.discard_unproven_password()'),('private.record_email_proof()'),('private.refuse_email_change_without_org()'),('private.email_proven()')) f(signature) cross join (values ('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(r.role,f.signature,'execute')),'no API role executes the trigger functions or the proof check');
set local role authenticated;
select test_support.privilege_denied('select count(*) from private.email_proofs','authenticated cannot read the proofs');
select test_support.privilege_denied('select private.email_proven()','authenticated cannot call the proof check directly');
reset role;

-- 2. The password chosen before the proof of the email is discarded on the confirmation, and the proof is recorded
-- only with the link session born in the same transaction.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select set_config('test.invite_pre',public.create_invitation('Pre-Cadastro-A@Example.test','member')::text,true)::uuid;
select set_config('test.invite_auto',public.create_invitation('auto-confirmada@example.test','member')::text,true)::uuid;
select set_config('test.invite_no_proof',public.create_invitation('sem-prova@example.test','viewer')::text,true)::uuid;
select set_config('test.invite_moved',public.create_invitation('troca-b@example.test','member')::text,true)::uuid;
select set_config('test.invite_future_owner',public.create_invitation('dona-futura@example.test','owner')::text,true)::uuid;
select set_config('test.invite_mark_y',public.create_invitation('marca-y@example.test','member')::text,true)::uuid;
select set_config('test.invite_mark_x',public.create_invitation('marca-x@example.test','member')::text,true)::uuid;
select set_config('test.invite_without_link',public.create_invitation('sem-link@example.test','member')::text,true)::uuid;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select set_config('test.invite_no_proof_used',public.create_invitation('sem-prova@example.test','member')::text,true)::uuid;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
select set_config('test.invite_no_proof_expired',public.create_invitation('sem-prova@example.test','member')::text,true)::uuid;
reset role;
select test_support.sign_out();
update public.invitations set accepted_at=now() where id=current_setting('test.invite_no_proof_used')::uuid;
update public.invitations set expires_at=now()-interval '1 minute' where id=current_setting('test.invite_no_proof_expired')::uuid;
-- Someone who knows the invited email creates the account first, with a password of their own: the signup gate lets
-- it pass, and a new signup by the invited person would only resend the confirmation.
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000040',' PRE-cadastro-a@example.test ','$2a$10$senha.do.intruso');
select test_support.assert((select email_confirmed_at is null and encrypted_password='$2a$10$senha.do.intruso' from auth.users where id='00000000-0000-0000-0000-000000000040') and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000040'),'a pre-registered account keeps the password of whoever created it until the email is confirmed');
select test_support.confirm_by_link('00000000-0000-0000-0000-000000000040');
select test_support.assert((select email_confirmed_at is not null and encrypted_password='' from auth.users where id='00000000-0000-0000-0000-000000000040'),'the confirmation by link discards the password chosen before the email was proven');
select test_support.assert((select email='pre-cadastro-a@example.test' and proven_at=now() from private.email_proofs where user_id='00000000-0000-0000-0000-000000000040'),'the confirmation by link records the proof with the confirmed email, in lowercase and without spaces');
select test_support.assert((select count(*)=1 from auth.sessions s join auth.mfa_amr_claims c on c.session_id=s.id where s.user_id='00000000-0000-0000-0000-000000000040' and c.authentication_method='otp'),'the test confirmation by link writes the link session as the Auth does, in the same transaction');
-- Created and confirmed in the same request (Auto Confirm in the dashboard, confirmation turned off in the Auth): no
-- link was opened, so there is neither a proof nor a stranger's password to discard.
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000041','auto-confirmada@example.test','$2a$10$senha.do.painel');
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000041';
select test_support.assert((select email_confirmed_at is not null and encrypted_password='$2a$10$senha.do.painel' from auth.users where id='00000000-0000-0000-0000-000000000041') and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000041'),'confirmed in the request that created it, an account keeps its password and gets no proof');
insert into auth.users(id,email,email_confirmed_at,encrypted_password) values('00000000-0000-0000-0000-000000000042','sem-prova@example.test',now(),'$2a$10$senha.conhecida');
select test_support.assert((select encrypted_password='$2a$10$senha.conhecida' from auth.users where id='00000000-0000-0000-0000-000000000042') and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000042'),'an account inserted already confirmed gets no proof');
update auth.users set raw_user_meta_data='{"name":"Outro nome"}' where id='00000000-0000-0000-0000-000000000042';
update auth.users set email_confirmed_at=now()-interval '1 minute' where id='00000000-0000-0000-0000-000000000042';
select test_support.assert((select encrypted_password='$2a$10$senha.conhecida' from auth.users where id='00000000-0000-0000-0000-000000000042') and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000042'),'other updates, and a confirmation that was already there, neither discard the password nor record a proof');
-- The creation mark spares only the account the gate has just let in: a pre-registration confirmed in the same
-- transaction that creates another account still loses its password and, with the link session of the same
-- transaction, gets the proof (step by step here, without confirm_by_link).
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000046','marca-y@example.test','$2a$10$senha.do.pre.cadastro');
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000047','marca-x@example.test','$2a$10$senha.da.conta.nova');
select test_support.assert(current_setting('crm.auth_user_created',true)='00000000-0000-0000-0000-000000000047','the signup gate marks the account it has just let in');
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000046';
select test_support.assert(current_setting('crm.auth_user_confirmed',true)='00000000-0000-0000-0000-000000000046' and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000046'),'the confirmation marks the account it confirmed and records no proof by itself');
select test_support.open_session('00000000-0000-0000-0000-000000000046','otp');
select test_support.assert((select email_confirmed_at is not null and encrypted_password='' from auth.users where id='00000000-0000-0000-0000-000000000046') and exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000046' and email='marca-y@example.test'),'the creation mark of another account does not spare a pre-registration confirmed in the same transaction');
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000047';
select test_support.assert((select encrypted_password='$2a$10$senha.da.conta.nova' from auth.users where id='00000000-0000-0000-0000-000000000047') and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000047'),'the account named by the mark is the one confirmed without a link');
select test_support.end_request();
-- Confirmed without a link (round 2 review): with the confirmation turned off in the Auth, /signup (or /otp) with the
-- email of an account that already exists unconfirmed confirms it in a transaction without INSERT and hands a password
-- session to whoever made the request, without checking any password (api/signup.go 191-237 and 306-315). The
-- password is discarded, but nothing proves the email: no session is born in the confirmation transaction, and the one
-- of the request comes in another transaction, by password.
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000048','sem-link@example.test','$2a$10$senha.do.intruso');
select test_support.confirm_without_link('00000000-0000-0000-0000-000000000048');
select test_support.assert((select email_confirmed_at is not null and encrypted_password='' from auth.users where id='00000000-0000-0000-0000-000000000048') and not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000048'),'confirmed without a link (/signup with the confirmation turned off), an existing account loses its password and gets no proof');
-- A link session born in a later request (the magic link that /otp sends after confirming without a link) does not
-- record the proof either: the confirmation mark ended with the request that confirmed.
select test_support.open_session('00000000-0000-0000-0000-000000000048','otp');
select test_support.assert(not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000048'),'a link session born after the confirmation request records no proof');
-- Review of 13/10/2026: the proof also needs the account without a password. A password written again after the
-- confirmation, in the same transaction (an Auth version that wrote back the password it holds in memory), would be
-- the one of whoever pre-registered the account, and the proof would let that password session in.
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000051','senha-regravada@example.test','$2a$10$senha.do.intruso');
alter table auth.users enable trigger enforce_invite_only_signup;
select test_support.end_request();
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000051';
update auth.users set encrypted_password='$2a$10$senha.do.intruso' where id='00000000-0000-0000-0000-000000000051';
select test_support.open_session('00000000-0000-0000-0000-000000000051','otp');
select test_support.end_request();
select test_support.assert(not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000051'),'a password written again after the confirmation, in the same transaction, keeps the link session from recording the proof');
-- In the confirmation transaction, only a link session of the confirmed account records the proof.
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,encrypted_password) values
 ('00000000-0000-0000-0000-000000000049','metodo-senha@example.test','$2a$10$senha.do.metodo'),
 ('00000000-0000-0000-0000-000000000050','sessao-alheia@example.test','$2a$10$senha.da.sessao');
alter table auth.users enable trigger enforce_invite_only_signup;
select test_support.end_request();
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000049';
select test_support.open_session('00000000-0000-0000-0000-000000000049','password');
select test_support.end_request();
select test_support.assert(not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000049'),'a password session born in the confirmation transaction records no proof');
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000050';
select test_support.open_session('00000000-0000-0000-0000-000000000042','otp');
select test_support.end_request();
select test_support.assert(not exists(select 1 from private.email_proofs where user_id in ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000042')),'the link session of another account in the confirmation transaction records no proof');
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,encrypted_password) values
 ('00000000-0000-0000-0000-000000000043','troca-a@example.test','$2a$10$senha.da.troca'),
 ('00000000-0000-0000-0000-000000000045','excluida@example.test','$2a$10$senha.da.excluida');
alter table auth.users enable trigger enforce_invite_only_signup;
select test_support.confirm_by_link('00000000-0000-0000-0000-000000000043');
select test_support.confirm_by_link('00000000-0000-0000-0000-000000000045');
delete from auth.users where id='00000000-0000-0000-0000-000000000045';
select test_support.assert(not exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000045') and exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000043'),'deleting an account deletes its proof');

-- 3. email_proven(), as the account of the session (called by the database owner: no API role executes it).
select test_support.sign_in('00000000-0000-0000-0000-000000000042','password');
select test_support.assert(not private.email_proven(),'email_proven: a password session of an account without proof does not prove the email');
do $$
declare method text;
begin
 foreach method in array array['otp','magiclink','email/signup','invite','recovery'] loop
  perform test_support.sign_in('00000000-0000-0000-0000-000000000042',method);
  perform test_support.assert(private.email_proven(),'email_proven: a session opened by an emailed link ('||method||') proves the email');
 end loop;
 -- email_change does not count: with the secure email change, the session goes to whoever opens the last of the two
 -- links, which may be the one sent to the previous address.
 foreach method in array array['email_change','password','totp','token_refresh','anonymous','oauth','sso/saml'] loop
  perform test_support.sign_in('00000000-0000-0000-0000-000000000042',method);
  perform test_support.assert(not private.email_proven(),'email_proven: a '||method||' session does not prove the email');
 end loop;
end $$;
select test_support.sign_in('00000000-0000-0000-0000-000000000042',null);
select test_support.assert(not private.email_proven(),'email_proven: a token without amr does not prove the email');
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000000042','amr','otp')::text,true);
select test_support.assert(not private.email_proven(),'email_proven: an amr that is not a list does not prove the email');
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-0000-0000-000000000042','amr',jsonb_build_array('otp'))::text,true);
select test_support.assert(not private.email_proven(),'email_proven: an amr without method objects does not prove the email');
-- The link session of another account, left in the transaction while request.jwt.claim.sub switches accounts.
select test_support.sign_in('00000000-0000-0000-0000-000000000041','otp');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000042',true);
select test_support.assert(not private.email_proven(),'email_proven: the amr of a token whose sub is another account does not count');
select test_support.sign_in('00000000-0000-0000-0000-000000000040','password');
select test_support.assert(private.email_proven(),'email_proven: the proof recorded on the confirmation by link holds in a password session');

-- 4. accept_invitation: the proof is the last refusal.
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000042','password');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_pre')),'Este convite é para outro e-mail','without the proof, an invitation for another email is still refused as such');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_no_proof_used')),'Este convite já foi usado','without the proof, a used invitation is still refused as used');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_no_proof_expired')),'Este convite expirou','without the proof, an expired invitation is still refused as expired');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_no_proof')),'Para aceitar o convite, confirme que o e-mail é seu: entre pelo link enviado a ele.','a password session without the proof of the email cannot accept');
select test_support.assert(private.current_org() is null,'the refusal for lack of proof leaves the account without organization');
select test_support.sign_in('00000000-0000-0000-0000-000000000042','otp');
select test_support.assert(public.accept_invitation(current_setting('test.invite_no_proof')::uuid)=current_setting('test.org_a')::uuid,'a session opened by the emailed link accepts the invitation');
select test_support.assert((select role='viewer' from public.user_roles where user_id=auth.uid()),'the invitation accepted in the link session gives its role');
select test_support.sign_in('00000000-0000-0000-0000-000000000041','password');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_auto')),'confirme que o e-mail é seu','an account confirmed without a link (Auto Confirm) cannot accept with its password');
select test_support.sign_in('00000000-0000-0000-0000-000000000041','otp');
select test_support.assert(public.accept_invitation(current_setting('test.invite_auto')::uuid)=current_setting('test.org_a')::uuid,'the same account accepts after entering by the emailed link');
-- The probe of the round 2 review: the session that /signup hands out when it confirms without a link.
select test_support.sign_in('00000000-0000-0000-0000-000000000048','password');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_without_link')),'Para aceitar o convite, confirme que o e-mail é seu','the password session handed out by /signup with the confirmation turned off cannot accept the invitation');
select test_support.sign_in('00000000-0000-0000-0000-000000000048','otp');
select test_support.assert(public.accept_invitation(current_setting('test.invite_without_link')::uuid)=current_setting('test.org_a')::uuid,'the invited person accepts in the session opened by the emailed link');
select test_support.sign_in('00000000-0000-0000-0000-000000000040','password');
select test_support.assert(public.accept_invitation(current_setting('test.invite_pre')::uuid)=current_setting('test.org_a')::uuid,'an account with the recorded proof accepts in a password session');
-- An account without organization does not change its email: neither the request (the Auth writes email_change after
-- sending the two emails) nor its completion (email). Otherwise an account created by someone else, with their
-- password and the proof of their own address, would move to the email of a pending invitation, and the session of
-- the last link of the secure change (amr otp) would accept it.
reset role;
select test_support.denied_with('update auth.users set email_change=''troca-b@example.test'' where id=''00000000-0000-0000-0000-000000000043''','Troca de e-mail recusada','an account without organization cannot ask to change its email');
-- A request left from before the migration (written here with the trigger off) cannot be completed, only cleared.
alter table auth.users disable trigger refuse_email_change_without_org;
update auth.users set email_change='troca-b@example.test' where id='00000000-0000-0000-0000-000000000043';
alter table auth.users enable trigger refuse_email_change_without_org;
select test_support.denied_with('update auth.users set email=''troca-b@example.test'',email_change='''' where id=''00000000-0000-0000-0000-000000000043''','Troca de e-mail recusada','an account without organization cannot complete an email change');
update auth.users set email=email,email_change='' where id='00000000-0000-0000-0000-000000000043';
select test_support.assert((select email='troca-a@example.test' and email_change='' from auth.users where id='00000000-0000-0000-0000-000000000043'),'an update that keeps the email and clears email_change is not refused, and the refused change left the email as it was');
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000043','otp');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_moved')),'Este convite é para outro e-mail','a link session of the account whose change was refused cannot accept the invitation of the other email');
-- A member changes the email (nothing to gain: the admission refuses an account that already belongs to a company).
reset role;
update auth.users set email_change='pre-cadastro-a.novo@example.test' where id='00000000-0000-0000-0000-000000000040';
update auth.users set email='pre-cadastro-a.novo@example.test',email_change='' where id='00000000-0000-0000-0000-000000000040';
select test_support.assert((select email='pre-cadastro-a.novo@example.test' from auth.users where id='00000000-0000-0000-0000-000000000040'),'an account with organization still changes its email');
-- Defense in depth: the proof keeps the confirmed email, so a change that escapes the trigger (here, turned off) still
-- needs a new link.
alter table auth.users disable trigger refuse_email_change_without_org;
update auth.users set email='troca-b@example.test' where id='00000000-0000-0000-0000-000000000043';
alter table auth.users enable trigger refuse_email_change_without_org;
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000043','password');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_moved')),'confirme que o e-mail é seu','a change of email voids the proof of the previous email');
reset role;
update private.email_proofs set proven_at=now()-interval '3 days' where user_id='00000000-0000-0000-0000-000000000043';
update auth.users set email_confirmed_at=null where id='00000000-0000-0000-0000-000000000043';
select test_support.confirm_by_link('00000000-0000-0000-0000-000000000043');
select test_support.assert((select email='troca-b@example.test' and proven_at=now() from private.email_proofs where user_id='00000000-0000-0000-0000-000000000043'),'a new confirmation by link updates the proof with the current email');
set local role authenticated;
select test_support.assert(public.accept_invitation(current_setting('test.invite_moved')::uuid)=current_setting('test.org_a')::uuid,'with the proof of the current email, the password session accepts again');

-- 5. Owner invitation created first by someone who knows the email (an administrator, before the owner invitation was
-- hidden from them): the confirmation takes the password away, and only the link session gets the owner role.
reset role;
insert into auth.users(id,email,encrypted_password) values('00000000-0000-0000-0000-000000000044','dona-futura@example.test','$2a$10$senha.de.quem.sabia.o.email');
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000044','password');
select test_support.denied_with(format('select public.accept_invitation(%L)',current_setting('test.invite_future_owner')),'Confirme seu e-mail antes de aceitar o convite','before the confirmation, the pre-registered account cannot accept the owner invitation');
reset role;
select test_support.confirm_by_link('00000000-0000-0000-0000-000000000044');
select test_support.assert((select encrypted_password='' from auth.users where id='00000000-0000-0000-0000-000000000044'),'the confirmation removes the password of whoever pre-registered the owner invitation');
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000044','otp');
select test_support.assert(public.accept_invitation(current_setting('test.invite_future_owner')::uuid)=current_setting('test.org_a')::uuid,'the invited owner accepts in the session opened by the link');
select test_support.assert((select role='owner' from public.user_roles where user_id=auth.uid()),'the owner invitation accepted with the proof gives the owner role');
reset role;

-- 6. Instance in use before the migration (supabase/tests/upgrade/20261012110000_admission_email_proof.sql).
select test_support.sign_out();
select test_support.assert((select encrypted_password='$2a$10$senha.escolhida.pelo.intruso' and email_confirmed_at is null from auth.users where id='00000000-0000-0000-0000-000000000096')
 and (select encrypted_password='$2a$10$senha.da.conta.antiga' from auth.users where id='00000000-0000-0000-0000-000000000097')
 and not exists(select 1 from private.email_proofs where user_id in ('00000000-0000-0000-0000-000000000096','00000000-0000-0000-0000-000000000097')),'upgrade: the migration rewrites no password and records no proof');
select test_support.confirm_by_link('00000000-0000-0000-0000-000000000096');
select test_support.assert((select encrypted_password='' from auth.users where id='00000000-0000-0000-0000-000000000096') and exists(select 1 from private.email_proofs where user_id='00000000-0000-0000-0000-000000000096' and email='pre-cadastro@example.test'),'upgrade: confirming an old pre-registration by link discards its password and records the proof');
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000096','password');
select test_support.assert(public.accept_invitation('94000000-0000-0000-0000-000000000004')='90000000-0000-0000-0000-000000000001','upgrade: after the confirmation by link, the old invitation is accepted');
select test_support.sign_in('00000000-0000-0000-0000-000000000097','password');
select test_support.denied_with('select public.accept_invitation(''94000000-0000-0000-0000-000000000005'')','Para aceitar o convite, confirme que o e-mail é seu','upgrade: an account confirmed before the reinforcement has no proof, and its password session cannot accept');
select test_support.sign_in('00000000-0000-0000-0000-000000000097','otp');
select test_support.assert(public.accept_invitation('94000000-0000-0000-0000-000000000005')='90000000-0000-0000-0000-000000000001','upgrade: the old account accepts in a session opened by the emailed link');
reset role;
select test_support.sign_out();
