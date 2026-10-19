-- Item 1.13 do roteiro: proteção de atualização. Desenho: docs/arquitetura/1.13.md; guia de quem personaliza:
-- docs/PROTECAO-ATUALIZACAO.md.
-- Três peças, para o aluno personalizar a instância e continuar recebendo as atualizações da base sem perder a
-- personalização e sem que a atualização quebre algo em silêncio:
-- 1. oito ganchos private.custom_*, vazios, chamados por dois gatilhos novos (zz_custom_validate e zz_custom_after_save)
--    em contacts, companies, deals e activities: a regra própria da empresa entra no corpo de um gancho, sem editar
--    função da base. A base cria cada gancho uma única vez, aqui, e nunca o recria, troca ou remove (gancho novo é
--    função nova); o prefixo custom_ fica reservado ao aluno em qualquer objeto;
-- 2. private.base_fingerprints(): a impressão digital de cada objeto de public e private (propriedades legíveis e um
--    hash curto do corpo), a mesma regra para o manifesto (supabase/base-manifest.json, gerado no cluster embutido por
--    npm run manifest:build), para o check colado no painel (supabase/db-drift-check.sql) e para a guarda abaixo;
-- 3. private.assert_base_definition() e private.base_overwrite_consents: a guarda das migrações futuras que recriam uma
--    função ou um gatilho da base (F2A em diante). Se o objeto foi alterado à mão na instância, a migração para com uma
--    mensagem em pt-BR que dá os dois caminhos: mover a regra para um gancho ou aceitar a substituição.
-- Aditiva: cria objetos e recria private.move_member_portfolio com a mesma assinatura e o mesmo resultado (só liga a
-- marca da passagem de carteira, seção 2). Nenhuma linha muda, nenhuma tabela é reescrita, nenhum gatilho dispara
-- durante a migração e não há backfill. Sem coluna nova em public: o tipo gerado não muda. Com os ganchos vazios, os
-- gatilhos novos não mudam nenhuma gravação.

-- 1. Ganchos. Recebem a linha como a base vai gravá-la (p_new, depois de todos os gatilhos BEFORE da base) e a anterior
-- (p_old, nula na criação), com o tipo de linha da tabela: o PostgreSQL confere o nome das colunas que o gancho lê, e
-- uma coluna nova da base entra no tipo sem quebrar o gancho. Devolvem void: o gancho não muda a linha (as regras da
-- base, que já rodaram, não podem ser contornadas por ele). A validação recusa com raise exception 'mensagem em pt-BR'
-- (código P0001), que a tela mostra como está; o gancho de depois roda na mesma transação, e uma falha nele desfaz a
-- gravação inteira. SECURITY INVOKER e sem EXECUTE para os papéis da API: só a função de disparo (SECURITY DEFINER, do
-- dono do banco) chama um gancho.
create function private.custom_validate_contact(p_new public.contacts, p_old public.contacts) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_validate_company(p_new public.companies, p_old public.companies) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_validate_deal(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_validate_activity(p_new public.activities, p_old public.activities) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_after_contact_saved(p_new public.contacts, p_old public.contacts) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_after_company_saved(p_new public.companies, p_old public.companies) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_after_deal_saved(p_new public.deals, p_old public.deals) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
create function private.custom_after_activity_saved(p_new public.activities, p_old public.activities) returns void
 language plpgsql security invoker set search_path='' as $$
begin
 null;
end $$;
revoke execute on function private.custom_validate_contact(public.contacts,public.contacts),
 private.custom_validate_company(public.companies,public.companies),
 private.custom_validate_deal(public.deals,public.deals),
 private.custom_validate_activity(public.activities,public.activities),
 private.custom_after_contact_saved(public.contacts,public.contacts),
 private.custom_after_company_saved(public.companies,public.companies),
 private.custom_after_deal_saved(public.deals,public.deals),
 private.custom_after_activity_saved(public.activities,public.activities)
 from public,anon,authenticated,service_role;
comment on function private.custom_validate_contact(public.contacts,public.contacts) is
 'Gancho da empresa: roda antes de criar ou editar um contato (p_old nulo na criação; não roda na anonimização nem na passagem de carteira). Recuse com raise exception ''mensagem''. Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_validate_company(public.companies,public.companies) is
 'Gancho da empresa: roda antes de criar ou editar uma empresa (p_old nulo na criação; não roda na anonimização nem na passagem de carteira). Recuse com raise exception ''mensagem''. Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_validate_deal(public.deals,public.deals) is
 'Gancho da empresa: roda antes de criar ou editar uma oportunidade, inclusive mover, ganhar e perder (p_old nulo na criação; não roda na anonimização nem na passagem de carteira). Recuse com raise exception ''mensagem''. Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_validate_activity(public.activities,public.activities) is
 'Gancho da empresa: roda antes de criar ou editar uma atividade, inclusive concluir (p_old nulo na criação; não roda na anonimização nem na passagem de carteira). Recuse com raise exception ''mensagem''. Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_after_contact_saved(public.contacts,public.contacts) is
 'Gancho da empresa: roda depois de criar ou editar um contato, na mesma transação (p_old nulo na criação; p_new.anonymized_at preenchido na anonimização). Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_after_company_saved(public.companies,public.companies) is
 'Gancho da empresa: roda depois de criar ou editar uma empresa, na mesma transação (p_old nulo na criação). Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_after_deal_saved(public.deals,public.deals) is
 'Gancho da empresa: roda depois de criar ou editar uma oportunidade, na mesma transação (p_old nulo na criação). Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';
comment on function private.custom_after_activity_saved(public.activities,public.activities) is
 'Gancho da empresa: roda depois de criar ou editar uma atividade, na mesma transação (p_old nulo na criação). Troque só o corpo, com a mesma assinatura; nunca remova. Guia: docs/PROTECAO-ATUALIZACAO.md.';

-- 2. Disparo dos ganchos. SECURITY DEFINER, como os gatilhos da base que chamam private.* (lição do 1.10): a chave
-- service_role não tem USAGE em private, e um gatilho INVOKER quebraria a gravação dela. O gancho roda, então, com os
-- privilégios do dono do banco e sem RLS; quem age se descobre por auth.uid() e private.current_org() (guia). A
-- validação não roda em três casos:
-- - durante a anonimização (a marca crm.anonymizing_contact, ligada por private.anonymize_contact na própria
--   transação): uma regra da empresa sobre títulos ou anotações não pode impedir o atendimento de um pedido da LGPD;
-- - durante a passagem de carteira de deactivate_member e transfer_portfolio (a marca crm.moving_portfolio, ligada por
--   private.move_member_portfolio, abaixo): só o responsável muda, e um registro antigo que fira uma regra nova não
--   pode manter com acesso quem sai da empresa;
-- - na criação por uma conta que a RLS vai recusar (somente leitura, desativada ou de outra organização): o WITH CHECK
--   do INSERT roda depois dos gatilhos BEFORE, e o gancho não deve rodar, com efeito colateral ou mensagem, para quem
--   não grava. A condição é a da política tenant_insert. Na edição, o USING das políticas já tira a linha antes dos
--   gatilhos.
-- O gancho de depois roda sempre, para o aluno limpar os dados pessoais que copiou para as tabelas dele.
create function private.run_custom_validation() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('crm.anonymizing_contact',true),'')<>'' then return new; end if;
 if coalesce(current_setting('crm.moving_portfolio',true),'')<>'' then return new; end if;
 if tg_op='INSERT' and auth.uid() is not null
  and not (new.org_id is not distinct from private.current_org() and private.can_write()) then return new; end if;
 case tg_table_name
  when 'contacts' then perform private.custom_validate_contact(new,old);
  when 'companies' then perform private.custom_validate_company(new,old);
  when 'deals' then perform private.custom_validate_deal(new,old);
  when 'activities' then perform private.custom_validate_activity(new,old);
 end case;
 return new;
end $$;
create function private.run_custom_after_save() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 case tg_table_name
  when 'contacts' then perform private.custom_after_contact_saved(new,old);
  when 'companies' then perform private.custom_after_company_saved(new,old);
  when 'deals' then perform private.custom_after_deal_saved(new,old);
  when 'activities' then perform private.custom_after_activity_saved(new,old);
 end case;
 return null;
end $$;
revoke execute on function private.run_custom_validation(),private.run_custom_after_save()
 from public,anon,authenticated,service_role;

-- A passagem de carteira (20261013100000_member_deactivation.sql), igual à do item 1.2, com a marca crm.moving_portfolio
-- ligada só durante os UPDATEs de responsável e desligada logo depois (uma falha desfaz a transação e a marca junto).
-- Recriada aqui, na migração que cria a guarda: as migrações posteriores a esta que recriarem a função passam por
-- private.assert_base_definition. O create or replace mantém as permissões (nenhum papel da API executa).
create or replace function private.move_member_portfolio(p_org uuid,p_user uuid,p_recipient uuid,p_accounts boolean,p_deactivation boolean)
 returns table(deals integer,activities integer,contacts integer,companies integer,invitations integer) language plpgsql set search_path='' as $$
 #variable_conflict use_column
 declare v_counts record; v_name text; v_links text[];
  v_deals integer:=0; v_activities integer:=0; v_contacts integer:=0; v_companies integer:=0; v_invitations integer:=0;
 begin
 select * into v_counts from private.portfolio_counts(p_org,p_user);
 if p_recipient is null and (v_counts.deals+v_counts.activities>0 or (p_accounts and v_counts.contacts+v_counts.companies>0)) then
  select coalesce(nullif(trim(p.name),''),nullif(trim(p.email),''),'Esta pessoa') into v_name from public.profiles p where p.id=p_user;
  v_links=array_remove(array[
   case when v_counts.deals=1 then '1 oportunidade em aberto' when v_counts.deals>1 then v_counts.deals||' oportunidades em aberto' end,
   case when v_counts.activities=1 then '1 atividade pendente' when v_counts.activities>1 then v_counts.activities||' atividades pendentes' end,
   case when not p_accounts then null when v_counts.contacts=1 then '1 contato' when v_counts.contacts>1 then v_counts.contacts||' contatos' end,
   case when not p_accounts then null when v_counts.companies=1 then '1 empresa' when v_counts.companies>1 then v_counts.companies||' empresas' end
  ],null);
  raise exception '% tem %. Escolha quem recebe a carteira.',coalesce(v_name,'Esta pessoa'),
   case when cardinality(v_links)=1 then v_links[1]
    else array_to_string(v_links[1:cardinality(v_links)-1],', ')||' e '||v_links[cardinality(v_links)] end
   using detail=jsonb_build_object('deals',v_counts.deals,'activities',v_counts.activities,'contacts',v_counts.contacts,
    'companies',v_counts.companies,'invitations',v_counts.invitations)::text;
 end if;
 if p_recipient is not null then
  perform set_config('crm.moving_portfolio','1',true);
  update public.deals d set owner_id=p_recipient where d.org_id=p_org and d.owner_id=p_user and d.status='open';
  get diagnostics v_deals=row_count;
  update public.activities a set user_id=p_recipient where a.org_id=p_org and a.user_id=p_user and a.completed_at is null and a.type<>'note';
  get diagnostics v_activities=row_count;
  if p_accounts then
   update public.contacts c set owner_id=p_recipient where c.org_id=p_org and c.owner_id=p_user;
   get diagnostics v_contacts=row_count;
   update public.companies c set owner_id=p_recipient where c.org_id=p_org and c.owner_id=p_user;
   get diagnostics v_companies=row_count;
  end if;
  perform set_config('crm.moving_portfolio','',true);
 end if;
 -- Convites pendentes (válidos ou expirados) seguem a autoridade de quem os criou; a auditoria registra a exclusão.
 delete from public.invitations i where i.org_id=p_org and i.invited_by=p_user and i.accepted_at is null;
 get diagnostics v_invitations=row_count;
 insert into public.portfolio_transfers(org_id,from_user_id,to_user_id,performed_by,deactivation,accounts_transferred,deals,activities,contacts,companies,invitations)
  values(p_org,p_user,case when v_deals+v_activities+v_contacts+v_companies>0 then p_recipient end,auth.uid(),p_deactivation,p_accounts,
   v_deals,v_activities,v_contacts,v_companies,v_invitations);
 return query select v_deals,v_activities,v_contacts,v_companies,v_invitations;
 end;
$$;

-- 3. Gatilhos. O PostgreSQL dispara os gatilhos do mesmo momento em ordem alfabética do nome: o prefixo zz_ põe a
-- validação depois de todas as regras BEFORE da base (validate_deal_change, stamp_*, protect_*, refuse_*, guard_*,
-- touch_updated_at), e o gancho vê a linha como ela vai ser gravada, com closed_at, carimbos e totais; o gancho de
-- depois roda depois de audit_record_change, record_deal_change e run_deal_automations. Sem exclusão nesta versão.
create trigger zz_custom_validate before insert or update on public.contacts
 for each row execute function private.run_custom_validation();
create trigger zz_custom_validate before insert or update on public.companies
 for each row execute function private.run_custom_validation();
create trigger zz_custom_validate before insert or update on public.deals
 for each row execute function private.run_custom_validation();
create trigger zz_custom_validate before insert or update on public.activities
 for each row execute function private.run_custom_validation();
create trigger zz_custom_after_save after insert or update on public.contacts
 for each row execute function private.run_custom_after_save();
create trigger zz_custom_after_save after insert or update on public.companies
 for each row execute function private.run_custom_after_save();
create trigger zz_custom_after_save after insert or update on public.deals
 for each row execute function private.run_custom_after_save();
create trigger zz_custom_after_save after insert or update on public.activities
 for each row execute function private.run_custom_after_save();

-- 4. Impressão digital dos objetos. Permissões em texto ordenado, só dos papéis que a API usa (PUBLIC, anon,
-- authenticated e service_role): o dono e os papéis internos do Supabase variam entre o cluster local e o projeto
-- hospedado e não mudam o que a API alcança. MAINTAIN (PostgreSQL 17) fica de fora pelo mesmo motivo: só existe a
-- partir dessa versão e não é alcançável pela API. Toda ordenação usa a collation "C", para o texto não depender do
-- idioma do banco.
create function private.base_acl(p_acl aclitem[]) returns text
 language sql stable security invoker set search_path='' as $$
 select coalesce(string_agg(g.grantee||'='||g.privileges,',' order by g.grantee collate "C"),'')
 from (
  select e.grantee,string_agg(e.letter,'' order by strpos('arwdDxtXUCTc',e.letter)) as privileges
  from (
   select distinct case when a.grantee=0 then 'PUBLIC' else r.rolname::text end as grantee,
    case a.privilege_type when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd'
     when 'TRUNCATE' then 'D' when 'REFERENCES' then 'x' when 'TRIGGER' then 't' when 'EXECUTE' then 'X'
     when 'USAGE' then 'U' when 'CREATE' then 'C' when 'TEMPORARY' then 'T' when 'CONNECT' then 'c' end as letter
   from pg_catalog.aclexplode(case when pg_catalog.cardinality(p_acl)>0 then p_acl end) a
   left join pg_catalog.pg_roles r on r.oid=a.grantee
   where (a.grantee=0 or r.rolname in ('anon','authenticated','service_role')) and a.privilege_type<>'MAINTAIN'
  ) e
  group by e.grantee
 ) g
$$;

-- Uma linha por objeto de public e private (schemas, tabelas, views, colunas, restrições, índices, políticas, gatilhos e
-- funções), mais os gatilhos de qualquer tabela que chamem uma função desses schemas (os da base em auth.users e
-- auth.mfa_amr_claims) e as migrações do histórico do Supabase (supabase_migrations.schema_migrations), quando ele
-- existe; a linha migration_history diz se ele existe. Objetos de extensões ficam de fora. O search_path vazio deixa
-- todos os nomes qualificados, qualquer que seja o de quem chama (no editor do painel, public.deals sairia como deals).
-- body_hash: 16 caracteres do sha256 do corpo (o texto da migração, para funções, com CRLF trocado por LF; o texto do
-- pg_get_* para o resto); hash: 16 caracteres do sha256 das propriedades (jsonb::text, canônico) com o body_hash.
-- Sessenta e quatro bits bastam para notar uma mudança acidental; o check não é defesa contra quem é dono do banco.
create function private.base_fingerprints()
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
revoke execute on function private.base_acl(aclitem[]),private.base_fingerprints() from public,anon,authenticated,service_role;

-- 5. Guarda das migrações futuras. A tabela é da instância, não de uma organização: nunca passa pela API (sem privilégio
-- para nenhum papel dela, RLS ligada sem política, como private.email_proofs), é escrita só pelo editor SQL do painel e
-- lida só pela guarda, dentro da migração; por isso não tem org_id nem FK composta. O aceite fica preso ao hash do que
-- está no banco: se o objeto mudar de novo, o aceite antigo não vale. Linhas de aceite ficam como registro.
create table private.base_overwrite_consents(
 kind text not null,
 object text not null,
 live_hash text not null,
 consented_at timestamptz not null default now(),
 consented_by text not null default current_user,
 primary key(kind,object,live_hash),
 constraint base_overwrite_consents_kind check(kind in ('function','trigger','policy')),
 constraint base_overwrite_consents_live_hash check(live_hash ~ '^[0-9a-f]{16}$'),
 constraint base_overwrite_consents_object_length check(length(object) between 1 and 1000)
);
alter table private.base_overwrite_consents enable row level security;
revoke all on private.base_overwrite_consents from public,anon,authenticated,service_role;

-- Chamada no começo de toda migração da base posterior a esta que recria ou remove uma função, um gatilho ou uma
-- política da base (o teste de scripts/lib/base-manifest.test.mjs reprova a guarda esquecida quando o comando está no
-- texto da migração; o que ela recriar por SQL dinâmico, como um laço de execute format, fica com a revisão), com o hash do objeto em supabase/base-manifest.json antes da migração (docs/PROTECAO-ATUALIZACAO.md). Passa em
-- silêncio quando o objeto está como a base o deixou; passa com um aviso quando a substituição foi aceita para o hash
-- vivo; recusa o objeto ausente e o alterado sem aceite, com a mensagem que diz o que fazer. A recusa desfaz a migração
-- inteira (o db push aplica cada uma numa transação).
create function private.assert_base_definition(p_kind text, p_object text, p_expected text[]) returns void
 language plpgsql stable security invoker set search_path='' as $$
declare
 v_hash text;
 v_label text:=case p_kind when 'function' then 'esta função' when 'trigger' then 'este gatilho' when 'policy' then 'esta política' end;
 v_changed text:=case p_kind when 'function' then 'esta função foi alterada' when 'trigger' then 'este gatilho foi alterado'
  else 'esta política foi alterada' end;
 v_restore text:=case p_kind when 'function' then 'volte a função ao texto da base' when 'trigger' then 'volte o gatilho ao que a base criou'
  else 'volte a política ao que a base criou' end;
begin
 if v_label is null then raise exception 'assert_base_definition: tipo de objeto desconhecido (%). Use function, trigger ou policy.',p_kind; end if;
 select f.hash into v_hash from private.base_fingerprints() f where f.kind=p_kind and f.object=p_object;
 if v_hash is null then
  raise exception '%',format('A atualização vai substituir %s, mas %s não existe neste banco. Nada foi aplicado desta migração. Aplique antes as migrações da base que faltam (o supabase/db-drift-check.sql mostra quais) ou recrie o objeto pela migração que o criou e rode a atualização de novo.',
   p_object,v_label);
 end if;
 if v_hash=any(p_expected) then return; end if;
 if exists(select 1 from private.base_overwrite_consents c where c.kind=p_kind and c.object=p_object and c.live_hash=v_hash) then
  raise notice '%',format('A alteração feita nesta instância em %s foi substituída pela versão da base, com o aceite registrado em private.base_overwrite_consents.',p_object);
  return;
 end if;
 raise exception '%',format('A atualização vai substituir %s, mas %s nesta instância e a alteração seria perdida. Nada foi aplicado desta migração. Escolha um caminho: (1) mova a sua regra para um gancho private.custom_* (docs/PROTECAO-ATUALIZACAO.md) e %s; ou (2) aceite perder a alteração, rodando no editor SQL do painel: insert into private.base_overwrite_consents(kind, object, live_hash) values (%L, %L, %L); Depois, rode a atualização de novo.',
  p_object,v_changed,v_restore,p_kind,p_object,v_hash);
end $$;
revoke execute on function private.assert_base_definition(text,text,text[]) from public,anon,authenticated,service_role;
