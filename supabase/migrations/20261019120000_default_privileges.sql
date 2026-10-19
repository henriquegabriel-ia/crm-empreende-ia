-- Item 1.8 do roteiro: privilégios padrão revogados. Desenho: docs/arquitetura/1.8.md, seção 6; guia de quem
-- personaliza: docs/PERSONALIZAR/README.md.
-- Até aqui, o que o dono do banco (postgres) criava em public nascia com todos os privilégios para anon, authenticated e
-- service_role (os privilégios padrão do Supabase, reproduzidos em supabase/tests/local-bootstrap.sql), e toda função
-- nova nascia executável por PUBLIC (padrão do PostgreSQL). Cada migração da base revoga e concede de forma explícita,
-- mas uma tabela ou função nova esquecida sem revoke (de quem personaliza, do editor SQL, de uma ferramenta de IA)
-- ficava aberta pela API. Daqui em diante, o objeto novo nasce fechado: a API responde 42501 até alguém decidir o grant.
-- O Supabase passa a revogar o DML em public para todos os projetos em 30/10/2026; esta migração faz o mesmo antes, em
-- qualquer projeto, e vai além nos pontos que a mudança da plataforma deixa abertos (TRUNCATE, REFERENCES, TRIGGER e o
-- EXECUTE de PUBLIC).
-- Também deixa explícitas as permissões da service_role nas tabelas da base: antes, ela as recebia só dos privilégios
-- padrão antigos, e num projeto criado depois de 30/05/2026 (padrão já revogado) ficava sem nenhuma.
-- Aditiva: sem linha de dado, sem backfill, sem objeto novo em public (o tipo gerado não muda); privilégio padrão só
-- vale para objeto criado depois, e os objetos que já existem mantêm as permissões que as migrações deram.

-- 1. A guarda do item 1.13: private.base_fingerprints() é recriada no passo 4.
select private.assert_base_definition('function', 'private.base_fingerprints()', array['936e6d247f4dee1e']);

-- 2. Privilégios padrão do papel que aplica as migrações (postgres, no db push, no editor SQL do painel e no cluster
-- embutido dos testes). Todos os privilégios, não só o DML: TRUNCATE ignora a RLS, REFERENCES deixa criar uma FK que
-- trava exclusões e TRIGGER deixa criar gatilho na tabela. O revoke em private e o global de tabelas e sequências não
-- mudam nada num projeto como o Supabase os cria; ficam para as nove linhas do manifesto (passo 4) saírem vazias em
-- qualquer projeto.
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke all on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres revoke all on sequences from public, anon, authenticated, service_role;
-- O EXECUTE de PUBLIC nas funções é padrão global do PostgreSQL: o revoke "in schema" não o tira (um padrão de schema só
-- acrescenta ao global). Sem schema, vale para toda função nova que postgres criar, em qualquer schema; função de
-- gatilho continua funcionando (o EXECUTE só é conferido na criação do gatilho, pelo dono da tabela).
alter default privileges for role postgres revoke all on functions from public, anon, authenticated, service_role;

-- 3. A service_role com o que a API e uma Edge Function usam, explícito e igual em projetos antigos e novos: select,
-- insert, update e delete nas tabelas da base (ela ignora a RLS; é a chave das integrações do servidor e dos ganchos do
-- 1.13) e nada de TRUNCATE, REFERENCES, TRIGGER (nem MAINTAIN, no PostgreSQL 17). As 18 RPCs de public perdem o
-- EXECUTE dela. São SECURITY INVOKER: 17 chamam funções de private, schema em que a service_role não tem USAGE, e nunca
-- funcionaram por essa chave; public.search_crm é SQL só sobre tabelas de public e funcionava por ela, ignorando a RLS
-- e lendo a instância inteira. Deixa de funcionar: uma integração do servidor que buscar registros lê as tabelas.
revoke all on table public.activities, public.audit_logs, public.automation_logs, public.automations, public.companies,
 public.contacts, public.deal_items, public.deal_stage_history, public.deals, public.email_templates,
 public.integration_configs, public.invitations, public.onboarding_progress, public.organizations, public.payments,
 public.pipeline_stages, public.pipelines, public.portfolio_transfers, public.privacy_actions, public.products,
 public.profiles, public.risk_rules, public.user_roles
 from service_role;
grant select, insert, update, delete on table public.activities, public.audit_logs, public.automation_logs,
 public.automations, public.companies, public.contacts, public.deal_items, public.deal_stage_history, public.deals,
 public.email_templates, public.integration_configs, public.invitations, public.onboarding_progress,
 public.organizations, public.payments, public.pipeline_stages, public.pipelines, public.portfolio_transfers,
 public.privacy_actions, public.products, public.profiles, public.risk_rules, public.user_roles
 to service_role;
revoke execute on function public.accept_invitation(uuid),
 public.anonymize_contact(uuid,timestamp with time zone),
 public.automation_log_errors(uuid),
 public.complete_activity(uuid,timestamp with time zone,text,text,jsonb),
 public.contact_privacy_summary(uuid),
 public.create_invitation(text,text),
 public.create_workspace(text),
 public.deactivate_member(uuid,boolean,uuid),
 public.delete_deal(uuid,boolean),
 public.export_contact_data(uuid),
 public.instance_status(),
 public.member_portfolio(uuid),
 public.move_deal(uuid,uuid,text,text),
 public.reactivate_member(uuid,text),
 public.save_deal(uuid,timestamp with time zone,jsonb,jsonb,integer),
 public.search_crm(text,integer),
 public.set_member_role(uuid,text),
 public.transfer_portfolio(uuid,boolean,uuid)
 from service_role;

-- 4. A impressão digital com o tipo default_acl (as nove linhas dos privilégios padrão de postgres). O resto é o texto da
-- migração 20261019110000_update_protection.sql. Mesma assinatura: o create or replace mantém as permissões (nenhum
-- papel da API executa). Depois desta migração, as nove linhas ficam com acl vazio; uma permissão padrão reaberta
-- aparece na conferência de drift como alterada, com o comando que fecha.
create or replace function private.base_fingerprints()
returns table(kind text, object text, parent text, props jsonb, body_hash text, hash text)
 language plpgsql stable security invoker set search_path='' as $$
declare v_history boolean:=pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null;
begin
 return query
 with schemas as (
  select n.oid,n.nspname::text as name,n.nspacl,n.nspowner from pg_catalog.pg_namespace n where n.nspname in ('public','private')
 ), relations as (
  select c.oid,s.name||'.'||c.relname as name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner,c.reloptions
  from pg_catalog.pg_class c join schemas s on s.oid=c.relnamespace
  where c.relkind in ('r','p','v','m')
   and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_class'::pg_catalog.regclass and d.objid=c.oid and d.deptype='e')
 ), raw as (
  select 'schema'::text as kind,s.name as object,null::text as parent,
   pg_catalog.jsonb_build_object('acl',private.base_acl(coalesce(s.nspacl,pg_catalog.acldefault('n',s.nspowner)))) as props,
   null::text as body
  from schemas s
  union all
  select case when r.relkind in ('v','m') then 'view' else 'table' end,r.name,null,
   case when r.relkind in ('v','m') then pg_catalog.jsonb_build_object(
     'acl',private.base_acl(coalesce(r.relacl,pg_catalog.acldefault('r',r.relowner))),
     'security_invoker',coalesce((select o.option_value from pg_catalog.pg_options_to_table(r.reloptions) o where o.option_name='security_invoker'),'false'))
   else pg_catalog.jsonb_build_object('rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,
     'acl',private.base_acl(coalesce(r.relacl,pg_catalog.acldefault('r',r.relowner)))) end,
   case when r.relkind in ('v','m') then pg_catalog.pg_get_viewdef(r.oid) end
  from relations r
  union all
  select 'column',r.name||'.'||a.attname,r.name,
   pg_catalog.jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
    'generated',a.attgenerated::text,'identity',a.attidentity::text,'acl',private.base_acl(a.attacl)),
   (select pg_catalog.pg_get_expr(ad.adbin,ad.adrelid) from pg_catalog.pg_attrdef ad where ad.adrelid=a.attrelid and ad.adnum=a.attnum)
  from relations r join pg_catalog.pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
  union all
  select 'constraint',r.name||'.'||k.conname,r.name,pg_catalog.jsonb_build_object('type',k.contype::text),
   pg_catalog.pg_get_constraintdef(k.oid)
  from relations r join pg_catalog.pg_constraint k on k.conrelid=r.oid and k.contype in ('c','f','p','u','x','t')
  union all
  select 'index',r.name||'.'||ic.relname,r.name,'{}'::jsonb,pg_catalog.pg_get_indexdef(i.indexrelid)
  from relations r join pg_catalog.pg_index i on i.indrelid=r.oid join pg_catalog.pg_class ic on ic.oid=i.indexrelid
  where not exists(select 1 from pg_catalog.pg_constraint k where k.conindid=i.indexrelid and k.conrelid=r.oid and k.contype in ('p','u','x'))
  union all
  select 'policy',r.name||'.'||p.polname,r.name,
   pg_catalog.jsonb_build_object(
    'command',case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
    'permissive',p.polpermissive,
    'roles',(select pg_catalog.string_agg(x.role,',' order by x.role collate "C") from (
      select case when o=0 then 'public' else (select rr.rolname::text from pg_catalog.pg_roles rr where rr.oid=o) end as role
      from pg_catalog.unnest(p.polroles) o) x)),
   'USING: '||coalesce(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'')||E'\nWITH CHECK: '||coalesce(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'')
  from relations r join pg_catalog.pg_policy p on p.polrelid=r.oid
  union all
  select 'trigger',tn.nspname||'.'||tc.relname||'.'||t.tgname,tn.nspname||'.'||tc.relname,
   pg_catalog.jsonb_build_object('enabled',t.tgenabled::text),pg_catalog.pg_get_triggerdef(t.oid)
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class tc on tc.oid=t.tgrelid join pg_catalog.pg_namespace tn on tn.oid=tc.relnamespace
  join pg_catalog.pg_proc tp on tp.oid=t.tgfoid
  where not t.tgisinternal and (t.tgrelid in (select r.oid from relations r) or tp.pronamespace in (select s.oid from schemas s))
  union all
  select 'function',p.oid::pg_catalog.regprocedure::text,null,
   pg_catalog.jsonb_build_object(
    'kind',case p.prokind when 'p' then 'procedure' when 'a' then 'aggregate' when 'w' then 'window' else 'function' end,
    'language',(select l.lanname::text from pg_catalog.pg_language l where l.oid=p.prolang),
    'security',case when p.prosecdef then 'definer' else 'invoker' end,
    'volatility',case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
    'strict',p.proisstrict,
    'config',coalesce((select pg_catalog.string_agg(c,', ' order by c collate "C") from pg_catalog.unnest(p.proconfig) c),''),
    'returns',pg_catalog.pg_get_function_result(p.oid),
    'args',pg_catalog.pg_get_function_arguments(p.oid),
    'acl',private.base_acl(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)))),
   coalesce(nullif(p.prosrc,''),pg_catalog.pg_get_function_sqlbody(p.oid))
  from pg_catalog.pg_proc p join schemas s on s.oid=p.pronamespace
  where not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_proc'::pg_catalog.regclass and d.objid=p.oid and d.deptype='e')
  union all
  -- Item 1.8: os privilégios padrão do dono do banco (postgres), em nove linhas fixas, emitidas mesmo sem linha em
  -- pg_default_acl: o padrão global (*) e o acréscimo de public e de private, para tabelas, sequências e funções. Sem
  -- linha global, vale o padrão do PostgreSQL (acldefault: só o dono, e EXECUTE para PUBLIC nas funções); sem linha de
  -- schema, nada é acrescentado. Sem o papel postgres, nenhuma linha.
  select 'default_acl','postgres/'||g.schema_label||'/'||t.label,null,
   pg_catalog.jsonb_build_object('acl',private.base_acl(coalesce(d.defaclacl,
    case when g.namespace=0 then pg_catalog.acldefault(t.code,o.oid) end))),
   null
  from pg_catalog.pg_roles o
  cross join (select 0::pg_catalog.oid as namespace,'*'::text as schema_label
   union all select s.oid,s.name from schemas s) g
  cross join (values ('r'::"char",'r'::"char",'tables'::text),('S','s','sequences'),('f','f','functions')) t(objtype,code,label)
  left join pg_catalog.pg_default_acl d on d.defaclrole=o.oid and d.defaclnamespace=g.namespace and d.defaclobjtype=t.objtype
  where o.rolname='postgres'
 ), hashed as (
  select w.kind,w.object,w.parent,w.props,
   case when w.body is not null then pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(w.body,E'\r\n',E'\n'),'UTF8')),'hex'),16) end as body_hash
  from raw w
 )
 select h.kind,h.object,h.parent,h.props,h.body_hash,
  pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(h.props::text||coalesce(h.body_hash,''),'UTF8')),'hex'),16)
 from hashed h;

 return query select 'migration_history'::text,'supabase_migrations.schema_migrations'::text,null::text,
  pg_catalog.jsonb_build_object('present',v_history),null::text,null::text;
 if v_history then
  -- Lido por SQL dinâmico: a tabela só existe num projeto do Supabase. to_jsonb tolera um histórico sem a coluna name.
  return query execute $sql$
   select 'migration'::text,m.version,null::text,m.props,null::text,
    pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(m.props::text,'UTF8')),'hex'),16)
   from (select pg_catalog.to_jsonb(h)->>'version' as version,
     pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('name',pg_catalog.to_jsonb(h)->>'name')) as props
    from supabase_migrations.schema_migrations h) m
  $sql$;
 end if;
end $$;
