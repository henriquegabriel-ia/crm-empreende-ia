-- Included by commercial-security.sql, after reminders.sql and before instance-admission.sql (whose section 9 empties
-- the instance), inside a savepoint that is rolled back at the end: the accounts and records of this file do not reach
-- the checks that follow it.
-- Item 1.16: product and service catalog with items on the opportunity (supabase/migrations/20261019100000_product_catalog.sql,
-- design in docs/arquitetura/1.16.md). The catalog (products) is read by everyone and written by owners and
-- administrators; the items (deal_items) are written only by save_deal, in one transaction with the opportunity; the
-- line total is a generated column; with items, deals.value is the contract value (one-time total + monthly × months)
-- and only the RPC changes the parts. The item name is free text: it enters the anonymization and the export.
-- Run through `npm run test:db`: section 8 needs the legacy rows that the runner writes from
-- supabase/tests/upgrade/20261019100000_product_catalog.sql right before that migration. The parity of the line totals
-- with the screen (src/lib/deal-item-cases.json) and the race between two sessions saving the same opportunity run in
-- scripts/test-database.mjs (dealItemParity and dealItemsRace).
-- now() is fixed for the whole transaction: every write below happens at that same instant, so the version of a deal
-- does not change between two saves here; a stale version is written by hand when a check needs one.
-- Accounts (organization A): 1 owner A, 161 administrator, 162 collaborator, 163 viewer, 164 collaborator deactivated;
-- 2 owner B; 99 legacy owner.
reset role;
select test_support.sign_out();
savepoint product_catalog;
-- Only the automation created here runs while deals are created in this file.
update public.automations set is_active=false where org_id=current_setting('test.org_a')::uuid;
insert into public.automations(org_id,name,trigger_type,task_title,is_active,due_days) values
 (current_setting('test.org_a')::uuid,'Catálogo: primeira ação','deal_created','Catálogo: primeira ação',true,1);
alter table auth.users disable trigger enforce_invite_only_signup;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000161','admin-catalogo@example.test',now()),
 ('00000000-0000-0000-0000-000000000162','colaboracao-catalogo@example.test',now()),
 ('00000000-0000-0000-0000-000000000163','leitura-catalogo@example.test',now()),
 ('00000000-0000-0000-0000-000000000164','desativada-catalogo@example.test',now());
alter table auth.users enable trigger enforce_invite_only_signup;
update public.profiles p set org_id=current_setting('test.org_a')::uuid,name=v.name from (values
 ('00000000-0000-0000-0000-000000000161'::uuid,'Administração do Catálogo'),
 ('00000000-0000-0000-0000-000000000162'::uuid,'Colaboração do Catálogo'),
 ('00000000-0000-0000-0000-000000000163'::uuid,'Leitura do Catálogo'),
 ('00000000-0000-0000-0000-000000000164'::uuid,'Desativada do Catálogo')
) v(id,name) where p.id=v.id;
insert into public.user_roles(user_id,org_id,role,deactivated_at) values
 ('00000000-0000-0000-0000-000000000161',current_setting('test.org_a')::uuid,'admin',null),
 ('00000000-0000-0000-0000-000000000162',current_setting('test.org_a')::uuid,'member',null),
 ('00000000-0000-0000-0000-000000000163',current_setting('test.org_a')::uuid,'viewer',null),
 ('00000000-0000-0000-0000-000000000164',current_setting('test.org_a')::uuid,'member',now());
-- One item of the list sent to save_deal, with the decimal values as text, as dealItemsPayload sends them.
create function test_support.deal_item(p_id uuid,p_name text,p_quantity text,p_price text,p_billing text default 'one_time',
 p_product uuid default null,p_discount_type text default null,p_discount_value text default null) returns jsonb language sql security invoker as $$
 select jsonb_strip_nulls(jsonb_build_object('id',p_id,'product_id',p_product,'name',p_name,'quantity',p_quantity,
  'unit_price',p_price,'billing',p_billing,'discount_type',p_discount_type,'discount_value',p_discount_value))
$$;
-- The fields of the form for a new opportunity of organization A.
create function test_support.deal_fields(p_title text,p_owner uuid) returns jsonb language sql security invoker as $$
 select jsonb_build_object('title',p_title,'pipeline_id',current_setting('test.pipeline_a'),'stage_id',current_setting('test.stage_a'),
  'status','open','currency','BRL','owner_id',p_owner)
$$;
grant execute on function test_support.deal_item(uuid,text,text,text,text,uuid,text,text),test_support.deal_fields(text,uuid) to authenticated;

-- 1. Schema.
select test_support.assert((select count(*)=11 from pg_attribute a join (values
  ('id','uuid',true),('org_id','uuid',true),('name','text',true),('code','text',false),('kind','text',true),('unit','text',false),
  ('price','numeric(16,2)',true),('billing','text',true),('archived_at','timestamp with time zone',false),
  ('created_at','timestamp with time zone',true),('updated_at','timestamp with time zone',true)
 ) expected(name,type,not_null) on a.attname=expected.name
 where a.attrelid='public.products'::regclass and not a.attisdropped and format_type(a.atttypid,a.atttypmod)=expected.type and a.attnotnull=expected.not_null),
 'products has the catalog columns: name, code, kind, unit, price, billing, archived_at and the versions');
select test_support.assert((select count(*)=15 from pg_attribute a join (values
  ('id','uuid',true),('org_id','uuid',true),('deal_id','uuid',true),('product_id','uuid',false),('position','integer',true),
  ('name','text',true),('quantity','numeric(12,3)',true),('unit','text',false),('unit_price','numeric(16,2)',true),
  ('discount_type','text',false),('discount_value','numeric(16,2)',true),('billing','text',true),('line_total','numeric(16,2)',false),
  ('created_at','timestamp with time zone',true),('updated_at','timestamp with time zone',true)
 ) expected(name,type,not_null) on a.attname=expected.name
 where a.attrelid='public.deal_items'::regclass and not a.attisdropped and format_type(a.atttypid,a.atttypmod)=expected.type and a.attnotnull=expected.not_null)
 and (select a.attgenerated='s' and pg_get_expr(d.adbin,d.adrelid) like all (array['%round((quantity * unit_price), 2)%','%''percent''%','%''amount''%','%/ (100)%'])
  from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.deal_items'::regclass and a.attname='line_total')
 and not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.deal_items'::regclass and a.attname='id'),
 'deal_items has the item columns, an id without default (from the browser) and line_total generated from quantity, price and discount');
select test_support.assert((select count(*)=4 from pg_attribute a join (values
  ('item_count','integer',true),('one_time_value','numeric(16,2)',false),('monthly_value','numeric(16,2)',false),('contract_months','integer',false)
 ) expected(name,type,not_null) on a.attname=expected.name
 where a.attrelid='public.deals'::regclass and format_type(a.atttypid,a.atttypmod)=expected.type and a.attnotnull=expected.not_null)
 and (select pg_get_expr(d.adbin,d.adrelid)='0' from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='public.deals'::regclass and a.attname='item_count'),
 'deals has item_count (0 by default) and the nullable one-time total, monthly total and contract months');
select test_support.assert((select count(*)=9 from pg_constraint where conrelid='public.products'::regclass and contype='c' and conname in
  ('products_name_length','products_code_length','products_kind','products_unit_length','products_price_valid','products_billing',
   'products_archived_at_finite','products_created_at_finite','products_updated_at_finite'))
 and (select count(*)=10 from pg_constraint where conrelid='public.deal_items'::regclass and contype='c' and conname in
  ('deal_items_position','deal_items_name_length','deal_items_quantity','deal_items_unit_length','deal_items_unit_price',
   'deal_items_gross_limit','deal_items_discount','deal_items_billing','deal_items_created_at_finite','deal_items_updated_at_finite'))
 and (select pg_get_constraintdef(oid) like all (array['%discount_type IS NULL%','%''percent''%','%<= (100)%','%''amount''%','%round((quantity * unit_price), 2)%'])
  from pg_constraint where conname='deal_items_discount')
 and (select count(*)=3 from pg_constraint where conrelid='public.deals'::regclass and conname in ('deals_item_count','deals_item_totals','deals_value_from_items') and convalidated)
 and (select pg_get_constraintdef(oid) like '%value = (one_time_value + (monthly_value * (COALESCE(contract_months, 0))::numeric))%' from pg_constraint where conname='deals_value_from_items'),
 'every rule has its CHECK: lengths, kinds, prices, the discount up to the gross line, and the deal value tied to its parts');
select test_support.assert((select indexdef like '%(org_id, lower(btrim(code)))%' and indexdef like '%WHERE (code IS NOT NULL)%' and indexdef like 'CREATE UNIQUE INDEX%'
  from pg_indexes where schemaname='public' and indexname='products_org_code')
 and (select count(*)=2 from pg_constraint c where c.conrelid='public.deal_items'::regclass and c.contype='f' and cardinality(c.conkey)=2
  and ((c.conname='deal_items_deal_id_org_id_fkey' and c.confrelid='public.deals'::regclass and c.confdeltype='c')
   or (c.conname='deal_items_product_id_org_id_fkey' and c.confrelid='public.products'::regclass and c.confdeltype='a')))
 and (select count(*)=4 from pg_indexes where schemaname='public' and indexname in ('products_org_name','deal_items_deal_position',
  'deal_items_deal_id_org_id_fkey_idx','deal_items_product_id_org_id_fkey_idx')),
 'the code is unique per organization ignoring case and edge spaces; the items point to the deal (cascade) and to the product (no action) by composite keys, all indexed');
select test_support.assert((select bool_and(relrowsecurity) from pg_class where oid in ('public.products'::regclass,'public.deal_items'::regclass))
 and (select array_agg(polname::text order by polname) from pg_policy where polrelid='public.products'::regclass)='{tenant_delete,tenant_insert,tenant_read,tenant_update}'
 and (select array_agg(polname::text order by polname) from pg_policy where polrelid='public.deal_items'::regclass)='{tenant_read}'
 and has_table_privilege('authenticated','public.products','select,insert,update,delete')
 and has_table_privilege('authenticated','public.deal_items','select')
 and not has_table_privilege('authenticated','public.deal_items','insert') and not has_table_privilege('authenticated','public.deal_items','update')
 and not has_table_privilege('authenticated','public.deal_items','delete')
 and not has_table_privilege('anon','public.products','select') and not has_table_privilege('anon','public.deal_items','select'),
 'RLS is on; the catalog has one policy per operation; deal_items is only readable by the API, and anon gets nothing');
select test_support.assert((select count(*)=6 from pg_trigger t where not t.tgisinternal and t.tgenabled='O'
  and t.tgrelid in ('public.products'::regclass,'public.deal_items'::regclass)
  and ((t.tgname='protect_record_metadata' and t.tgtype=23) or (t.tgname='touch_updated_at' and t.tgtype=19)
   or (t.tgname='audit_record_change' and t.tgtype=29)))
 and (select count(*)=1 from pg_trigger t where t.tgrelid='public.deals'::regclass and t.tgname='protect_deal_totals' and t.tgtype=23
  and t.tgfoid='private.protect_deal_totals()'::regprocedure),
 'products and deal_items keep the creation time, renew the version and are audited; deals has protect_deal_totals before insert or update');
select test_support.assert(not exists(select 1 from (values
  ('private.protect_deal_totals()',false),('private.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)',true),
  ('public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)',false)
 ) expected(signature,definer) join pg_proc p on p.oid=expected.signature::regprocedure
 where p.prosecdef<>expected.definer or not p.proconfig @> array['search_path=""'])
 and not exists(select 1 from (values ('anon'),('authenticated'),('service_role')) r(role) where has_function_privilege(r.role,'private.protect_deal_totals()','execute'))
 and has_function_privilege('authenticated','public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)','execute')
 and has_function_privilege('authenticated','private.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)','execute')
 and not has_function_privilege('anon','public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)','execute')
 and not has_function_privilege('anon','private.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer)','execute')
 and (select array_agg(p.proname::text order by p.proname) from pg_proc p where p.pronamespace='private'::regnamespace and has_function_privilege('anon',p.oid,'execute'))='{instance_status}',
 'save_deal is INVOKER over a DEFINER private function, both with an empty search_path, for authenticated and never anon; no API role executes the trigger function');

-- 2. The catalog: owners and administrators write, everyone in the organization reads.
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.products(id,org_id,name,code,kind,unit,price,billing) values
 ('16100000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Implantação','IMP-01','service','un',1500,'one_time');
select test_support.sign_in('00000000-0000-0000-0000-000000000161');
insert into public.products(id,org_id,name,code,kind,unit,price,billing) values
 ('16100000-0000-0000-0000-000000000002',current_setting('test.org_a')::uuid,'Gestão de tráfego','GT-01','service','mês',2000,'monthly'),
 ('16100000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,'Produto antigo',null,'product','un',100,'one_time'),
 ('16100000-0000-0000-0000-000000000004',current_setting('test.org_a')::uuid,'Nunca usado','NU-01','product',null,10,'one_time');
select test_support.assert((select count(*)=4 from public.products where id::text like '16100000-%'),'catalog: the owner and an administrator create items');
update public.products set price=1600,name='Implantação completa' where id='16100000-0000-0000-0000-000000000001';
select test_support.assert((select price=1600 and name='Implantação completa' and created_at<=updated_at from public.products where id='16100000-0000-0000-0000-000000000001'),'catalog: an administrator edits an item');
select test_support.denied_with(format('insert into public.products(org_id,name,code,price) values(%L,''Repetido'','' imp-01 '',1)',current_setting('test.org_a')),
 'products_org_code','catalog: the same code with another case and spaces on the edges is refused in the organization');
select test_support.denied(format('insert into public.products(org_id,name,code,price) values(%L,''Sem código'','''',1)',current_setting('test.org_a')),'catalog: an empty code is refused (no code is NULL)');
select test_support.denied(format('insert into public.products(org_id,name,price) values(%L,''Preço inválido'',-1)',current_setting('test.org_a')),'catalog: a negative price is refused');
select test_support.denied(format('insert into public.products(org_id,name,price,kind) values(%L,''Tipo inválido'',1,''bundle'')',current_setting('test.org_a')),'catalog: an unknown kind is refused');
select test_support.sign_in('00000000-0000-0000-0000-000000000162');
select test_support.assert((select count(*)=4 from public.products where id::text like '16100000-%'),'catalog: a collaborator reads the catalog');
select test_support.denied(format('insert into public.products(org_id,name,price) values(%L,''Do colaborador'',1)',current_setting('test.org_a')),'catalog: a collaborator cannot create items');
with changed as (update public.products set price=1 where id='16100000-0000-0000-0000-000000000001' returning 1)
 select test_support.assert(count(*)=0,'catalog: a collaborator cannot edit items') from changed;
with removed as (delete from public.products where id='16100000-0000-0000-0000-000000000004' returning 1)
 select test_support.assert(count(*)=0,'catalog: a collaborator cannot delete items') from removed;
select test_support.sign_in('00000000-0000-0000-0000-000000000163');
select test_support.assert((select count(*)=4 from public.products where id::text like '16100000-%'),'catalog: a viewer reads the catalog');
select test_support.denied(format('insert into public.products(org_id,name,price) values(%L,''Da leitura'',1)',current_setting('test.org_a')),'catalog: a viewer cannot create items');
with changed as (update public.products set archived_at=now() where id='16100000-0000-0000-0000-000000000001' returning 1)
 select test_support.assert(count(*)=0,'catalog: a viewer cannot archive items') from changed;
select test_support.sign_in('00000000-0000-0000-0000-000000000164');
select test_support.assert(not exists(select 1 from public.products),'catalog: a deactivated account reads nothing');
select test_support.sign_in('00000000-0000-0000-0000-000000000002');
select test_support.assert(not exists(select 1 from public.products where id::text like '16100000-%'),'catalog: another organization reads nothing');
select test_support.denied(format('insert into public.products(org_id,name,price) values(%L,''Injetado'',1)',current_setting('test.org_a')),'catalog: another organization cannot write into this one');
insert into public.products(id,org_id,name,code,price) values('16100000-0000-0000-0000-0000000000b1',current_setting('test.org_b')::uuid,'Da outra empresa','IMP-01',50);
select test_support.assert(exists(select 1 from public.products where id='16100000-0000-0000-0000-0000000000b1'),'catalog: the same code is accepted in another organization');
select test_support.sign_in('00000000-0000-0000-0000-000000000161');
update public.products set archived_at=now() where id='16100000-0000-0000-0000-000000000003';
select test_support.assert((select archived_at is not null from public.products where id='16100000-0000-0000-0000-000000000003'),'catalog: an administrator archives an item');

-- 3. deal_items is closed to the API, even for the owner.
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id) values
 ('16300000-0000-0000-0000-000000000009',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Catálogo: direto',100,auth.uid());
select test_support.denied(format('insert into public.deal_items(id,org_id,deal_id,position,name,quantity,unit_price,billing) values(gen_random_uuid(),%L,''16300000-0000-0000-0000-000000000009'',0,''Forjado'',1,1,''one_time'')',current_setting('test.org_a')),
 'items: the owner cannot insert items through the API');

-- 4. save_deal.
-- 4.1 Creation with items, by a collaborator: one catalog item and one ad hoc monthly item with 10% off, for 12 months.
select test_support.sign_in('00000000-0000-0000-0000-000000000162');
select set_config('test.catalog_created',public.save_deal('16300000-0000-0000-0000-000000000001',null,
 test_support.deal_fields('Catálogo: contrato de tráfego','00000000-0000-0000-0000-000000000162'),
 jsonb_build_array(
  test_support.deal_item('16200000-0000-0000-0000-000000000001','Implantação completa','1.000','1600.00','one_time','16100000-0000-0000-0000-000000000001'),
  test_support.deal_item('16200000-0000-0000-0000-000000000002','Gestão de tráfego para a Ana','1.000','2000.00','monthly',null,'percent','10.00')),
 12)::text,true);
select test_support.assert((select item_count=2 and one_time_value=1600 and monthly_value=1800 and contract_months=12 and value=1600+1800*12
  from public.deals where id='16300000-0000-0000-0000-000000000001'),
 'save_deal: a creation with items stores the one-time total, the monthly total, the months and value = one-time + monthly × months');
select test_support.assert((select string_agg(name||'='||line_total||'@'||position,'; ' order by position) from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001')
  ='Implantação completa=1600.00@0; Gestão de tráfego para a Ana=1800.00@1',
 'save_deal: the line totals are computed by the database, with the 10% discount, in the order of the list');
select test_support.assert((select (r->>'replayed')::boolean=false and jsonb_array_length(r->'items')=2 and r->'deal'->>'id'='16300000-0000-0000-0000-000000000001'
  from (select current_setting('test.catalog_created')::jsonb r) x),'save_deal: the answer has the deal and its items');
select test_support.assert((select (r->>'replayed')::boolean and (select count(*)=1 from public.deals where id='16300000-0000-0000-0000-000000000001')
  and (select count(*)=2 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001')
  from (select public.save_deal('16300000-0000-0000-0000-000000000001',null,
   test_support.deal_fields('Catálogo: contrato de tráfego','00000000-0000-0000-0000-000000000162'),
   jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000001','Implantação completa','1.000','1600.00','one_time','16100000-0000-0000-0000-000000000001'),
    test_support.deal_item('16200000-0000-0000-0000-000000000002','Gestão de tráfego para a Ana','1.000','2000.00','monthly',null,'percent','10.00')),12) r) x),
 'save_deal: the creation repeated after a lost answer returns the deal already created, without duplicating it');
select test_support.assert((select count(*)=1 from public.activities where deal_id='16300000-0000-0000-0000-000000000001' and title='Catálogo: primeira ação'),
 'save_deal: deal_created runs once for the creation');
select test_support.assert((select count(*)=1 from public.deal_stage_history where deal_id='16300000-0000-0000-0000-000000000001'),'save_deal: the creation writes one history entry');
select test_support.assert(coalesce(current_setting('crm.saving_deal_items',true),'')='','save_deal: the mark is off after the RPC');
-- 4.2 Creation without items keeps the manual value.
select public.save_deal('16300000-0000-0000-0000-000000000002',null,
 test_support.deal_fields('Catálogo: valor digitado','00000000-0000-0000-0000-000000000162')||'{"value":"900.50"}'::jsonb,null,null);
select test_support.assert((select item_count=0 and value=900.50 and one_time_value is null and monthly_value is null and contract_months is null
  from public.deals where id='16300000-0000-0000-0000-000000000002'),'save_deal: a creation without items keeps the manual value and no parts');
-- 4.3 Edition by difference: the first item changes, the second is removed and a third is added; ids are kept.
reset role;
select set_config('test.catalog_audit',(select count(*) from public.audit_logs)::text,true);
set local role authenticated;
select public.save_deal('16300000-0000-0000-0000-000000000001',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000001'),
 null,jsonb_build_array(
  test_support.deal_item('16200000-0000-0000-0000-000000000001','Implantação completa','2.000','1600.00','one_time','16100000-0000-0000-0000-000000000001'),
  test_support.deal_item('16200000-0000-0000-0000-000000000003','Treinamento','3.000','250.00','one_time',null,'amount','50.00')),
 6);
select test_support.assert((select string_agg(id::text||'='||line_total,'; ' order by position) from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001')
  ='16200000-0000-0000-0000-000000000001=3200.00; 16200000-0000-0000-0000-000000000003=700.00',
 'save_deal: the edition keeps the id of the changed item, deletes the missing one and inserts the new one (R$ 50 off)');
select test_support.assert((select item_count=2 and one_time_value=3900 and monthly_value=0 and contract_months is null and value=3900
  from public.deals where id='16300000-0000-0000-0000-000000000001'),'save_deal: without a monthly item the months are dropped and value is the one-time total');
reset role;
select test_support.assert((select count(*) from public.audit_logs)::int-current_setting('test.catalog_audit')::int=4
 and exists(select 1 from public.audit_logs where entity_type='deal_items' and entity_id='16200000-0000-0000-0000-000000000001' and action='update' and changed_fields='{line_total,quantity}')
 and exists(select 1 from public.audit_logs where entity_type='deal_items' and entity_id='16200000-0000-0000-0000-000000000002' and action='delete')
 and exists(select 1 from public.audit_logs where entity_type='deal_items' and entity_id='16200000-0000-0000-0000-000000000003' and action='create')
 and (select count(*)=1 from public.audit_logs where entity_type='deals' and entity_id='16300000-0000-0000-0000-000000000001' and action='update'
  and changed_fields @> '{one_time_value,monthly_value,contract_months,value}'::text[] and not 'item_count'=any(changed_fields)),
 'save_deal: the edition audits only what changed (one item updated, one deleted, one created) and the deal once');
set local role authenticated;
select test_support.assert((select count(*)=1 from public.activities where deal_id='16300000-0000-0000-0000-000000000001' and title='Catálogo: primeira ação')
  and (select count(*)=1 from public.deal_stage_history where deal_id='16300000-0000-0000-0000-000000000001'),
 'save_deal: the edition writes no history and runs no automation');
-- Saving the same list again changes no item: only the deal gets a new version (no audit for the items).
reset role;
select set_config('test.catalog_audit',(select count(*) from public.audit_logs where entity_type='deal_items')::text,true);
set local role authenticated;
select public.save_deal('16300000-0000-0000-0000-000000000001',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000001'),
 null,jsonb_build_array(
  test_support.deal_item('16200000-0000-0000-0000-000000000001','Implantação completa','2.000','1600.00','one_time','16100000-0000-0000-0000-000000000001'),
  test_support.deal_item('16200000-0000-0000-0000-000000000003','Treinamento','3.000','250.00','one_time',null,'amount','50.00')),null);
reset role;
select test_support.assert((select count(*) from public.audit_logs where entity_type='deal_items')::int=current_setting('test.catalog_audit')::int,
 'save_deal: an unchanged list updates no item');
set local role authenticated;
-- 4.4 Refusals. Each one leaves the deal and its items as they were.
select test_support.denied_with(format('select public.save_deal(%L,%L,null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','2000-01-01 00:00:00+00',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Outro','1.000','1.00'))),
 'Esta oportunidade mudou ou não está mais disponível','save_deal: an old version saves nothing and explains the conflict');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Mensal','1.000','10.00','monthly'))),
 'Informe por quantos meses o contrato vale, de 1 a 120.','save_deal: a monthly item requires the months');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,121)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Mensal','1.000','10.00','monthly'))),
 'Informe por quantos meses o contrato vale, de 1 a 120.','save_deal: more than 120 months is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Desconto grande','2.000','50.00','one_time',null,'amount','100.01'))),
 'até o valor bruto da linha','save_deal: a discount in R$ above the gross line is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Desconto','1.000','50.00','one_time',null,'percent','100.5'))),
 'precisa ser maior que 0 e até 100','save_deal: a percentage above 100 is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Quatro casas','1.2345','1.00'))),
 'Item 1 (Quatro casas): informe uma quantidade maior que zero, com até 3 casas decimais.','save_deal: a quantity with 4 decimals is refused, with the position and the name');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Três casas','1.000','10.005'))),
 'informe um preço unitário positivo ou zero, com até duas casas decimais.','save_deal: a price with 3 decimals is refused before numeric(16,2) rounds it');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Número do JSON','quantity',1,'unit_price','1.00','billing','one_time'))),
 'informe uma quantidade maior que zero','save_deal: a quantity sent as a JSON number is refused (decimals travel as text)');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Zero','0.000','1.00'))),
 'informe uma quantidade maior que zero','save_deal: a zero quantity is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Arquivado','1.000','100.00','one_time','16100000-0000-0000-0000-000000000003'))),
 '“Produto antigo” foi arquivado no catálogo. Escolha outro item ou use um item avulso.','save_deal: an archived product is refused in a new item');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Da outra empresa','1.000','50.00','one_time','16100000-0000-0000-0000-0000000000b1'))),
 'foi excluído. Escolha outro item ou use um item avulso.','save_deal: a product of another organization is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000002','16300000-0000-0000-0000-000000000002',
  jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000001','Roubado','1.000','1.00'))),
 'este item não pertence a esta oportunidade.','save_deal: an item id of another deal is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  (select jsonb_agg(test_support.deal_item(gen_random_uuid(),'Item '||n,'1.000','1.00')) from generate_series(1,101) n)),
 'Uma oportunidade tem no máximo 100 itens.','save_deal: 101 items are refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,2)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'No limite','1.000','999999999999.99','monthly'))),
 'O valor do contrato passa do limite de R$ 999.999.999.999,99.','save_deal: a contract above the limit is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),%L::jsonb,null,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  '{"stage_id":"16300000-0000-0000-0000-000000000001"}'),'Campo desconhecido: stage_id.','save_deal: a key outside the edition list is refused (stage and status change by move_deal)');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),%L::jsonb,null,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  '{"value":5}'),'O valor desta oportunidade vem dos itens. Para mudar o valor, edite os itens.','save_deal: a value different from the items is refused');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Desconto quebrado','1.000','50.00','one_time',null,'amount','1.005'))),
 'informe o desconto em R$ com até duas casas decimais','save_deal: a discount in R$ with 3 decimals is refused before numeric(16,2) rounds it');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),%L::jsonb,%L::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001',
  '{"value":"1.00"}',jsonb_build_array(
   test_support.deal_item('16200000-0000-0000-0000-000000000001','Implantação completa','2.000','1600.00','one_time','16100000-0000-0000-0000-000000000001'),
   test_support.deal_item('16200000-0000-0000-0000-000000000003','Treinamento','3.000','250.00','one_time',null,'amount','50.00'))),
 'O valor desta oportunidade vem dos itens. Para mudar o valor, edite os itens.','save_deal: a value different from the contract sent with the items is refused, not overwritten');
select test_support.assert((select item_count=2 and value=3900 from public.deals where id='16300000-0000-0000-0000-000000000001')
  and (select count(*)=2 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001')
  and coalesce(current_setting('crm.saving_deal_items',true),'')='',
 'save_deal: every refusal left the deal and the items unchanged, and the mark off');
select test_support.sign_in('00000000-0000-0000-0000-000000000163');
select test_support.assert((select count(*)=2 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001'),'items: a viewer reads the items of the organization');
select test_support.denied_with(format('select public.save_deal(%L,(select updated_at from public.deals where id=%L),null,''[]''::jsonb,null)','16300000-0000-0000-0000-000000000001','16300000-0000-0000-0000-000000000001'),
 'Você não tem permissão para alterar oportunidades.','save_deal: a viewer is refused');
select test_support.sign_in('00000000-0000-0000-0000-000000000164');
select test_support.assert(not exists(select 1 from public.deal_items),'items: a deactivated account reads no items');
select test_support.denied_with(format('select public.save_deal(%L,null,%L::jsonb,null,null)','16300000-0000-0000-0000-000000000099',
  test_support.deal_fields('Desativada','00000000-0000-0000-0000-000000000162')),'Você não tem permissão para alterar oportunidades.','save_deal: a deactivated account is refused');
select test_support.sign_in('00000000-0000-0000-0000-000000000002');
select test_support.assert(not exists(select 1 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001')
 and not exists(select 1 from public.deal_items where org_id=current_setting('test.org_a')::uuid),'items: another organization reads no items of this one');
select test_support.denied_with(format('select public.save_deal(%L,null,%L::jsonb,null,null)','16300000-0000-0000-0000-000000000001',
  '{"title":"Outra empresa"}'),'Oportunidade indisponível ou sem acesso.','save_deal: another organization cannot replay a creation of this one');
select test_support.denied_with(format('select public.save_deal(%L,(select ''2026-10-18''::timestamptz),null,''[]''::jsonb,null)','16300000-0000-0000-0000-000000000001'),
 'Esta oportunidade mudou ou não está mais disponível','save_deal: another organization cannot edit the deal');
-- 4.5 An archived product stays in the item that already used it; the months come back with a monthly item.
select test_support.sign_in('00000000-0000-0000-0000-000000000161');
reset role;
-- The archived product was active when the item was chosen: written with the item already in place.
set local role authenticated;
update public.products set archived_at=null where id='16100000-0000-0000-0000-000000000003';
select public.save_deal('16300000-0000-0000-0000-000000000002',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000002'),null,
 jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000011','Produto antigo','1.000','100.00','one_time','16100000-0000-0000-0000-000000000003')),null);
update public.products set archived_at=now() where id='16100000-0000-0000-0000-000000000003';
select public.save_deal('16300000-0000-0000-0000-000000000002',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000002'),null,
 jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000011','Produto antigo (sem mudança)','2.000','100.00','one_time','16100000-0000-0000-0000-000000000003'),
  test_support.deal_item('16200000-0000-0000-0000-000000000012','Mensalidade','1.000','0.00','monthly')),1);
select test_support.assert((select item_count=2 and one_time_value=200 and monthly_value=0 and contract_months=1 and value=200 from public.deals where id='16300000-0000-0000-0000-000000000002')
  and (select product_id='16100000-0000-0000-0000-000000000003' from public.deal_items where id='16200000-0000-0000-0000-000000000011'),
 'save_deal: the item that already used an archived product keeps it; a monthly item at zero still needs the months');
-- 4.6 Removing every item keeps the last computed value as the manual value; then the manual value is editable again.
select public.save_deal('16300000-0000-0000-0000-000000000002',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000002'),null,'[]'::jsonb,null);
select test_support.assert((select item_count=0 and value=200 and one_time_value is null and monthly_value is null and contract_months is null from public.deals where id='16300000-0000-0000-0000-000000000002')
  and not exists(select 1 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000002'),
 'save_deal: [] removes every item and keeps the last computed value as the manual value');
select public.save_deal('16300000-0000-0000-0000-000000000002',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000002'),'{"value":"950.00","title":"Catálogo: valor digitado de novo"}'::jsonb,'[]'::jsonb,null);
select test_support.assert((select value=950 and title='Catálogo: valor digitado de novo' from public.deals where id='16300000-0000-0000-0000-000000000002'),
 'save_deal: without items the manual value and the fields are saved again');
-- 4.7 Items on a won deal: closing date, probability and status stay.
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,status) values
 ('16300000-0000-0000-0000-000000000003',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Catálogo: ganha',10,auth.uid(),'won');
select set_config('test.catalog_closed_at',(select closed_at from public.deals where id='16300000-0000-0000-0000-000000000003')::text,true);
select public.save_deal('16300000-0000-0000-0000-000000000003',(select updated_at from public.deals where id='16300000-0000-0000-0000-000000000003'),null,
 jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000021','Gestão de tráfego','1.000','2000.00','monthly','16100000-0000-0000-0000-000000000002')),3);
select test_support.assert((select status='won' and probability=100 and closed_at=current_setting('test.catalog_closed_at')::timestamptz and value=6000 and monthly_value=2000
  from public.deals where id='16300000-0000-0000-0000-000000000003'),'save_deal: items of a won deal keep its status, probability and closing date');
select test_support.assert(not exists(select 1 from public.deals d where d.contract_months is null
  and exists(select 1 from public.deal_items i where i.deal_id=d.id and i.billing='monthly')),'every deal with a monthly item has the months');
-- 4.8 A discount of zero, in % or in R$, is stored as no discount (the CHECK would refuse 'percent' with 0).
select public.save_deal('16300000-0000-0000-0000-000000000006',null,test_support.deal_fields('Catálogo: desconto zero','00000000-0000-0000-0000-000000000001'),
 jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000041','Zero por cento','2.000','150.00','one_time',null,'percent','0.00'),
  test_support.deal_item('16200000-0000-0000-0000-000000000042','Zero reais','1.000','99.90','one_time',null,'amount','0')),null);
select test_support.assert((select string_agg(coalesce(discount_type,'none')||'/'||discount_value||'='||line_total,'; ' order by position)
  from public.deal_items where deal_id='16300000-0000-0000-0000-000000000006')='none/0.00=300.00; none/0.00=99.90'
 and (select value=399.90 and one_time_value=399.90 from public.deals where id='16300000-0000-0000-0000-000000000006'),
 'save_deal: a discount of 0 in % or in R$ becomes no discount, and the line total is the gross line');

-- 5. Protections in deals.
select test_support.denied_with('update public.deals set value=1 where id=''16300000-0000-0000-0000-000000000001''','deals_value_from_items',
 'protection: a direct update of the value of a deal with items is refused (23514)');
update public.deals set item_count=0,one_time_value=1,monthly_value=1,contract_months=99,title='Catálogo: contrato com título novo' where id='16300000-0000-0000-0000-000000000001';
select test_support.assert((select item_count=2 and one_time_value=3900 and monthly_value=0 and contract_months is null and value=3900 and title='Catálogo: contrato com título novo'
  from public.deals where id='16300000-0000-0000-0000-000000000001'),'protection: the parts sent by the client in an update are ignored, and the other fields are saved');
insert into public.deals(id,org_id,pipeline_id,stage_id,title,value,owner_id,item_count,one_time_value,monthly_value,contract_months) values
 ('16300000-0000-0000-0000-000000000008',current_setting('test.org_a')::uuid,current_setting('test.pipeline_a')::uuid,current_setting('test.stage_a')::uuid,'Catálogo: partes forjadas',70,auth.uid(),5,70,0,null);
select test_support.assert((select item_count=0 and one_time_value is null and monthly_value is null and contract_months is null and value=70
  from public.deals where id='16300000-0000-0000-0000-000000000008'),'protection: the parts sent by the client in an insert are zeroed');
select public.move_deal('16300000-0000-0000-0000-000000000001',current_setting('test.stage_a_next')::uuid);
select test_support.assert((select item_count=2 and value=3900 from public.deals where id='16300000-0000-0000-0000-000000000001')
  and (select count(*)=2 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001'),'protection: moving the stage keeps the items and the value');

-- 6. Integration with the catalog, the deletion and the privacy of item 1.10.
select test_support.sign_in('00000000-0000-0000-0000-000000000161');
select test_support.denied_with('delete from public.products where id=''16100000-0000-0000-0000-000000000001''','deal_items_product_id_org_id_fkey',
 'catalog: deleting an item already used in deals is refused (23503)');
with removed as (delete from public.products where id='16100000-0000-0000-0000-000000000004' returning 1)
 select test_support.assert(count(*)=1,'catalog: an item never used is deleted') from removed;
select public.delete_deal('16300000-0000-0000-0000-000000000003',true);
select test_support.assert(not exists(select 1 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000003'),'delete_deal: the items leave with the deal');
reset role;
select test_support.assert(exists(select 1 from public.audit_logs where entity_type='deal_items' and entity_id='16200000-0000-0000-0000-000000000021' and action='delete'),
 'delete_deal: the cascade deletion of the items is audited');
-- The person (Ana Catálogo), her deal with an item that cites her, and another deal whose items cite her full name and
-- only her first name.
select test_support.sign_in('00000000-0000-0000-0000-000000000001');
set local role authenticated;
insert into public.contacts(id,org_id,first_name,last_name,email) values
 ('16400000-0000-0000-0000-000000000001',current_setting('test.org_a')::uuid,'Anabela','Catálogo','anabela.catalogo@example.test');
select public.save_deal('16300000-0000-0000-0000-000000000004',null,
 test_support.deal_fields('Catálogo: da pessoa','00000000-0000-0000-0000-000000000001')||jsonb_build_object('contact_id','16400000-0000-0000-0000-000000000001'),
 jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000031','Consultoria para Anabela','1.000','500.00')),null);
select public.save_deal('16300000-0000-0000-0000-000000000005',null,test_support.deal_fields('Catálogo: de outro cliente','00000000-0000-0000-0000-000000000001'),
 jsonb_build_array(test_support.deal_item('16200000-0000-0000-0000-000000000032','Indicação de Anabela Catálogo','1.000','10.00'),
  test_support.deal_item('16200000-0000-0000-0000-000000000033','Kit Anabela','1.000','10.00')),null);
select test_support.assert((select jsonb_array_length(e->'deals')=1 and jsonb_array_length(e->'deals'->0->'items')=1
  and e->'deals'->0->'items'->0->>'name'='Consultoria para Anabela' and (e->'deals'->0->'items'->0->>'line_total')::numeric=500
  and e->'deals'->0->'items'->0->>'billing'='one_time' and (e->'deals'->0->>'one_time_value')::numeric=500
  and e->'deals'->0 ? 'monthly_value' and e->'deals'->0 ? 'contract_months'
  from (select public.export_contact_data('16400000-0000-0000-0000-000000000001') e) x),
 'export: the deals of the person carry the parts of the value and the items');
select test_support.assert((select (s->>'other_records')::int=1 and (s->>'deals')::int=1
  from (select public.contact_privacy_summary('16400000-0000-0000-0000-000000000001') s) x),
 'privacy summary: an item of another deal citing the full name counts in other_records');
select test_support.assert((select (s->>'other_records')::int=1 and (s->>'deals')::int=1
  from (select public.anonymize_contact('16400000-0000-0000-0000-000000000001',(select updated_at from public.contacts where id='16400000-0000-0000-0000-000000000001')) s) x),
 'anonymize: the summary counts the items as the preview did');
select test_support.assert((select string_agg(name,'; ' order by id) from public.deal_items where id in
  ('16200000-0000-0000-0000-000000000031','16200000-0000-0000-0000-000000000032','16200000-0000-0000-0000-000000000033'))
  ='Consultoria para [anonimizado]; Indicação de [anonimizado]; Kit Anabela',
 'anonymize: every term of the person leaves the items of her deals; only the strong terms leave the items of other deals');
select test_support.assert(coalesce(current_setting('crm.saving_deal_items',true),'')='' and (select value=500 and item_count=1 from public.deals where id='16300000-0000-0000-0000-000000000004'),
 'anonymize: the value and the items of the deal stay');
-- 6.1 Passing the portfolio of a deactivated person keeps the items and the value of her deals.
select public.deactivate_member('00000000-0000-0000-0000-000000000162',false,'00000000-0000-0000-0000-000000000001');
select test_support.assert((select owner_id='00000000-0000-0000-0000-000000000001' and item_count=2 and value=3900 from public.deals where id='16300000-0000-0000-0000-000000000001')
  and (select count(*)=2 from public.deal_items where deal_id='16300000-0000-0000-0000-000000000001'),'portfolio: passing the portfolio keeps the items and the value');

-- 7. Legacy organization: deals written before the migration (supabase/tests/upgrade/20261019100000_product_catalog.sql).
reset role;
select test_support.sign_out();
select test_support.assert((select count(*)=3 from public.deals where id in ('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000003')
  and item_count=0 and one_time_value is null and monthly_value is null and contract_months is null)
 and (select value=2500.50 and updated_at='2026-09-23 10:00:00+00'::timestamptz from public.deals where id='98000000-0000-0000-0000-000000000001')
 and (select value=7300 and updated_at='2026-09-20 15:00:00+00'::timestamptz and status='won' from public.deals where id='98000000-0000-0000-0000-000000000002')
 and (select value=1200 and updated_at='2026-09-21 15:00:00+00'::timestamptz and status='lost' from public.deals where id='98000000-0000-0000-0000-000000000003')
 and not exists(select 1 from public.audit_logs where entity_id in ('98000000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000002','98000000-0000-0000-0000-000000000003')),
 'upgrade: deals written before the migration keep the manual value, the version and no new audit, without items');
select test_support.sign_in('00000000-0000-0000-0000-000000000099');
set local role authenticated;
select public.save_deal('98000000-0000-0000-0000-000000000001','2026-09-23 10:00:00+00',null,
 jsonb_build_array(test_support.deal_item(gen_random_uuid(),'Item depois da migração','3.000','0.17')),null);
select test_support.assert((select item_count=1 and value=0.51 and one_time_value=0.51 from public.deals where id='98000000-0000-0000-0000-000000000001'),
 'upgrade: a legacy deal receives items after the migration (3 × R$ 0,17 = R$ 0,51)');
reset role;
select test_support.sign_out();
rollback to savepoint product_catalog;
select test_support.assert(not exists(select 1 from public.products where id::text like '16100000-%')
 and not exists(select 1 from auth.users where email like '%-catalogo@example.test'),'the checks of item 1.16 were undone for the files that follow');
