-- Restauração de um backup do CRM (item 1.5; guia em docs/BACKUP-RESTAURACAO.md): conferência ANTES de carregar os dados.
-- Roda dentro da transação da restauração, pelo `npm run backup:restore` ou pela alternativa com o psql
-- (`psql --single-transaction -v ON_ERROR_STOP=1 -f supabase/backup/restore-prepare.sql -f data.sql -f
-- supabase/backup/restore-check.sql`). Não grava nada: só recusa, e a transação inteira é desfeita.
--
-- Recusa:
--   - uma sessão vinda da API (com request.jwt.claims): a restauração roda só por uma conexão do papel postgres;
--   - um projeto que não está vazio: qualquer linha numa tabela de public ou de private (lidas pelo catálogo, então uma
--     tabela nova da base entra sozinha) ou qualquer conta em auth.users. A restauração nunca apaga nada; restaure num
--     projeto novo, logo depois do `npx supabase db push` e antes do primeiro acesso.
--
-- As tabelas que uma migração preenche num projeto novo entrariam em `v_seeded` (RESTORE_SEEDED_TABLES em
-- scripts/lib/backup-restore.mjs, com a mesma lista). Hoje nenhuma migração grava linha num projeto novo, e o test:db
-- reprova o dia em que alguma passar a gravar sem a lista ser decidida.
--
-- Não é uma migração: este arquivo não vai para nenhuma instância e não entra no manifesto da base.
do $restore_prepare$
declare
 v_seeded text[] := array[]::text[];
 v_busy text[] := array[]::text[];
 v_table record;
 v_has_rows boolean;
begin
 if coalesce(current_setting('request.jwt.claims', true), '') <> '' then
  raise exception 'A restauração roda só por uma conexão direta ao banco (papel postgres), nunca pela API do CRM.';
 end if;
 for v_table in
  select n.nspname as schema_name, c.relname as table_name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relispartition
  order by n.nspname, c.relname
 loop
  continue when format('%s.%s', v_table.schema_name, v_table.table_name) = any(v_seeded);
  execute format('select exists(select 1 from %I.%I)', v_table.schema_name, v_table.table_name) into v_has_rows;
  if v_has_rows then v_busy := v_busy || format('%s.%s', v_table.schema_name, v_table.table_name); end if;
 end loop;
 if exists(select 1 from auth.users) then v_busy := v_busy || 'auth.users'::text; end if;
 if cardinality(v_busy) > 0 then
  raise exception 'Este projeto não está vazio (%). A restauração nunca apaga dados: restaure num projeto Supabase novo, logo depois do db push e antes do primeiro acesso.',
   array_to_string(v_busy, ', ');
 end if;
end $restore_prepare$;
