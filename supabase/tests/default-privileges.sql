-- Included by commercial-security.sql, after customization.sql and before instance-admission.sql (whose section 9
-- empties the instance), inside a savepoint that is rolled back at the end: the objects created here do not reach the
-- checks that follow it.
-- Item 1.8: default privileges revoked (supabase/migrations/20261019120000_default_privileges.sql, design in
-- docs/arquitetura/1.8.md, section 6). Whatever postgres (the role that applies the migrations) creates from now on is
-- born without any privilege for anon, authenticated and service_role, and a new function in any schema is born without
-- EXECUTE for PUBLIC: a table, view, sequence or function forgotten without grant answers 42501 through the API. With an
-- explicit grant, RLS and policies, the same table works as expected. The service_role has select, insert, update and
-- delete on the tables of the base (and nothing else), and no EXECUTE on the RPCs of public. The convergence of three
-- databases created with different default privileges runs in scripts/test-database.mjs
-- (defaultPrivilegeConvergenceChecks).
reset role;
select test_support.sign_out();
savepoint default_privileges;
grant usage on schema test_support to anon, service_role;
grant execute on function test_support.assert(boolean,text),test_support.denied_with(text,text,text) to anon, service_role;

-- 1. Objects created by postgres without any grant, as someone personalizing the instance could forget.
create table public.zz_sem_grant(id uuid primary key default gen_random_uuid(), org_id uuid not null, nota text);
create view public.zz_sem_grant_view as select id, nota from public.zz_sem_grant;
create sequence public.zz_sem_grant_seq;
create function public.zz_definer() returns integer language sql security definer set search_path='' as 'select 1';
create function private.zz_fn() returns integer language sql security invoker set search_path='' as 'select 1';
select test_support.assert(not exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role)
 where has_table_privilege(r.role,'public.zz_sem_grant','select,insert,update,delete,truncate,references,trigger')
  or has_table_privilege(r.role,'public.zz_sem_grant_view','select,insert,update,delete,truncate,references,trigger')
  or has_sequence_privilege(r.role,'public.zz_sem_grant_seq','usage,select,update')
  or has_function_privilege(r.role,'public.zz_definer()','execute')
  or has_function_privilege(r.role,'private.zz_fn()','execute')),
 'default privileges: a table, a view, a sequence and functions created without grant give no privilege to anon, authenticated or service_role');
select test_support.assert(not has_function_privilege('public','public.zz_definer()','execute')
 and not has_function_privilege('public','private.zz_fn()','execute'),
 'default privileges: a new function in public or private is born without EXECUTE for PUBLIC (the global default)');

-- 2. Through the API: 42501 for each role, on select, insert, truncate, the view, nextval and the functions.
set local role anon;
select test_support.denied_with('select * from public.zz_sem_grant','permission denied','default privileges: anon cannot select a table without grant');
select test_support.denied_with('insert into public.zz_sem_grant(org_id) values(gen_random_uuid())','permission denied','default privileges: anon cannot insert into a table without grant');
select test_support.denied_with('truncate public.zz_sem_grant','permission denied','default privileges: anon cannot truncate a table without grant');
select test_support.denied_with('select * from public.zz_sem_grant_view','permission denied','default privileges: anon cannot read a view without grant');
select test_support.denied_with('select nextval(''public.zz_sem_grant_seq'')','permission denied','default privileges: anon cannot use a sequence without grant');
select test_support.denied_with('select public.zz_definer()','permission denied','default privileges: anon cannot run a SECURITY DEFINER function without grant');
select test_support.denied_with('select private.zz_fn()','permission denied','default privileges: anon cannot run a new function of private');
reset role;
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
select test_support.denied_with('select * from public.zz_sem_grant','permission denied','default privileges: authenticated cannot select a table without grant');
select test_support.denied_with('insert into public.zz_sem_grant(org_id) values(private.current_org())','permission denied','default privileges: authenticated cannot insert into a table without grant');
select test_support.denied_with('truncate public.zz_sem_grant','permission denied','default privileges: authenticated cannot truncate a table without grant');
select test_support.denied_with('select * from public.zz_sem_grant_view','permission denied','default privileges: authenticated cannot read a view without grant');
select test_support.denied_with('select nextval(''public.zz_sem_grant_seq'')','permission denied','default privileges: authenticated cannot use a sequence without grant');
select test_support.denied_with('select public.zz_definer()','permission denied','default privileges: authenticated cannot run a SECURITY DEFINER function without grant');
select test_support.denied_with('select private.zz_fn()','permission denied','default privileges: authenticated cannot run a new function of private');
select test_support.sign_out();
reset role;
set local role service_role;
select test_support.denied_with('select * from public.zz_sem_grant','permission denied','default privileges: service_role cannot select a table without grant');
select test_support.denied_with('insert into public.zz_sem_grant(org_id) values(gen_random_uuid())','permission denied','default privileges: service_role cannot insert into a table without grant');
select test_support.denied_with('truncate public.zz_sem_grant','permission denied','default privileges: service_role cannot truncate a table without grant');
select test_support.denied_with('select * from public.zz_sem_grant_view','permission denied','default privileges: service_role cannot read a view without grant');
select test_support.denied_with('select nextval(''public.zz_sem_grant_seq'')','permission denied','default privileges: service_role cannot use a sequence without grant');
select test_support.denied_with('select public.zz_definer()','permission denied','default privileges: service_role cannot run a SECURITY DEFINER function without grant');
reset role;

-- 3. With the explicit grant, RLS and the policies by organization, the same table works: the account reads and writes
-- its organization only. A new trigger function needs no grant (EXECUTE is checked when the trigger is created, by the
-- owner of the table).
alter table public.zz_sem_grant enable row level security;
grant select, insert on public.zz_sem_grant to authenticated;
create policy zz_sem_grant_read on public.zz_sem_grant for select to authenticated using (org_id=(select private.current_org()));
create policy zz_sem_grant_insert on public.zz_sem_grant for insert to authenticated
 with check (org_id=(select private.current_org()) and (select private.can_write()));
create function private.zz_stamp() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.nota:=coalesce(new.nota,'carimbada'); return new; end $$;
create trigger zz_stamp before insert on public.zz_sem_grant for each row execute function private.zz_stamp();
insert into public.zz_sem_grant(org_id,nota) values(current_setting('test.org_a')::uuid,'da A'),(gen_random_uuid(),'de outra empresa');
set local role authenticated;
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
insert into public.zz_sem_grant(org_id) values(private.current_org());
select test_support.assert((select count(*)=2 and count(*) filter (where nota='carimbada')=1 from public.zz_sem_grant),
 'default privileges: with grant, RLS and policies the account reads and writes only its organization, and the new trigger function runs without grant');
select test_support.denied_with('insert into public.zz_sem_grant(org_id) values(gen_random_uuid())','row-level security',
 'default privileges: with grant and RLS, a row of another organization is still refused');
select test_support.sign_out();
reset role;

-- 4. The nine default_acl lines of the fingerprint are empty, and the service_role has exactly select, insert, update
-- and delete on the tables of the base (RLS on, outside the objects of this file) and no EXECUTE on the functions of
-- public (read from the catalog, without copying names).
select test_support.assert((select count(*)=9 and bool_and(props->>'acl'='') from private.base_fingerprints() where kind='default_acl'),
 'default privileges: the nine default_acl lines of the fingerprint have no privilege for the API roles');
select test_support.assert((select count(*)>=23 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname not like 'zz\_%')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname not like 'zz\_%'
   and (not has_table_privilege('service_role',c.oid,'select') or not has_table_privilege('service_role',c.oid,'insert')
    or not has_table_privilege('service_role',c.oid,'update') or not has_table_privilege('service_role',c.oid,'delete')
    or has_table_privilege('service_role',c.oid,'truncate,references,trigger'))),
 'default privileges: the service_role has select, insert, update and delete on the tables of the base, without truncate, references and trigger');
select test_support.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and has_function_privilege('service_role',p.oid,'execute')),
 'default privileges: the service_role runs no function of public (17 RPCs call private, where it has no USAGE; search_crm worked by it and stops)');
select test_support.assert(has_function_privilege('anon','public.instance_status()','execute')
 and has_function_privilege('authenticated','public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)','execute'),
 'default privileges: the existing RPCs keep their grants for anon and authenticated');
rollback to savepoint default_privileges;
