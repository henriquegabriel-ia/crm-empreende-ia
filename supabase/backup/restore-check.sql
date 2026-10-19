-- Restauração de um backup do CRM (item 1.5; guia em docs/BACKUP-RESTAURACAO.md): conferência DEPOIS de carregar os
-- dados, ainda dentro da transação, antes de confirmar. Roda pelo `npm run backup:restore` ou pela alternativa com o
-- psql (o mesmo comando de supabase/backup/restore-prepare.sql). Não grava nada: só recusa, e a transação inteira é
-- desfeita, com o projeto vazio como estava.
--
-- O dump carrega os dados com `session_replication_role = replica`, que desliga os gatilhos e, com eles, a conferência
-- das chaves estrangeiras. Por isso, aqui:
--   - cada chave estrangeira de public e de private (inclusive as que apontam para auth.users) não pode ter linha órfã,
--     com a regra MATCH SIMPLE das chaves do CRM: uma linha com qualquer coluna da chave nula não aponta para nada e
--     não conta. Pega um dump parcial, com uma tabela deixada de fora;
--   - nenhum gatilho de usuário desligado em public, private, auth.users e auth.mfa_amr_claims;
--   - toda tabela de public com RLS ligada.
-- Os dois últimos vêm das migrações; a conferência protege contra um projeto preparado à mão.
--
-- Não é uma migração: este arquivo não vai para nenhuma instância e não entra no manifesto da base.
do $restore_check$
declare
 v_problems text[] := array[]::text[];
 v_fk record;
 v_orphans bigint;
 v_row record;
begin
 for v_fk in
  select c.conname,
   (select format('%I.%I', rn.nspname, r.relname) from pg_catalog.pg_class r
    join pg_catalog.pg_namespace rn on rn.oid = r.relnamespace where r.oid = c.conrelid) as child,
   (select format('%I.%I', rn.nspname, r.relname) from pg_catalog.pg_class r
    join pg_catalog.pg_namespace rn on rn.oid = r.relnamespace where r.oid = c.confrelid) as parent,
   (select string_agg(format('c.%I is not null', a.attname), ' and ' order by k.ordinality)
    from unnest(c.conkey) with ordinality k(attnum, ordinality)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as not_null,
   (select string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' and ' order by k.ordinality)
    from unnest(c.conkey, c.confkey) with ordinality k(child_attnum, parent_attnum, ordinality)
    join pg_catalog.pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = k.child_attnum
    join pg_catalog.pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.parent_attnum) as matches
  from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where c.contype = 'f' and n.nspname in ('public', 'private')
  order by 2, 1
 loop
  execute format('select count(*) from %s c where %s and not exists(select 1 from %s p where %s)',
   v_fk.child, v_fk.not_null, v_fk.parent, v_fk.matches) into v_orphans;
  if v_orphans > 0 then
   v_problems := v_problems || format('%s linha(s) de %s sem o registro de %s (chave %s)', v_orphans, v_fk.child, v_fk.parent, v_fk.conname);
  end if;
 end loop;
 for v_row in
  select format('%s.%s.%s', n.nspname, c.relname, t.tgname) as name
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and t.tgenabled = 'D'
   and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname in ('users', 'mfa_amr_claims')))
  order by 1
 loop
  v_problems := v_problems || format('gatilho desligado: %s', v_row.name);
 end loop;
 for v_row in
  select format('public.%s', c.relname) as name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  order by 1
 loop
  v_problems := v_problems || format('tabela sem RLS: %s', v_row.name);
 end loop;
 if cardinality(v_problems) > 0 then
  raise exception 'A conferência da restauração falhou e nada foi gravado: %.', array_to_string(v_problems, '; ');
 end if;
end $restore_check$;
