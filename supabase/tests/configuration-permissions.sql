-- Included inside commercial-security.sql's rollback transaction after its baseline checks.
-- A second same-tenant collaborator becomes admin; the metadata-only account becomes viewer.
select set_config('request.jwt.claim.sub','',true);
update public.profiles set org_id=current_setting('test.org_a')::uuid where id='00000000-0000-0000-0000-000000000006';
insert into public.user_roles(user_id,org_id,role) values('00000000-0000-0000-0000-000000000006',current_setting('test.org_a')::uuid,'viewer');
create function test_support.privilege_denied(statement text,message text) returns void language plpgsql security invoker as $$
begin
 begin execute statement; exception when insufficient_privilege then raise notice 'PASS: %',message; return; end;
 raise exception 'FAIL: expected permission rejection: %',message;
end $$;
grant execute on function test_support.privilege_denied(text,text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.set_member_role('00000000-0000-0000-0000-000000000004','admin');
-- Free the constrained rule type so the matrix exercises a valid INSERT.
delete from public.risk_rules where type='stale_deal';
do $$
declare
 config record; actor record; row_count integer; affected integer; record_id uuid; insert_sql text; update_sql text;
 org_a uuid := current_setting('test.org_a')::uuid;
 owner_id uuid := '00000000-0000-0000-0000-000000000001';
 admin_id uuid := '00000000-0000-0000-0000-000000000004';
begin
 for config in select * from (values
  ('automations','name,trigger_type,task_title','''Policy test'',''deal_created'',''Prepare task''','name=name'),
  ('integration_configs','provider','''csv''','enabled=not enabled'),
  ('pipeline_stages','pipeline_id,name',quote_literal(current_setting('test.pipeline_a'))||',''Policy stage''','name=name'),
  ('pipelines','name','''Policy pipeline''','name=name'),
  ('risk_rules','name,type','''Policy rule'',''stale_deal''','enabled=not enabled')
 ) as cases(table_name,columns,values_sql,update_sql) loop
  record_id := gen_random_uuid();
  insert_sql := format('insert into public.%I(id,org_id,%s) values(%L,%L,%s)',config.table_name,config.columns,record_id,org_a,config.values_sql);
  update_sql := format('update public.%I set %s where id=%L',config.table_name,config.update_sql,record_id);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  execute insert_sql;
  get diagnostics affected = row_count;
  perform test_support.assert(affected=1,config.table_name||': owner can insert');
  execute update_sql; get diagnostics affected = row_count;
  perform test_support.assert(affected=1,config.table_name||': owner can update');
  for actor in select * from (values
   ('member','00000000-0000-0000-0000-000000000003'::uuid,1),
   ('viewer','00000000-0000-0000-0000-000000000006'::uuid,1),
   ('other-tenant owner','00000000-0000-0000-0000-000000000002'::uuid,0)
  ) as actors(label,user_id,visible_rows) loop
   perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
   execute format('select count(*) from public.%I where id=%L',config.table_name,record_id) into row_count;
   perform test_support.assert(row_count=actor.visible_rows,config.table_name||': '||actor.label||' reads only permitted tenant');
   -- Same PK would produce a unique violation if INSERT RLS were accidentally permissive.
   perform test_support.privilege_denied(insert_sql,config.table_name||': '||actor.label||' cannot insert configuration');
   execute update_sql; get diagnostics affected = row_count;
   perform test_support.assert(affected=0,config.table_name||': '||actor.label||' cannot update configuration');
   execute format('delete from public.%I where id=%L',config.table_name,record_id);
   get diagnostics affected = row_count;
   perform test_support.assert(affected=0,config.table_name||': '||actor.label||' cannot delete configuration');
  end loop;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  execute update_sql; get diagnostics affected = row_count;
  perform test_support.assert(affected=1,config.table_name||': admin can update');
  execute format('delete from public.%I where id=%L',config.table_name,record_id);
  get diagnostics affected = row_count;
  perform test_support.assert(affected=1,config.table_name||': admin can delete');
 end loop;
end $$;
-- Invitations (item 1.1): created only through public.create_invitation, without direct INSERT for anyone, never
-- updated through the API and read only by owners and administrators. instance-admission.sql covers the RPC rules.
do $$
declare
 actor record; row_count integer; affected integer; record_id uuid;
 org_a uuid := current_setting('test.org_a')::uuid;
 owner_id uuid := '00000000-0000-0000-0000-000000000001';
 admin_id uuid := '00000000-0000-0000-0000-000000000004';
begin
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 record_id := public.create_invitation('policy-test@example.test','member');
 perform test_support.assert((select count(*)=1 from public.invitations where id=record_id),'invitations: owner creates through create_invitation and reads it');
 perform test_support.privilege_denied(format('insert into public.invitations(org_id,email,role) values(%L,''direct@example.test'',''member'')',org_a),'invitations: owner cannot insert directly');
 perform test_support.privilege_denied(format('insert into public.invitations(org_id,email,accepted_at) values(%L,''forged@example.test'',now())',org_a),'invitations: owner cannot supply accepted_at on insert');
 perform test_support.privilege_denied(format('update public.invitations set role=''viewer'' where id=%L',record_id),'invitations: owner still cannot update acceptance or other columns');
 for actor in select * from (values
  ('member','00000000-0000-0000-0000-000000000003'::uuid),
  ('viewer','00000000-0000-0000-0000-000000000006'::uuid),
  ('other-tenant owner','00000000-0000-0000-0000-000000000002'::uuid)
 ) as actors(label,user_id) loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  execute format('select count(*) from public.invitations where id=%L',record_id) into row_count;
  perform test_support.assert(row_count=0,'invitations: '||actor.label||' reads no invitation of organization A');
  perform test_support.privilege_denied(format('insert into public.invitations(org_id,email,role) values(%L,''direct@example.test'',''member'')',org_a),'invitations: '||actor.label||' cannot insert directly');
  perform test_support.privilege_denied(format('update public.invitations set role=''viewer'' where id=%L',record_id),'invitations: '||actor.label||' cannot update');
  execute format('delete from public.invitations where id=%L',record_id);
  get diagnostics affected = row_count;
  perform test_support.assert(affected=0,'invitations: '||actor.label||' cannot revoke');
 end loop;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform test_support.assert((select count(*)=1 from public.invitations where id=record_id),'invitations: admin reads the organization invitations');
 perform test_support.privilege_denied(format('update public.invitations set role=''viewer'' where id=%L',record_id),'invitations: admin still cannot update');
 delete from public.invitations where id=record_id;
 get diagnostics affected = row_count;
 perform test_support.assert(affected=1,'invitations: admin can revoke');
end $$;
reset role;
select test_support.assert(not exists(
 select tablename from pg_policies
 where schemaname='public' and tablename=any(array['automations','integration_configs','invitations','pipeline_stages','pipelines','risk_rules'])
 and permissive='PERMISSIVE' and 'authenticated'=any(roles) and cmd in ('SELECT','ALL')
 group by tablename having count(*)>1
),'configuration reads have one permissive policy per table');
