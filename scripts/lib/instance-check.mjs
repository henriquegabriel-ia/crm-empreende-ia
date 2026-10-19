// Conferência mínima de uma instância (item 1.4; docs/arquitetura/1.4.md, seção 6): supabase/instance-check.sql, uma
// consulta só, só de leitura, para colar no editor SQL do painel do Supabase. Gerada a partir do manifesto da base
// (supabase/base-manifest.json) pelo `npm run manifest:build`, junto do manifesto e do db-drift-check.sql, e conferida
// pelo `npm run manifest:check`: cada migração nova da base atualiza a conferência sem ninguém lembrar dela.
//
// Diferente do db-drift-check.sql, que compara o banco inteiro e exige private.base_fingerprints(), esta consulta lê só
// o catálogo do PostgreSQL, auth.users e, por query_to_xml (que só roda quando a tabela existe), as tabelas da empresa e
// o histórico de migrações: num banco com migrações faltando, ela reprova o que falta em vez de parar com erro. As regras
// do manifesto que ela repete (o hash do corpo das funções, o texto das permissões de private.base_acl, inclusive as por
// coluna, e o comando, os papéis e o hash da expressão das políticas) são amarradas às da função pelo test:db
// (instanceCheckChecks), também com o search_path do editor do painel.
import { ManifestError, TRUE_RELOPTION_SQL } from './base-manifest.mjs';
import { SUPABASE_CLI_VERSION } from './supabase-config.mjs';

export const INSTANCE_CHECK_FILE = 'supabase/instance-check.sql';
export const DEPLOY_GUIDE_FILE = 'docs/IMPLANTACAO.md';
/** O tamanho máximo do arquivo gerado (AC-5): o editor SQL do painel aceita bem menos que o db-drift-check.sql. */
export const INSTANCE_CHECK_MAX_BYTES = 100 * 1024;
/** O papel que aplica as migrações; o test:db troca este trecho, que aparece uma vez só, por um papel sem TRIGGER. */
export const MIGRATION_ROLE_SQL = "'postgres'::name as migration_role";
/** O número de verificações que decidem o veredito (V1 a V14 da seção 6.3 do desenho). */
export const INSTANCE_CHECK_COUNT = 14;

/**
 * Funções que decidem acesso ou admissão (V9): o corpo, o SECURITY DEFINER e o search_path precisam ser os da base. Uma
 * função nova de segurança entra aqui no item que a cria (regra da seção 18 do desenho); uma assinatura que sumir do
 * manifesto faz o gerador falhar com o nome. As outras funções da base (as RPCs de public inclusive) têm conferidos só o
 * SECURITY DEFINER e o search_path, também na V9: uma RPC invoker trocada para definer passa por cima da RLS. Os ganchos
 * private.custom_* ficam de fora, porque são da instância (o corpo e a configuração deles mudam na personalização).
 */
export const CRITICAL_FUNCTIONS = Object.freeze([
  'private.current_org()',
  'private.can_write()',
  'private.can_manage()',
  'private.is_owner()',
  'private.signup_allowed(text)',
  'private.enforce_invite_only_signup()',
  'private.provision_organization(uuid,text)',
  'private.discard_unproven_password()',
  'private.record_email_proof()',
  'private.refuse_email_change_without_org()',
  'private.email_proven()',
  'private.instance_status()',
  'private.refuse_inactive_assignee()',
  // Quem promove ou rebaixa quem (o Dono inclusive) e a admissão pelo convite e pela primeira empresa.
  'private.role_change_allowed(text,text,text)',
  'private.set_member_role(uuid,text)',
  'private.handle_new_user()',
  'private.create_invitation(text,text)',
  'private.accept_invitation(uuid)',
  'private.create_workspace(text)',
]);
/**
 * As verificações que reprovam depois do remédio de emergência do apêndice A.9 do guia (o `drop function … cascade`
 * das três funções dos gatilhos do Auth): os gatilhos somem (V4), as permissões das funções ausentes também (V8) e as
 * funções da base faltam (V9). Achado 1 da revisão do 1.4, corrigido no 1.7b: o guia citava só duas. O test:db aplica o
 * remédio numa transação desfeita e confere exatamente estas; o Vitest confere que o A.9 cita cada uma.
 */
export const EMERGENCY_REMEDY_FAILED_CHECKS = Object.freeze(['Gatilhos', 'Permissões da API', 'Funções da base']);
/** O comando do remédio de emergência, igual ao do apêndice A.9 do guia (o deploy-guide.test.mjs confere). */
export const EMERGENCY_REMEDY_SQL =
  'drop function private.discard_unproven_password(), private.record_email_proof(), private.refuse_email_change_without_org() cascade';
/** Índices de que uma tela depende (V10): o da leitura dos lembretes do menu (item 1.12). */
export const REQUIRED_INDEXES = Object.freeze(['public.activities.activities_owner_pending']);

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;
const values = (rows) => rows.map((row) => `(${row.map(literal).join(', ')})`).join(',\n    ');
const objectsOf = (manifest, ...kinds) => manifest.objects.filter((object) => kinds.includes(object.kind));

/** Até 10 itens de um array de texto, separados por `separator`, com "e mais N". */
const listed = (array, separator = ', ') =>
  `pg_catalog.array_to_string((${array})[1:10], ${literal(separator)}) || case when pg_catalog.cardinality(${array}) > 10 then ' e mais ' || (pg_catalog.cardinality(${array}) - 10) else '' end`;

/** O texto das permissões dos papéis da API, com a mesma regra de private.base_acl (seção 6.2 do desenho). */
const aclText = (
  acl,
) => `coalesce((select pg_catalog.string_agg(g.grantee || '=' || g.privileges, ',' order by g.grantee collate "C")
      from (select e.grantee, pg_catalog.string_agg(e.letter, '' order by pg_catalog.strpos('arwdDxtXUCTc', e.letter)) as privileges
        from (select distinct case when a.grantee = 0 then 'PUBLIC' else r.rolname::text end as grantee,
            case a.privilege_type when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd'
              when 'TRUNCATE' then 'D' when 'REFERENCES' then 'x' when 'TRIGGER' then 't' when 'EXECUTE' then 'X'
              when 'USAGE' then 'U' when 'CREATE' then 'C' when 'TEMPORARY' then 'T' when 'CONNECT' then 'c' end as letter
          from pg_catalog.aclexplode(case when pg_catalog.cardinality(${acl}) > 0 then ${acl} end) a
          left join pg_catalog.pg_roles r on r.oid = a.grantee
          where (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role')) and a.privilege_type <> 'MAINTAIN') e
        group by e.grantee) g), '')`;

/**
 * Linhas de uma tabela que pode não existir (as da empresa, num banco sem migrações, e o histórico, que só existe num
 * projeto do Supabase): `query_to_xml` executa a consulta só quando `to_regclass` acha a tabela.
 */
const guardedRows = (
  table,
  query,
  columns,
) => `select x.* from (select pg_catalog.to_regclass(${literal(table)}) is not null as present) t
  cross join lateral xmltable('/table/row'
    passing case when t.present then pg_catalog.query_to_xml(${literal(query)}, false, false, '') end
    columns ${columns.map((column) => `${column} text path '${column}'`).join(', ')}) x`;

/**
 * As CTEs que leem o catálogo ao vivo: relations, functions (com a assinatura, o SECURITY DEFINER, o search_path e o hash
 * do corpo escritos como no manifesto), acl_objects e live_acl. Exportadas para o test:db conferir, objeto a objeto, que
 * elas dão o mesmo que private.base_fingerprints() e private.base_acl() num banco recém-migrado.
 */
export const LIVE_CATALOG_CTES = `relations as (
  select c.oid, n.nspname::text as schema_name, n.nspname || '.' || c.relname as object, c.relkind, c.relrowsecurity,
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner)) as acl,
    coalesce((select o.option_value from pg_catalog.pg_options_to_table(c.reloptions) o
      where o.option_name = 'security_invoker'), 'false') as security_invoker
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
    and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.objid = c.oid and d.deptype = 'e')
), functions as (
  -- A assinatura escrita como o manifesto (regprocedure com o search_path vazio), sem depender do search_path do editor.
  select p.oid, n.nspname::text as schema_name,
    pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(p.proname) || '(' || coalesce((
      select pg_catalog.string_agg(case when tn.nspname = 'pg_catalog' then pg_catalog.format_type(a.type_oid, null)
          else pg_catalog.quote_ident(tn.nspname) || '.' || pg_catalog.quote_ident(ty.typname) end, ',' order by a.ord)
      from pg_catalog.unnest(p.proargtypes::pg_catalog.oid[]) with ordinality as a(type_oid, ord)
      join pg_catalog.pg_type ty on ty.oid = a.type_oid
      join pg_catalog.pg_namespace tn on tn.oid = ty.typnamespace), '') || ')' as object,
    case when p.prosecdef then 'definer' else 'invoker' end as security,
    coalesce((select pg_catalog.string_agg(c, ', ' order by c collate "C") from pg_catalog.unnest(p.proconfig) c), '') as config,
    pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
      coalesce(nullif(p.prosrc, ''), pg_catalog.pg_get_function_sqlbody(p.oid)), E'\\r\\n', E'\\n'), 'UTF8')), 'hex'), 16) as body_hash,
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner)) as acl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and d.objid = p.oid and d.deptype = 'e')
), path_reset as (
  -- As expressões das políticas saem de pg_get_expr, que omite o schema do que está no search_path (no editor do painel,
  -- public). O search_path vazio, só nesta transação e sem gravar nada, deixa o texto igual ao de
  -- private.base_fingerprints(), que roda com search_path=''. A expressão lê done antes de pg_get_expr: a ordem é certa.
  select pg_catalog.set_config('search_path', '', true) as done
), live_policies as (
  select r.object as parent, r.object || '.' || p.polname as object,
    case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end as command,
    p.polpermissive::text as permissive,
    (select pg_catalog.string_agg(x.role, ',' order by x.role collate "C") from (
      select case when o = 0 then 'public' else (select rr.rolname::text from pg_catalog.pg_roles rr where rr.oid = o) end as role
      from pg_catalog.unnest(p.polroles) o) x) as roles,
    pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.replace(e.body, E'\\r\\n', E'\\n'), 'UTF8')), 'hex'), 16) as body_hash
  from relations r
  join pg_catalog.pg_policy p on p.polrelid = r.oid
  cross join path_reset s
  cross join lateral (select case when s.done is not null then 'USING: ' || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '')
    || E'\\nWITH CHECK: ' || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '') end as body) e
), live_column_acl as (
  select r.object as parent, r.object || '.' || a.attname as object, ${aclText('a.attacl')} as acl
  from relations r
  join pg_catalog.pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
), acl_objects as (
  select 'schema' as kind, n.nspname::text as object, coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner)) as acl
  from pg_catalog.pg_namespace n where n.nspname in ('public', 'private')
  union all
  select case when r.relkind in ('v', 'm') then 'view' else 'table' end, r.object, r.acl from relations r
  union all
  select 'function', f.object, f.acl from functions f
), live_acl as (
  select o.kind, o.object, ${aclText('o.acl')} as acl
  from acl_objects o
`;

const HEADER = (
  manifest,
) => `-- Conferência da instância do CRM (item 1.4). ARQUIVO GERADO por npm run manifest:build a partir de
-- supabase/base-manifest.json: não edite à mão. Base ${manifest.lastMigration}.
--
-- O que é: uma consulta só de leitura, que não grava nada. Confere o mínimo de segurança de uma instância: as migrações
-- da base aplicadas em ordem, a RLS ligada e as políticas das tabelas da base, nenhuma tabela, view ou função própria
-- aberta para a API, os gatilhos (inclusive os do Auth), o privilégio TRIGGER em auth.mfa_amr_claims, os privilégios
-- padrão, as permissões da API, as funções que decidem o acesso, o índice dos lembretes, uma empresa só e um dono ativo.
-- APROVADA é o mínimo de segurança, não a comparação do banco inteiro (essa é o supabase/db-drift-check.sql).
--
-- Como usar: copie o arquivo inteiro, cole no editor SQL do painel do Supabase (SQL Editor, New query), com o papel
-- padrão (postgres), e clique em Run. Não precisa de senha nem de chave.
--
-- Como ler: a primeira linha é o veredito, APROVADA ou REPROVADA. Cada verificação ocupa uma linha, aprovado ou
-- reprovado, com o que foi visto e o que fazer. As linhas de informação nunca mudam o veredito.
--
-- A configuração do Auth (a confirmação de e-mail, o cadastro e os provedores) não fica no banco: confira-a com
-- npm run verify-instance. Para comparar o banco inteiro com a base, depois de cada atualização ou personalização, use
-- supabase/db-drift-check.sql. Guia completo: ${DEPLOY_GUIDE_FILE}
`;

/**
 * O SQL da conferência. `demoPipelineId` é o id fixo do funil "Parcerias" do seed de demonstração (buildDemoDataset),
 * para a linha de informação. Lança ManifestError se uma função crítica ou um índice exigido não estiver no manifesto.
 */
export function renderInstanceCheck(manifest, { demoPipelineId } = {}) {
  const functions = new Map(objectsOf(manifest, 'function').map((object) => [object.object, object]));
  const critical = CRITICAL_FUNCTIONS.map((signature) => {
    const object = functions.get(signature);
    if (!object)
      throw new ManifestError(
        `A função crítica ${signature} não está no manifesto. Atualize CRITICAL_FUNCTIONS em scripts/lib/instance-check.mjs (assinatura nova ou função removida pela migração) e rode npm run manifest:build de novo.`,
      );
    return [signature, object.body ?? '', object.props.security ?? '', object.props.config ?? ''];
  });
  // As demais funções da base: só o SECURITY DEFINER e o search_path (o corpo fica para o db-drift-check.sql).
  const criticalSet = new Set(CRITICAL_FUNCTIONS);
  const baseFunctions = objectsOf(manifest, 'function')
    .filter((object) => !criticalSet.has(object.object))
    .map((object) => [object.object, object.props.security ?? '', object.props.config ?? '']);
  const indexes = new Set(objectsOf(manifest, 'index').map((object) => object.object));
  for (const index of REQUIRED_INDEXES)
    if (!indexes.has(index))
      throw new ManifestError(
        `O índice ${index} não está no manifesto. Atualize REQUIRED_INDEXES em scripts/lib/instance-check.mjs e rode npm run manifest:build de novo.`,
      );
  if (!demoPipelineId) throw new ManifestError('Falta o id do funil da demonstração (buildDemoDataset).');
  const migrations = manifest.migrations.map((migration) => [migration.version, migration.name]);
  const tables = objectsOf(manifest, 'table')
    .filter((object) => object.props.rls === true)
    .map((object) => [object.object]);
  const triggers = objectsOf(manifest, 'trigger').map((object) => [object.object, object.props.enabled]);
  const acls = objectsOf(manifest, 'schema', 'table', 'view', 'function', 'hook').map((object) => [
    object.kind === 'hook' ? 'function' : object.kind,
    object.object,
    object.props.acl ?? '',
  ]);
  const policies = objectsOf(manifest, 'policy').map((object) => [
    object.object,
    object.parent,
    object.props.command,
    String(object.props.permissive),
    object.props.roles ?? '',
    object.body ?? '',
  ]);
  // Só as colunas com permissão própria (as outras têm acl vazio): a V8 junta as duas pontas.
  const columnAcls = objectsOf(manifest, 'column')
    .filter((object) => object.props.acl)
    .map((object) => [object.object, object.props.acl]);
  const defaultAcls = objectsOf(manifest, 'default_acl').map((object) => [object.object, object.props.acl ?? '']);
  if (!tables.length || !triggers.length || !acls.length || !policies.length || defaultAcls.length !== 9)
    throw new ManifestError(
      'O manifesto não tem as tabelas, os gatilhos, as políticas, as permissões ou as nove linhas de privilégio padrão que a conferência da instância espera. Rode npm run manifest:build.',
    );
  const migrationCount = migrations.length;

  const query = `with params as (
  select ${MIGRATION_ROLE_SQL}
), expected_migrations(version, name) as (values
    ${values(migrations)}
), expected_tables(object) as (values
    ${values(tables)}
), expected_triggers(object, enabled) as (values
    ${values(triggers)}
), expected_acl(kind, object, acl) as (values
    ${values(acls)}
), expected_policies(object, parent, command, permissive, roles, body_hash) as (values
    ${values(policies)}
), expected_column_acl(object, acl) as (values
    ${values(columnAcls)}
), expected_default_acl(object, acl) as (values
    ${values(defaultAcls)}
), critical_functions(object, body_hash, security, config) as (values
    ${values(critical)}
), base_functions(object, security, config) as (values
    ${values(baseFunctions)}
), required_indexes(object) as (values
    ${values(REQUIRED_INDEXES.map((index) => [index]))}
), history as (
  select pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null as present
), live_migrations as (
  ${guardedRows(
    'supabase_migrations.schema_migrations',
    "select pg_catalog.to_jsonb(m)->>'version' as version, pg_catalog.to_jsonb(m)->>'name' as name from supabase_migrations.schema_migrations m",
    ['version', 'name'],
  )}
), organizations as (
  ${guardedRows('public.organizations', 'select o.id::text as id, o.name from public.organizations o', ['id', 'name'])}
), active_owners as (
  ${guardedRows(
    'public.user_roles',
    "select r.org_id::text as org_id, coalesce(u.email::text, r.user_id::text) as email from public.user_roles r left join auth.users u on u.id = r.user_id where r.role = 'owner' and pg_catalog.to_jsonb(r)->>'deactivated_at' is null",
    ['org_id', 'email'],
  )}
), demo_pipeline as (
  ${guardedRows('public.pipelines', `select p.id::text as id from public.pipelines p where p.id = '${demoPipelineId}'`, ['id'])}
), ${LIVE_CATALOG_CTES}
), live_default_acl as (
  select 'postgres/' || g.schema_label || '/' || t.label as object,
    ${aclText('coalesce(d.defaclacl, case when g.namespace = 0 then pg_catalog.acldefault(t.code, o.oid) end)')} as acl
  from pg_catalog.pg_roles o
  cross join (select 0::pg_catalog.oid as namespace, '*'::text as schema_label
    union all select n.oid, n.nspname::text from pg_catalog.pg_namespace n where n.nspname in ('public', 'private')) g
  cross join (values ('r'::"char", 'r'::"char", 'tables'::text), ('S', 's', 'sequences'), ('f', 'f', 'functions')) t(objtype, code, label)
  left join pg_catalog.pg_default_acl d on d.defaclrole = o.oid and d.defaclnamespace = g.namespace and d.defaclobjtype = t.objtype
  where o.rolname = 'postgres'
), live_triggers as (
  select n.nspname || '.' || c.relname || '.' || t.tgname as object, t.tgenabled::text as enabled
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
), applied as (
  select coalesce(max(e.version), '') as last_version
  from expected_migrations e where e.version in (select l.version from live_migrations l where l.version is not null)
), v1 as (
  select 1 as num, 'Migrações' as verificacao, array_remove(array[
      case when not h.present then 'As migrações não foram aplicadas pelo npx supabase@${SUPABASE_CLI_VERSION} db push (etapa 4 do guia): este banco não tem o histórico supabase_migrations.schema_migrations. Num projeto novo, rode o db push. Se as migrações foram coladas no editor SQL, peça ajuda a quem mantém a base.' end,
      (select case when count(*) > 0 then 'A migração ' || min(e.version || '_' || e.name) || case when count(*) > 1 then ' (e mais ' || (count(*) - 1) || ')' else '' end
          || ' falta, mas outras posteriores foram aplicadas: o banco foi montado fora de ordem. Não continue e peça ajuda a quem mantém a base.' end
        from expected_migrations e, applied a
        where h.present and e.version < a.last_version and e.version not in (select l.version from live_migrations l where l.version is not null)),
      (select case when count(*) > 0 then case when count(*) = 1 then 'Falta 1 migração da base, ' else 'Faltam ' || count(*) || ' migrações da base, a partir de ' end
          || min(e.version || '_' || e.name) || ': rode npx supabase@${SUPABASE_CLI_VERSION} db push (etapa 4 do guia).' end
        from expected_migrations e, applied a
        where h.present and e.version > a.last_version and e.version not in (select l.version from live_migrations l where l.version is not null)),
      (select 'A versão ' || pg_catalog.string_agg(e.version || ' está registrada como ' || l.name || ', e não como ' || e.name, ', a versão ' order by e.version)
          || '. O histórico não é o desta base: peça ajuda a quem mantém a base.'
        from expected_migrations e join live_migrations l on l.version = e.version
        -- O nome com a versão ou com o .sql (histórico gravado à mão a partir do nome do arquivo) vale como o mesmo.
        where l.name is not null and l.name not in (e.name, e.version || '_' || e.name, e.version || '_' || e.name || '.sql'))
    ], null) as problems,
    'As ${migrationCount} migrações da base estão no histórico, em ordem.' as ok_detail
  from history h
), v2 as (
  select 2 as num, 'RLS' as verificacao, array_remove(array[
      (select 'Ausentes: ' || ${listed('array_agg(e.object order by e.object collate "C")')}
          || '. Recrie cada uma pela migração que a criou, ou rode o supabase/db-drift-check.sql para ver o que mais falta.'
        from expected_tables e where not exists (select 1 from relations r where r.object = e.object)
        having count(*) > 0),
      (select 'RLS desligada em ' || ${listed('array_agg(r.object::text order by r.object collate "C")')}
          || ': qualquer pessoa com a chave pública lê e grava essas tabelas pela API, com os dados de toda a instância. Ligue de novo com alter table <tabela> enable row level security.'
        from expected_tables e join relations r on r.object = e.object and not r.relrowsecurity
        having count(*) > 0)
    ], null) as problems,
    'As ${tables.length} tabelas da base existem e estão com a RLS ligada.' as ok_detail
), v3 as (
  select 3 as num, 'Objetos abertos para a API' as verificacao, array_remove(array[
      (select 'Tabelas sem RLS e com permissões para anon, authenticated ou PUBLIC: ' || ${listed('array_agg(a.object order by a.object collate "C")')}
          || '. Qualquer pessoa com a chave pública lê ou grava essas tabelas pela API, sem login. Ligue a RLS (alter table <tabela> enable row level security) e crie as políticas por organização, ou revogue o acesso.'
        from relations r
        join live_acl a on a.kind = 'table' and a.object = r.object
        where r.schema_name = 'public' and r.relkind in ('r', 'p') and not r.relrowsecurity
          and a.acl ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*[arwd]'
        having count(*) > 0),
      (select 'Views sem security_invoker (ou materializadas) e com permissões para anon, authenticated ou PUBLIC: ' || ${listed('array_agg(a.object order by a.object collate "C")')}
          || '. A view lê as tabelas com as permissões de quem a criou, sem a RLS de quem consulta, e entrega os dados de toda a instância pela API. Recrie-a com with (security_invoker = true), ou revogue o acesso.'
        from relations r
        join live_acl a on a.kind = 'view' and a.object = r.object
        where r.schema_name = 'public' and (r.relkind = 'm' or lower(btrim(r.security_invoker)) not in ${TRUE_RELOPTION_SQL})
          and a.acl ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*[arwd]'
          and not exists (select 1 from expected_acl e where e.kind = 'view' and e.object = r.object)
        having count(*) > 0),
      (select 'Funções SECURITY DEFINER fora da base, executáveis por anon, authenticated ou PUBLIC: ' || ${listed('array_agg(a.object order by a.object collate "C")')}
          || '. Elas rodam com as permissões de quem as criou, sem a RLS: quem chama pela API lê ou grava o que a função alcançar. Torne-as security invoker, ou revogue o execute e chame a lógica a partir de uma função invoker que confere o papel.'
        from functions f
        join live_acl a on a.kind = 'function' and a.object = f.object
        where f.schema_name = 'public' and f.security = 'definer'
          and a.acl ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*X'
          and not exists (select 1 from expected_acl e where e.kind = 'function' and e.object = f.object)
        having count(*) > 0)
    ], null) as problems,
    'Nenhuma tabela de public sem RLS, view sem security_invoker ou função SECURITY DEFINER criada fora da base fica aberta para a API (as funções da base estão na verificação 9).' as ok_detail
), v4 as (
  select 4 as num, 'Gatilhos' as verificacao, array_remove(array[
      (select 'Ausentes: ' || ${listed('array_agg(e.object order by e.object collate "C")')}
          || '. Recrie cada um pela migração que o criou. Num projeto novo, rode o db push.'
        from expected_triggers e where not exists (select 1 from live_triggers l where l.object = e.object)
        having count(*) > 0),
      (select 'Com estado diferente do da base (desligado): ' || ${listed(
        "array_agg(e.object || ' (ligue com alter table ' || pg_catalog.regexp_replace(e.object, '\\.[^.]*$', '') || ' enable trigger ' || pg_catalog.regexp_replace(e.object, '^.*\\.', '') || ')' order by e.object collate \"C\")",
      )} || '. A regra que eles aplicam não está valendo.'
        from expected_triggers e join live_triggers l on l.object = e.object and l.enabled <> e.enabled
        having count(*) > 0)
    ], null) as problems,
    'Os ${triggers.length} gatilhos da base existem e estão ligados, inclusive os do Auth.' as ok_detail
), v5 as (
  select 5 as num, 'Gatilhos do Auth sem coluna' as verificacao,
    case when count(*) > 0 then array['Gatilhos do CRM em tabelas do Auth que citam ou dependem de uma coluna: ' || ${listed(
      "array_agg(n.nspname || '.' || c.relname || '.' || t.tgname order by t.tgname collate \"C\")",
    )}
      || '. Eles barram as migrações do Auth que mudam ou removem essa coluna (seção 16.9 do desenho do 1.1). Recrie-os sem UPDATE OF nem WHEN, com a condição dentro da função.'] else '{}' end as problems,
    'Nenhum gatilho do CRM nas tabelas do Auth cita ou depende de coluna.' as ok_detail
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where n.nspname = 'auth' and pn.nspname = 'private' and not t.tgisinternal
    and (t.tgqual is not null or pg_catalog.cardinality(t.tgattr::pg_catalog.int2[]) > 0
      or exists (select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_trigger'::pg_catalog.regclass and d.objid = t.oid
          and d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass and d.refobjsubid <> 0))
), v6 as (
  select 6 as num, 'Privilégio TRIGGER no Auth' as verificacao,
    case when coalesce(pg_catalog.has_table_privilege(p.migration_role, pg_catalog.to_regclass('auth.mfa_amr_claims'), 'TRIGGER'), false)
      then '{}'::text[] else array['O papel ' || p.migration_role || ' não tem o privilégio TRIGGER em auth.mfa_amr_claims. Sem ele, o gatilho record_email_proof não pode existir, e a prova do e-mail não é gravada: a admissão continua fechada, mas quem volta com senha precisa de um link novo para aceitar o convite. Abra um chamado no suporte do Supabase pedindo o privilégio.'] end as problems,
    'O papel ' || p.migration_role || ' tem o privilégio TRIGGER em auth.mfa_amr_claims.' as ok_detail
  from params p
), v7 as (
  select 7 as num, 'Privilégios padrão' as verificacao,
    case when count(l.object) > 0 then array['Objetos novos criados por postgres nascem com permissões para a API: ' || ${listed(
      "array_agg(l.object || ' (' || l.acl || ')' order by l.object collate \"C\")",
    )}
      || '. Uma tabela esquecida sem RLS ou uma função sem revoke ficaria aberta. Para fechar, rode no editor SQL alter default privileges for role postgres [in schema <schema>] revoke all on <tables, sequences ou functions> from public, anon, authenticated, service_role.'] else '{}' end as problems,
    'As nove linhas de privilégio padrão de postgres estão como na base, sem permissão para a API.' as ok_detail
  from expected_default_acl e
  left join live_default_acl l on l.object = e.object
  where l.acl is distinct from e.acl
), acl_differences as (
  select e.object, l.acl as live, e.acl as base
  from expected_acl e
  left join live_acl l on l.kind = e.kind and l.object = e.object
  where l.acl is distinct from e.acl
  union all
  -- As permissões por coluna das tabelas da base (grant select (coluna) ...), que valem mesmo sem a da tabela.
  select 'coluna ' || coalesce(e.object, l.object), coalesce(l.acl, ''), coalesce(e.acl, '')
  from expected_column_acl e
  full join (select c.object, c.acl from live_column_acl c
      where c.acl <> '' and exists (select 1 from expected_acl t where t.kind = 'table' and t.object = c.parent)) l
    on l.object = e.object
  where coalesce(l.acl, '') <> coalesce(e.acl, '')
), v8 as (
  select 8 as num, 'Permissões da API' as verificacao,
    case when count(*) > 0 then array['Permissões diferentes das da base: ' || ${listed(
      "array_agg(d.object || case when d.live is null then ' está ausente' else ' tem ' || coalesce(nullif(d.live, ''), 'nada') end || ' e a base, ' || coalesce(nullif(d.base, ''), 'nada') order by d.object collate \"C\")",
      '. ',
    )}
      || '. Volte cada objeto às permissões da base com grant e revoke (o ausente, pela migração que o criou). Uma permissão a mais para anon ou authenticated abre dados ou funções pela API.'] else '{}' end as problems,
    'Os schemas, as tabelas, as colunas e as funções da base têm as permissões da base para anon, authenticated, PUBLIC e service_role.' as ok_detail
  from acl_differences d
), function_differences as (
  select c.object, case when f.object is null then 'ausente' else pg_catalog.concat_ws(', ', case when f.body_hash <> c.body_hash then 'corpo diferente' end, case when f.security <> c.security then 'security ' || f.security || ' em vez de ' || c.security end, case when f.config <> c.config then 'configuração ' || coalesce(nullif(f.config, ''), 'vazia') || ' em vez de ' || c.config end) end as problem
  from critical_functions c
  left join functions f on f.object = c.object
  where f.object is null or f.body_hash <> c.body_hash or f.security <> c.security or f.config <> c.config
  union all
  -- As outras funções da base: a ausente já reprova nas Permissões da API (V8), e aqui ficam o security e o search_path.
  select b.object, pg_catalog.concat_ws(', ', case when f.security <> b.security then 'security ' || f.security || ' em vez de ' || b.security end, case when f.config <> b.config then 'configuração ' || coalesce(nullif(f.config, ''), 'vazia') || ' em vez de ' || b.config end)
  from base_functions b
  join functions f on f.object = b.object
  where f.security <> b.security or f.config <> b.config
), v9 as (
  select 9 as num, 'Funções da base' as verificacao,
    case when count(*) > 0 then array['Diferentes das da base: ' || ${listed(
      'array_agg(d.object || \': \' || d.problem order by d.object collate "C")',
      '. ',
    )}
      || '. A regra de segurança pode não estar valendo: uma função security definer roda sem a RLS de quem chama. Rode o supabase/db-drift-check.sql e volte cada uma à da base (alter function <função> security invoker, por exemplo), ou aplique as migrações que faltam.'] else '{}' end as problems,
    'As ${critical.length} funções que decidem o acesso e a admissão estão como na base, e as outras ${baseFunctions.length} funções da base têm o security e o search_path da base.' as ok_detail
  from function_differences d
), v10 as (
  select 10 as num, 'Índices de que telas dependem' as verificacao,
    case when count(*) > 0 then array['Ausente: ' || ${listed('array_agg(i.object order by i.object collate "C")')}
      || '. Os lembretes do menu ficam lentos com volume. Recrie pela migração que o criou.'] else '{}' end as problems,
    'O índice activities_owner_pending, da leitura dos lembretes, existe.' as ok_detail
  from required_indexes i
  where not exists (select 1 from pg_catalog.pg_index x
    join pg_catalog.pg_class ic on ic.oid = x.indexrelid
    join pg_catalog.pg_class tc on tc.oid = x.indrelid
    join pg_catalog.pg_namespace n on n.oid = tc.relnamespace
    where n.nspname || '.' || tc.relname || '.' || ic.relname = i.object)
), v11 as (
  select 11 as num, 'Empresa única' as verificacao,
    case when count(*) > 1 then array['Há ' || count(*) || ' empresas neste CRM: ' || ${listed('array_agg(o.name order by o.name collate "C")')}
      || '. Esta instância é de uma empresa só (decisão D6). Peça ajuda a quem mantém a base antes de continuar.'] else '{}' end as problems,
    case when count(*) = 0 then 'Nenhuma empresa ainda.' else 'Uma empresa só.' end as ok_detail
  from organizations o
), v12 as (
  select 12 as num, 'Dono ativo' as verificacao,
    case when count(*) > 0 then array['Sem nenhum dono ativo: ' || ${listed('array_agg(o.name order by o.name collate "C")')}
      || '. Ninguém administra este CRM: siga Recuperar o acesso de dono (docs/RECUPERAR-ACESSO-DONO.md).'] else '{}' end as problems,
    case when (select count(*) from organizations) = 0 then 'Nenhuma empresa ainda: o primeiro cadastro cria o dono.' else 'A empresa tem pelo menos um dono ativo.' end as ok_detail
  from organizations o
  where not exists (select 1 from active_owners a where a.org_id = o.id)
), v13 as (
  select 13 as num, 'Conferência do drift disponível' as verificacao,
    case when pg_catalog.to_regprocedure('private.base_fingerprints()') is null then array['A função private.base_fingerprints() não existe: o supabase/db-drift-check.sql não roda neste banco. Aplique as migrações da base (npx supabase@${SUPABASE_CLI_VERSION} db push).'] else '{}'::text[] end as problems,
    'A função private.base_fingerprints() existe: o supabase/db-drift-check.sql roda neste banco.' as ok_detail
), v14 as (
  select 14 as num, 'Políticas da base' as verificacao, array_remove(array[
      (select 'Ausentes: ' || ${listed('array_agg(e.object order by e.object collate "C")')}
          || '. Sem a política, a tabela deixa de responder para quem devia, ou outra política mais aberta passa a valer sozinha. Recrie pela migração que a criou.'
        from expected_policies e where not exists (select 1 from live_policies l where l.object = e.object)
        having count(*) > 0),
      (select 'Diferentes das da base: ' || ${listed(
        "array_agg(e.object || ': ' || pg_catalog.concat_ws(', ', case when l.body_hash <> e.body_hash then 'expressão (USING ou WITH CHECK) diferente' end, case when l.command <> e.command then 'comando ' || l.command || ' em vez de ' || e.command end, case when l.permissive <> e.permissive then case when l.permissive = 'true' then 'permissiva' else 'restritiva' end || ' em vez de ' || case when e.permissive = 'true' then 'permissiva' else 'restritiva' end end, case when l.roles is distinct from e.roles then 'papéis ' || coalesce(l.roles, 'nenhum') || ' em vez de ' || e.roles end) order by e.object collate \"C\")",
        '. ',
      )} || '. A regra de quem lê e grava cada linha pode não estar valendo. Volte cada uma à da base (o supabase/db-drift-check.sql mostra o detalhe).'
        from expected_policies e join live_policies l on l.object = e.object
        where l.body_hash <> e.body_hash or l.command <> e.command or l.permissive <> e.permissive or l.roles is distinct from e.roles
        having count(*) > 0),
      (select 'Políticas permissivas a mais em tabelas da base: ' || ${listed('array_agg(l.object order by l.object collate "C")')}
          || '. Uma política permissiva soma acesso ao das políticas da base: com using (true), qualquer conta lê as linhas de todas. Remova-a, ou troque-a por uma restritiva (as restritivas só tiram acesso).'
        from live_policies l
        where l.permissive = 'true' and not exists (select 1 from expected_policies e where e.object = l.object)
          and exists (select 1 from expected_tables t where t.object = l.parent)
        having count(*) > 0)
    ], null) as problems,
    'As ${policies.length} políticas das tabelas da base estão como na base, sem política permissiva a mais.' as ok_detail
), checks as (
  select num, verificacao, pg_catalog.cardinality(problems) > 0 as failed,
    case when pg_catalog.cardinality(problems) > 0 then pg_catalog.array_to_string(problems, ' ') else ok_detail end as detalhe
  from (select * from v1 union all select * from v2 union all select * from v3 union all select * from v4
    union all select * from v5 union all select * from v6 union all select * from v7 union all select * from v8
    union all select * from v9 union all select * from v10 union all select * from v11 union all select * from v12
    union all select * from v13 union all select * from v14) v
), infos as (
  select 1 as num, 'Empresa' as verificacao,
    case count(*) when 0 then 'Nenhuma empresa ainda: faça o primeiro cadastro logo depois de publicar (etapa 11 do guia).'
      when 1 then 'Uma empresa: ' || min(o.name) || '.'
      else count(*) || ' empresas: ' || ${listed('array_agg(o.name order by o.name collate "C")')} || '.' end as detalhe
  from organizations o
  union all
  select 2, 'Donos ativos',
    case when count(a.email) = 0 then 'Nenhum dono ativo.'
      else 'Donos ativos: ' || ${listed('array_agg(distinct a.email order by a.email)')}
        || '. Confira que é quem você esperava. Se não for, veja "Outra pessoa virou Dono" no guia de implantação.' end
  from active_owners a
  having (select count(*) from organizations) > 0
  union all
  select 3, 'Contas sem confirmação',
    case count(*) when 0 then 'Nenhuma conta sem confirmação de e-mail.'
      when 1 then '1 conta sem confirmação de e-mail.' else count(*) || ' contas sem confirmação de e-mail.' end
      || case when count(*) > 0 then ' É normal enquanto um convite não foi aceito. Para ver: select id, email, created_at from auth.users where email_confirmed_at is null' else '' end
  from auth.users u where u.email_confirmed_at is null
  union all
  select 4, 'Migrações próprias',
    'Migrações desta instância, fora da base: ' || ${listed("array_agg(l.version || coalesce('_' || l.name, '') order by l.version)")}
      || '. As de nome _custom_ são suas. As outras vieram de outra origem: mantenha os arquivos delas no repositório.'
  from live_migrations l
  where l.version is not null and l.version not in (select e.version from expected_migrations e)
  having count(*) > 0
  union all
  select 5, 'Dados de demonstração',
    'Esta instância tem os dados de demonstração. Nunca a use com dados reais sem rodar antes supabase/seed-demo-remove.sql.'
  from demo_pipeline
  having count(*) > 0
  union all
  select 6, 'Configuração do Auth',
    'A configuração do Auth não fica no banco: confira a confirmação de e-mail, o cadastro e os provedores com npm run verify-instance (etapa 10 do guia).'
  union all
  select 7, 'Conferência completa (drift)',
    'Para comparar o banco inteiro com a base, depois de cada atualização ou personalização, cole supabase/db-drift-check.sql no editor SQL (docs/PROTECAO-ATUALIZACAO.md, seção 5).'
), result as (
  select 0 as ordem, 0 as num,
    case when exists (select 1 from checks where failed) then 'REPROVADA' else 'APROVADA' end as resultado,
    'Veredito' as verificacao,
    case when exists (select 1 from checks where failed)
      then (select case count(*) when 1 then '1 verificação reprovada: ' else count(*) || ' verificações reprovadas: ' end
          || pg_catalog.string_agg(verificacao, ', ' order by num) || '. Corrija cada linha reprovado e rode esta conferência de novo.'
        from checks where failed)
      else '${INSTANCE_CHECK_COUNT} verificações aprovadas. Base ${manifest.lastMigration}.' end as detalhe
  union all
  select case when failed then 1 else 2 end, num, case when failed then 'reprovado' else 'aprovado' end, verificacao, detalhe
  from checks
  union all
  select 3, num, 'informação', verificacao, detalhe from infos
)
select r.resultado, r.verificacao, r.detalhe
from result r
order by r.ordem, r.num;
`;
  return `${HEADER(manifest)}${query}`;
}

/** O texto que a consulta executa: sem comentários e sem literais (para conferir que não grava nada). */
export function instanceCheckCode(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
}

/** Palavras que a consulta nunca usa fora de literais e comentários (AC-5): ela só lê. */
export const WRITE_WORDS = Object.freeze([
  'insert',
  'update',
  'delete',
  'create',
  'alter',
  'drop',
  'grant',
  'revoke',
  'truncate',
  'copy',
  'set',
  'do',
]);
