// Manifesto da base e check de drift (item 1.13; docs/arquitetura/1.13.md, seções 5 a 8). Funções puras, testadas no
// Vitest (base-manifest.test.mjs); o processo que sobe o cluster embutido e grava os arquivos fica em
// scripts/build-base-manifest.mjs (npm run manifest:build e manifest:check).
//
// A impressão digital de cada objeto (propriedades e hash do corpo) é calculada dentro do banco, por
// private.base_fingerprints() (supabase/migrations/20261019110000_update_protection.sql): a mesma regra vale para o
// manifesto gerado aqui, para o check colado no painel e para a guarda das migrações futuras. Este arquivo só classifica,
// ordena e escreve; nunca recalcula um hash.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_FILE = 'supabase/base-manifest.json';
export const DRIFT_CHECK_FILE = 'supabase/db-drift-check.sql';
export const GUIDE_FILE = 'docs/PROTECAO-ATUALIZACAO.md';
/** A migração que cria os ganchos e a guarda; as migrações da base posteriores a ela seguem as regras da seção 8.4. */
export const UPDATE_PROTECTION_MIGRATION = '20261019110000_update_protection.sql';
export const MANIFEST_FORMAT = 1;
/** Os oito ganchos da base, criados uma única vez pela migração do item 1.13 e nunca recriados, trocados ou removidos. */
export const HOOK_SIGNATURES = Object.freeze([
  'private.custom_after_activity_saved(public.activities,public.activities)',
  'private.custom_after_company_saved(public.companies,public.companies)',
  'private.custom_after_contact_saved(public.contacts,public.contacts)',
  'private.custom_after_deal_saved(public.deals,public.deals)',
  'private.custom_validate_activity(public.activities,public.activities)',
  'private.custom_validate_company(public.companies,public.companies)',
  'private.custom_validate_contact(public.contacts,public.contacts)',
  'private.custom_validate_deal(public.deals,public.deals)',
]);
export const HOOK_NAMES = Object.freeze(HOOK_SIGNATURES.map((signature) => signature.slice(8, signature.indexOf('('))));
const MANIFEST_MARKER = '$manifest$';
const MIGRATION_FILE = /^(\d{14})_([A-Za-z0-9_]+)\.sql$/;
/**
 * Migração de quem personaliza uma instância: `<14 dígitos>_custom_<nome>.sql` (docs/PROTECAO-ATUALIZACAO.md, seção 4).
 * O manifesto, o manifest:check, as regras sobre os arquivos e o test:db conferem só as migrações da base e ignoram
 * estas; o gen:types e o db push aplicam todas. A base nunca dá esse nome a uma migração dela.
 * Achado 3 da revisão do 1.13: uma migração listada no manifesto da base (`baseMigrations`, nomes de arquivo como os de
 * `readBaseMigrationNames`) nunca é tratada como `_custom_`, seja qual for o nome; e, no repositório da base, a
 * variável `CRM_BASE_REPOSITORY=true` recusa qualquer `_custom_` (`baseRepositoryProblems`).
 */
const CUSTOM_MIGRATION = /^\d{14}_custom_/i;
export const isCustomMigration = (file, baseMigrations = []) =>
  CUSTOM_MIGRATION.test(file) && !baseMigrations.includes(file);
/** Só as migrações da base, sem as `_custom_` de quem personaliza. */
export const baseMigrationFiles = (files, baseMigrations = []) =>
  files.filter((file) => !isCustomMigration(file, baseMigrations));
/** As migrações `_custom_` de `files` (em ordem), com a mesma regra de `isCustomMigration`. */
export const customMigrationsIn = (files, baseMigrations = []) =>
  files.filter((file) => file.endsWith('.sql') && isCustomMigration(file, baseMigrations));
const MANIFEST_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', MANIFEST_FILE);
/** Os nomes de arquivo das migrações listadas no manifesto versionado; lista vazia se ele não existe ou não é lido. */
export function readBaseMigrationNames(file = MANIFEST_PATH) {
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    return (manifest.migrations ?? []).map((migration) => `${migration.version}_${migration.name}.sql`);
  } catch {
    return [];
  }
}
export const BASE_REPOSITORY_VARIABLE = 'CRM_BASE_REPOSITORY';
/**
 * No repositório da base (variável `CRM_BASE_REPOSITORY=true`, configurada pelo @devops só nas variáveis do repositório
 * do programa e do dono, nunca no código, para não valer nos clones), qualquer migração `_custom_` é um erro: o
 * manifest:build, o manifest:check e o test:db recusam antes de subir o banco.
 */
export function baseRepositoryProblems(files, env = process.env) {
  if (env[BASE_REPOSITORY_VARIABLE] !== 'true') return [];
  const custom = files.filter((file) => file.endsWith('.sql') && CUSTOM_MIGRATION.test(file));
  return custom.length
    ? [`A base nunca usa o prefixo custom_ (reservado a quem personaliza). Renomeie a migração: ${custom.join(', ')}.`]
    : [];
}
/**
 * Os blocos ```sql do guia [Personalizar sem quebrar a atualização] que citam `custom_`: os exemplos que o Vitest passa
 * pelas regras dos arquivos e que o test:db aplica num banco como uma migração `_custom_` (achado 1 da revisão do 1.13).
 */
export function customizationGuideExamples(guide) {
  return [...guide.replace(/\r\n/g, '\n').matchAll(/```sql\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .filter((block) => /custom_/.test(block));
}
const HOOK_OBJECT = /^private\.custom_[a-z0-9_]+\(/;
export const KINDS = Object.freeze(['schema', 'table', 'view', 'column', 'constraint', 'index', 'policy', 'trigger']);

export class ManifestError extends Error {}

// Comparação simples de código (e não Intl): a mesma ordem em qualquer máquina e idioma.
export const compareCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const sortKeys = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort(compareCode)
          .map((key) => [key, sortKeys(value[key])]),
      )
    : value;

/**
 * Versão e nome de cada migração da base, pelos nomes dos arquivos de supabase/migrations (o cluster local não tem
 * histórico). As migrações `_custom_` de quem personaliza ficam de fora.
 */
export function migrationsFromFiles(files, baseMigrations = []) {
  return baseMigrationFiles(files, baseMigrations)
    .filter((file) => file.endsWith('.sql'))
    .sort(compareCode)
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match)
        throw new ManifestError(
          `Nome de migração fora do padrão <14 dígitos>_<nome>.sql: ${file}. Renomeie o arquivo antes de gerar o manifesto.`,
        );
      return { version: match[1], name: match[2] };
    });
}

/**
 * O manifesto, a partir das linhas de private.base_fingerprints() no cluster embutido com todas as migrações. Toda
 * função private.custom_* vira `hook`: o check confere a assinatura e as permissões de um gancho, nunca o corpo. Uma
 * linha `migration` (ou o histórico presente) é sinal de banco errado: o manifesto descreve as migrações pelos arquivos.
 */
export function buildManifest({ rows, migrationFiles, postgresMajor, baseMigrations = [] }) {
  const objects = [];
  for (const row of rows) {
    if (row.kind === 'migration' || (row.kind === 'migration_history' && row.props?.present)) {
      throw new ManifestError(
        'O banco usado para gerar o manifesto tem supabase_migrations.schema_migrations. O manifesto só é gerado no PostgreSQL descartável de npm run manifest:build, nunca num projeto do Supabase.',
      );
    }
    if (row.kind === 'migration_history') continue;
    if (row.kind !== 'function' && !KINDS.includes(row.kind))
      throw new ManifestError(`Tipo de objeto desconhecido em private.base_fingerprints(): ${row.kind}`);
    objects.push({
      kind: row.kind === 'function' && HOOK_OBJECT.test(row.object) ? 'hook' : row.kind,
      object: row.object,
      parent: row.parent ?? null,
      props: sortKeys(row.props ?? {}),
      body: row.body_hash ?? null,
      hash: row.hash,
    });
  }
  objects.sort((a, b) => compareCode(a.kind, b.kind) || compareCode(a.object, b.object));
  for (let index = 1; index < objects.length; index += 1) {
    const [previous, current] = [objects[index - 1], objects[index]];
    if (previous.kind === current.kind && previous.object === current.object)
      throw new ManifestError(`Objeto repetido em private.base_fingerprints(): ${current.kind} ${current.object}`);
  }
  const migrations = migrationsFromFiles(migrationFiles, baseMigrations);
  if (!migrations.length) throw new ManifestError('Nenhuma migração em supabase/migrations.');
  const last = migrations.at(-1);
  return {
    format: MANIFEST_FORMAT,
    postgres: postgresMajor,
    lastMigration: `${last.version}_${last.name}.sql`,
    migrations,
    hooks: objects.filter((object) => object.kind === 'hook').map((object) => object.object),
    objects,
  };
}

const list = (items, indent = '    ') =>
  items.map((item, index) => `${indent}${JSON.stringify(item)}${index < items.length - 1 ? ',' : ''}`);

/** O JSON do manifesto, um objeto por linha (o diff de um commit mostra só o que mudou), LF e sem data. */
export function renderManifest(manifest) {
  const objects = manifest.objects.map(({ kind, object, parent, props, body, hash }) => ({
    kind,
    object,
    parent,
    props,
    body,
    hash,
  }));
  return [
    '{',
    `  "format": ${manifest.format},`,
    `  "postgres": ${manifest.postgres},`,
    `  "lastMigration": ${JSON.stringify(manifest.lastMigration)},`,
    '  "migrations": [',
    ...list(manifest.migrations),
    '  ],',
    '  "hooks": [',
    ...list(manifest.hooks),
    '  ],',
    '  "objects": [',
    ...list(objects),
    '  ]',
    '}',
    '',
  ].join('\n');
}

/** Problemas da regra do prefixo custom_ (seção 7.4): só os oito ganchos usam o prefixo na base. */
export function reservedPrefixProblems(manifest) {
  const problems = [];
  const hooks = new Set(manifest.hooks);
  for (const signature of HOOK_SIGNATURES)
    if (!hooks.has(signature)) problems.push(`gancho ausente no manifesto: ${signature}`);
  for (const hook of manifest.hooks)
    if (!HOOK_SIGNATURES.includes(hook))
      problems.push(`função com o prefixo custom_ fora dos oito ganchos da base: ${hook}`);
  for (const { kind, object } of manifest.objects) {
    if (kind === 'hook') continue;
    const name =
      kind === 'function' ? object.slice(object.indexOf('.') + 1, object.indexOf('(')) : object.split('.').at(-1);
    if (name.startsWith('custom_'))
      problems.push(`${kind} da base com o prefixo custom_, reservado a quem personaliza: ${object}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Regras sobre os arquivos de supabase/migrations (seções 7.4 e 8.4), sobre o texto sem comentários.
// ---------------------------------------------------------------------------------------------
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versionOf = (name) => name.slice(0, 14);

/**
 * Problemas do contrato dos ganchos e da guarda, em `files` (`{ name, text }`, todas as migrações; as `_custom_` de
 * quem personaliza ficam de fora):
 * - cada gancho é criado por um único `create function` (nunca `create or replace`, `alter function` nem `drop
 *   function`), e nenhuma outra função private.custom_* é criada pela base;
 * - numa migração posterior a 20261019110000_update_protection.sql, recriar ou remover uma função ou um gatilho criado
 *   por uma migração anterior exige, antes, no mesmo arquivo, private.assert_base_definition com o mesmo objeto;
 * - na mesma migração posterior, `drop policy` e `alter policy` numa política que o arquivo não criou antes exigem a
 *   guarda da política (`schema.tabela.nome`). Recriar uma política passa por um deles, porque não existe `create or
 *   replace policy`; a regra vale também para as políticas criadas em laço (execute format) pelas migrações antigas.
 *   O que a própria migração recriar por SQL dinâmico não aparece no texto e fica com a revisão.
 */
export function migrationContractProblems(files, baseMigrations = []) {
  const problems = [];
  const sorted = files
    .filter((file) => !isCustomMigration(file.name, baseMigrations))
    .sort((a, b) => compareCode(a.name, b.name));
  const hookCreations = new Map();
  const createdFunctions = new Map();
  const createdTriggers = new Map();
  const protectionVersion = versionOf(UPDATE_PROTECTION_MIGRATION);
  for (const file of sorted) {
    const text = stripComments(file.text);
    for (const match of text.matchAll(
      /\b(create\s+or\s+replace\s+function|create\s+function|alter\s+function|drop\s+function(?:\s+if\s+exists)?)\s+private\.(custom_\w+)\s*\(/gi,
    )) {
      const statement = match[1].toLowerCase().replace(/\s+/g, ' ');
      const name = match[2].toLowerCase();
      if (!HOOK_NAMES.includes(name)) {
        problems.push(
          `${file.name}: private.${name} usa o prefixo custom_, reservado a quem personaliza (só os oito ganchos são da base)`,
        );
        continue;
      }
      if (statement !== 'create function')
        problems.push(
          `${file.name}: "${statement}" no gancho private.${name}. A base nunca recria, troca nem remove um gancho; gancho novo é função nova.`,
        );
      else hookCreations.set(name, [...(hookCreations.get(name) ?? []), file.name]);
    }
    if (versionOf(file.name) > protectionVersion) {
      const guarded = (kind, object, position) =>
        new RegExp(`assert_base_definition\\s*\\(\\s*'${kind}'\\s*,\\s*'${escapeRegExp(object)}`, 'i').test(
          text.slice(0, position),
        );
      for (const match of text.matchAll(
        /\b(?:create\s+or\s+replace|drop)\s+function(?:\s+if\s+exists)?\s+(\w+)\.(\w+)\s*\(/gi,
      )) {
        const object = `${match[1]}.${match[2]}`.toLowerCase();
        // Os ganchos têm a regra própria acima: nunca são recriados, nem com a guarda.
        if (object.startsWith('private.custom_')) continue;
        if (createdFunctions.has(object) && !guarded('function', `${object}(`, match.index))
          problems.push(
            `${file.name}: recria ou remove ${object}, criada por ${createdFunctions.get(object)}, sem chamar antes private.assert_base_definition('function', '${object}(...)', array['<hash do manifesto>'])`,
          );
      }
      for (const match of text.matchAll(
        /\b(?:create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(\w+)\s[\s\S]*?\bon\s+(\w+)\.(\w+)|drop\s+trigger(?:\s+if\s+exists)?\s+(\w+)\s+on\s+(\w+)\.(\w+))/gi,
      )) {
        const object = (
          match[1] ? `${match[2]}.${match[3]}.${match[1]}` : `${match[5]}.${match[6]}.${match[4]}`
        ).toLowerCase();
        if (createdTriggers.has(object) && !guarded('trigger', object, match.index))
          problems.push(
            `${file.name}: recria ou remove o gatilho ${object}, criado por ${createdTriggers.get(object)}, sem chamar antes private.assert_base_definition('trigger', '${object}', array['<hash do manifesto>'])`,
          );
      }
      const policiesCreatedHere = new Set();
      for (const match of text.matchAll(
        /\b(create|drop|alter)\s+policy(?:\s+if\s+exists)?\s+"?(\w+)"?\s+on\s+(\w+)\.(\w+)/gi,
      )) {
        const object = `${match[3]}.${match[4]}.${match[2]}`.toLowerCase();
        if (match[1].toLowerCase() === 'create') {
          policiesCreatedHere.add(object);
          continue;
        }
        if (!policiesCreatedHere.has(object) && !guarded('policy', object, match.index))
          problems.push(
            `${file.name}: "${match[1].toLowerCase()} policy" em ${object}, uma política da base, sem chamar antes private.assert_base_definition('policy', '${object}', array['<hash do manifesto>'])`,
          );
      }
    }
    for (const match of text.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(\w+)\.(\w+)\s*\(/gi)) {
      const object = `${match[1]}.${match[2]}`.toLowerCase();
      if (!createdFunctions.has(object)) createdFunctions.set(object, file.name);
    }
    for (const match of text.matchAll(
      /\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(\w+)\s[\s\S]*?\bon\s+(\w+)\.(\w+)/gi,
    )) {
      const object = `${match[2]}.${match[3]}.${match[1]}`.toLowerCase();
      if (!createdTriggers.has(object)) createdTriggers.set(object, file.name);
    }
  }
  for (const name of HOOK_NAMES) {
    const creations = hookCreations.get(name) ?? [];
    if (creations.length !== 1)
      problems.push(
        `o gancho private.${name} precisa ser criado por um único create function (encontrado em ${creations.length ? creations.join(', ') : 'nenhuma migração'})`,
      );
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// O check de drift (seção 6): uma consulta só, só de leitura, com o manifesto embutido, para colar no editor SQL do
// painel. Nenhum ponto e vírgula fora do fim (nem em comentários e textos), para a consulta rodar inteira em qualquer
// editor.
// ---------------------------------------------------------------------------------------------
const DRIFT_CHECK_HEADER = (
  manifest,
) => `-- Conferência de drift do CRM (item 1.13). Gerado por npm run manifest:build a partir de supabase/migrations.
-- Não edite este arquivo: ele traz embutido o manifesto da base (supabase/base-manifest.json) da versão
-- ${manifest.lastMigration} e compara o banco em que roda com ele.
--
-- O que é: uma consulta só de leitura, que não grava nada. Cole o arquivo inteiro no editor SQL do painel do Supabase
-- (SQL Editor, New query) e rode. Não precisa de senha nem de chave: usa a sessão de quem já administra o projeto.
-- Pelo terminal, também funciona com psql -f supabase/db-drift-check.sql e a string de conexão do painel (digitada na
-- hora, nunca gravada em arquivo). Exige a migração ${UPDATE_PROTECTION_MIGRATION} aplicada no banco.
--
-- Como ler o resultado, uma linha por diferença:
-- - gravidade: resumo, atenção (o que uma atualização pode apagar ou quebrar) ou informação (nada a fazer)
-- - situacao: resumo, alterado (objeto da base mudado à mão), ausente (objeto ou migração da base que falta),
--   gancho (um gancho private.custom_* com corpo próprio) ou extra (objeto ou migração fora da base)
-- - tipo, objeto e detalhe: o que difere e o que fazer
-- Antes de atualizar, rode o arquivo da versão instalada. Depois de aplicar as migrações novas, rode o da versão nova:
-- só o resumo e os extras desta instância devem sobrar. Guia completo: ${GUIDE_FILE}
`;

const DRIFT_CHECK_QUERY = `with manifest_doc as (
  select $manifest$__MANIFEST__$manifest$::jsonb as doc
), manifest as (
  select m.kind as manifest_kind, case when m.kind = 'hook' then 'function' else m.kind end as kind, m.object, m.parent,
    m.props, m.body, m.hash
  from manifest_doc d
  cross join lateral jsonb_to_recordset(d.doc -> 'objects')
    as m(kind text, object text, parent text, props jsonb, body text, hash text)
), fingerprints as materialized (
  select f.kind, f.object, f.parent, f.props, f.body_hash, f.hash from private.base_fingerprints() f
), live as (
  select f.kind, f.object, f.parent, f.props, f.body_hash as body, f.hash
  from fingerprints f
  where f.kind not in ('migration', 'migration_history')
), compared as (
  select coalesce(m.kind, l.kind) as kind, coalesce(m.object, l.object) as object, coalesce(m.parent, l.parent) as parent,
    m.manifest_kind, m.props as base_props, m.body as base_body, m.hash as base_hash,
    l.props as live_props, l.body as live_body, l.hash as live_hash,
    m.object is not null as in_base, l.object is not null as in_live
  from manifest m
  full join live l on l.kind = m.kind and l.object = m.object
), extra_tables as (
  select c.object from compared c where c.kind in ('table', 'view') and not c.in_base
), missing_tables as (
  select c.object from compared c where c.kind in ('table', 'view') and not c.in_live
), named as (
  select c.*,
    case when c.kind = 'function' then split_part(split_part(c.object, '(', 1), '.', 2)
      else regexp_replace(c.object, '^.*\\.', '') end as short_name,
    case c.kind when 'function' then 'função' when 'trigger' then 'gatilho' when 'policy' then 'política'
      when 'table' then 'tabela' when 'view' then 'view' when 'column' then 'coluna' when 'constraint' then 'restrição'
      when 'index' then 'índice' when 'schema' then 'schema' else c.kind end as tipo,
    (select array_to_string(array_remove(array[
        case count(*) filter (where k.kind = 'column') when 0 then null when 1 then '1 coluna'
          else count(*) filter (where k.kind = 'column') || ' colunas' end,
        case count(*) filter (where k.kind = 'constraint') when 0 then null when 1 then '1 restrição'
          else count(*) filter (where k.kind = 'constraint') || ' restrições' end,
        case count(*) filter (where k.kind = 'index') when 0 then null when 1 then '1 índice'
          else count(*) filter (where k.kind = 'index') || ' índices' end,
        case count(*) filter (where k.kind = 'policy') when 0 then null when 1 then '1 política'
          else count(*) filter (where k.kind = 'policy') || ' políticas' end,
        case count(*) filter (where k.kind = 'trigger') when 0 then null when 1 then '1 gatilho'
          else count(*) filter (where k.kind = 'trigger') || ' gatilhos' end], null), ', ')
      from compared k where k.parent = c.object
        and ((not c.in_base and not k.in_base) or (not c.in_live and not k.in_live))) as children
  from compared c
), differences as (
  select n.*,
    (select string_agg(
        case
          when d.key = 'acl' then 'Permissões: ' || concat_ws(' e ',
            (select nullif(string_agg(x, ', ' order by x collate "C"), '') || ' a mais'
              from unnest(string_to_array(n.live_props ->> 'acl', ',')) x
              where x <> all(coalesce(string_to_array(n.base_props ->> 'acl', ','), '{}'))),
            (select nullif(string_agg(x, ', ' order by x collate "C"), '') || ' a menos'
              from unnest(string_to_array(n.base_props ->> 'acl', ',')) x
              where x <> all(coalesce(string_to_array(n.live_props ->> 'acl', ','), '{}'))))
          else d.label || ': ' || d.before || ' → ' || d.after
        end, '. ' order by d.key collate "C")
      from (
        select k.key,
          case k.key when 'rls' then 'RLS' when 'force_rls' then 'RLS forçada' when 'security' then 'Segurança'
            when 'volatility' then 'Volatilidade' when 'strict' then 'Strict' when 'config' then 'Configuração'
            when 'returns' then 'Retorno' when 'args' then 'Argumentos' when 'language' then 'Linguagem'
            when 'kind' then 'Tipo de rotina' when 'type' then 'Tipo' when 'not_null' then 'Obrigatória (not null)'
            when 'generated' then 'Gerada' when 'identity' then 'Identidade' when 'command' then 'Comando'
            when 'permissive' then 'Permissiva' when 'roles' then 'Papéis' when 'enabled' then 'Estado'
            when 'security_invoker' then 'security_invoker' else k.key end as label,
          coalesce(case n.base_props ->> k.key when 'true' then 'sim' when 'false' then 'não' when '' then null
            when 'O' then case when k.key = 'enabled' then 'ligado' else 'O' end
            when 'D' then case when k.key = 'enabled' then 'desligado' else 'D' end
            else n.base_props ->> k.key end, '(nenhum)') as before,
          coalesce(case n.live_props ->> k.key when 'true' then 'sim' when 'false' then 'não' when '' then null
            when 'O' then case when k.key = 'enabled' then 'ligado' else 'O' end
            when 'D' then case when k.key = 'enabled' then 'desligado' else 'D' end
            else n.live_props ->> k.key end, '(nenhum)') as after
        from (select jsonb_object_keys(n.base_props) as key
          union select jsonb_object_keys(n.live_props)) k
        where n.base_props -> k.key is distinct from n.live_props -> k.key
      ) d) as props_diff
  from named n
), objects as (
  -- Alterado: objeto da base com outra impressão digital (o gancho só pela assinatura e pelas permissões).
  select 2 as ordem, 'atenção' as gravidade, 'alterado' as situacao, d.tipo, d.object as objeto,
    concat_ws(' ',
      case when d.kind = 'trigger' and d.live_props ->> 'enabled' = 'D' and d.base_props ->> 'enabled' <> 'D'
        then 'Gatilho desligado. A regra que ele aplica não está valendo. Ligue de novo com alter table ' || d.parent
          || ' enable trigger ' || d.short_name || '.'
        when d.props_diff is not null then d.props_diff || '.' end,
      case when d.manifest_kind = 'hook' then null
        when d.base_body is distinct from d.live_body then case d.kind
          when 'function' then 'Corpo diferente do da base.'
          when 'policy' then 'Expressão (USING ou WITH CHECK) diferente da da base.'
          when 'column' then 'Padrão (default) diferente do da base.'
          else 'Definição diferente da da base.' end end,
      case when d.manifest_kind = 'hook'
          then 'A base chama ' || d.object || ' com a assinatura e as permissões que ela criou e não conhece esta versão. Volte as propriedades às da base (o corpo é livre).'
        when d.kind = 'function'
          then 'Uma atualização que recriar esta função apaga a alteração. Mova a regra para um gancho private.custom_* (veja ${GUIDE_FILE}).'
        when d.kind in ('trigger', 'policy')
          then 'Uma atualização que recriar este objeto apaga a alteração. Volte ao que a base criou e ponha a regra num gancho ou num objeto custom_* (veja ${GUIDE_FILE}).'
        else 'Volte ao que a base criou ou ponha a regra num objeto custom_* (veja ${GUIDE_FILE}). Uma atualização pode depender da definição da base.' end) as detalhe
  from differences d
  where d.in_base and d.in_live
    and (case when d.manifest_kind = 'hook' then d.base_props is distinct from d.live_props else d.base_hash is distinct from d.live_hash end)
  union all
  -- Ausente: objeto da base que não existe no banco (os filhos de uma tabela ausente ficam resumidos na linha dela).
  select 3, 'atenção', 'ausente', d.tipo, d.object,
    case when d.manifest_kind = 'hook'
      then 'Sem este gancho, toda gravação em public.' || case
          when d.short_name like '%contact%' then 'contacts' when d.short_name like '%company%' then 'companies'
          when d.short_name like '%deal%' then 'deals' else 'activities' end
        || ' falha. Recrie-o com o corpo vazio (veja ${GUIDE_FILE}).'
      else 'Não existe neste banco. Se faltam migrações da base (veja a linha de resumo), aplique-as. Se foi removido à mão, recrie pela migração que o criou.'
        || coalesce(' Com ele, faltam também ' || d.children || '.', '') end
  from differences d
  where d.in_base and not d.in_live and (d.parent is null or d.parent not in (select object from missing_tables))
  union all
  -- Gancho em uso: corpo próprio desta instância, com a assinatura e as permissões da base.
  select 4, 'informação', 'gancho', d.tipo, d.object,
    'Em uso: corpo próprio desta instância. As atualizações da base não mexem nele.'
  from differences d
  where d.in_base and d.in_live and d.manifest_kind = 'hook' and d.base_props is not distinct from d.live_props
    and d.base_body is distinct from d.live_body
  union all
  -- Função com o nome de um gancho e outros argumentos: a base não a chama.
  select 4, 'atenção', 'gancho', d.tipo, d.object,
    'Mesmo nome de um gancho, mas outros argumentos: a base não chama esta função. Ponha a regra no gancho '
      || (select h.object from manifest h where h.manifest_kind = 'hook' and split_part(split_part(h.object, '(', 1), '.', 2) = d.short_name)
      || ', com a mesma assinatura.'
  from differences d
  where not d.in_base and d.kind = 'function' and d.object like 'private.%'
    and d.short_name in (select split_part(split_part(h.object, '(', 1), '.', 2) from manifest h where h.manifest_kind = 'hook')
  union all
  -- Extra: objeto fora da base (os filhos de uma tabela extra ficam resumidos na linha dela). Nunca é erro. Pedem
  -- atenção os extras que abrem dados pela API: a política permissiva numa tabela da base (as permissivas se somam, OR,
  -- e ela amplia quem lê ou grava) e, em public, a tabela sem RLS, a view que roda com os privilégios do dono (ignora
  -- a RLS das tabelas que lê) e a função SECURITY DEFINER, quando anon, authenticated ou PUBLIC alcançam o objeto. No
  -- Supabase, os privilégios padrão concedem tudo a anon e authenticated em public (o local-bootstrap.sql reproduz isso).
  select 5, case when e.exposure is not null and e.exposure <> 'locked' then 'atenção' else 'informação' end,
    'extra', d.tipo, d.object,
    concat_ws(' ',
      case when d.short_name like 'custom\\_%' or (d.parent is not null and d.parent ~ '\\.custom_[^.]*$')
        then 'Personalização desta instância. A base nunca cria objetos com o prefixo custom_.'
        else 'Fora da base. Funciona, mas uma versão futura pode criar um objeto com o mesmo nome. Prefira o prefixo custom_.' end,
      case when d.kind in ('table', 'view') and d.children is not null then 'Com ' || d.children || '.' end,
      case e.exposure
        when 'table' then 'Sem RLS e com permissões para anon ou authenticated: qualquer pessoa com a chave pública lê e grava esta tabela pela API, sem login e com os dados de todas as empresas. Ligue a RLS (alter table '
          || d.object || ' enable row level security) e crie as políticas por organização, como na seção 2 de ${GUIDE_FILE}.'
        when 'view' then 'View sem security_invoker e com permissões para anon ou authenticated: ela roda com os privilégios do dono e ignora a RLS das tabelas que lê, e qualquer pessoa com a chave pública a lê pela API, com os dados de todas as empresas. Use alter view '
          || d.object || ' set (security_invoker = true), ou revogue o acesso (revoke all on ' || d.object || ' from anon, authenticated).'
        when 'function' then 'SECURITY DEFINER e executável por anon, authenticated ou PUBLIC: ela roda com os privilégios do dono, sem RLS, e qualquer pessoa com a chave pública a chama pela API. Mova-a para o schema private, troque para security invoker ou revogue o acesso (revoke execute on function '
          || d.object || ' from public, anon, authenticated).'
        when 'locked' then 'RLS ligada e nenhuma política: pela API, ninguém lê nem grava esta tabela. Crie as políticas, se a tela ou uma integração precisa dela.' end,
      case when d.kind = 'trigger' and d.parent in (select object from manifest where kind in ('table', 'view'))
        then 'Confira depois de cada atualização se ele continua valendo com as regras novas da tabela.' end,
      case when d.kind = 'policy' and (d.live_props ->> 'permissive')::boolean
          and d.parent in (select object from manifest where kind in ('table', 'view'))
        then 'Política permissiva numa tabela da base (comando ' || (d.live_props ->> 'command') || ', papéis '
          || coalesce(d.live_props ->> 'roles', 'public')
          || '): ela soma acesso ao das políticas da base, e quem ela alcança passa a ler ou gravar a tabela. Confira se é isso que você quer.' end)
  from differences d
  cross join lateral (select case
      when d.kind = 'policy' and (d.live_props ->> 'permissive')::boolean
        and d.parent in (select object from manifest where kind in ('table', 'view')) then 'policy'
      when d.object not like 'public.%' then null
      when d.kind = 'table' and d.live_props ->> 'rls' = 'false'
        and d.live_props ->> 'acl' ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*[arwdD]' then 'table'
      when d.kind = 'view' and lower(d.live_props ->> 'security_invoker') not in ('true', 'on', 'yes', '1')
        and d.live_props ->> 'acl' ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*[arwd]' then 'view'
      when d.kind = 'function' and d.live_props ->> 'security' = 'definer'
        and d.live_props ->> 'returns' not in ('trigger', 'event_trigger')
        and d.live_props ->> 'acl' ~ '(^|,)(PUBLIC|anon|authenticated)=[^,]*X' then 'function'
      when d.kind = 'table' and d.live_props ->> 'rls' = 'true'
        and not exists (select 1 from compared p where p.parent = d.object and p.kind = 'policy' and p.in_live) then 'locked'
    end as exposure) e
  where d.in_live and not d.in_base and (d.parent is null or d.parent not in (select object from extra_tables))
    and not (d.kind = 'function' and d.object like 'private.%'
      and d.short_name in (select split_part(split_part(h.object, '(', 1), '.', 2) from manifest h where h.manifest_kind = 'hook'))
), base_migrations as (
  select m.version, m.name from manifest_doc d
  cross join lateral jsonb_to_recordset(d.doc -> 'migrations') as m(version text, name text)
), history as (
  select coalesce((select (f.props ->> 'present')::boolean from fingerprints f where f.kind = 'migration_history'), false) as present
), live_migrations as (
  select f.object as version, f.props ->> 'name' as name from fingerprints f where f.kind = 'migration'
), migrations as (
  select 3 as ordem, 'atenção' as gravidade, 'ausente' as situacao, 'migração' as tipo, b.version || '_' || b.name as objeto,
    'Migração da base que não está no histórico deste banco. Aplique as migrações da base que faltam e rode este check de novo.' as detalhe
  from base_migrations b, history h
  where h.present and b.version not in (select version from live_migrations)
  union all
  select 5, 'informação', 'extra', 'migração', l.version || coalesce('_' || l.name, ''),
    'Migração desta instância (ou de outra origem), fora da base. Mantenha o arquivo dela no repositório.'
  from live_migrations l
  where l.version not in (select version from base_migrations)
), result as (
  select * from objects
  union all
  select * from migrations
  union all
  select 1, 'informação', 'resumo', 'migração', 'supabase_migrations.schema_migrations',
    'Este banco não tem supabase_migrations.schema_migrations (migrações aplicadas pelo editor SQL sem registro). A comparação dos objetos continua valendo.'
  from history h where not h.present
  union all
  select 1, 'informação', 'resumo', 'schema', 'PostgreSQL ' || (current_setting('server_version_num')::int / 10000),
    'Este banco usa uma versão principal do PostgreSQL diferente da do manifesto (' || (current_setting('server_version_num')::int / 10000)
      || ' em vez de ' || (d.doc ->> 'postgres') || '). Políticas, gatilhos, restrições, índices e padrões de coluna podem aparecer como alterados só pela escrita da expressão. O corpo das funções não depende disso.'
  from manifest_doc d where (current_setting('server_version_num')::int / 10000)::text <> d.doc ->> 'postgres'
)
select r.gravidade, r.situacao, r.tipo, r.objeto, r.detalhe
from (
  select 0 as ordem, 'resumo' as gravidade, 'resumo' as situacao, 'manifesto' as tipo, d.doc ->> 'lastMigration' as objeto,
    concat_ws(' ',
      'Base ' || (d.doc ->> 'lastMigration') || ', com ' || jsonb_array_length(d.doc -> 'objects') || ' objetos.',
      case when not h.present then 'Histórico de migrações não encontrado.'
        when (select count(*) from base_migrations b where b.version not in (select version from live_migrations)) = 0
          then 'Histórico com todas as migrações da base.'
        else 'Última migração da base no histórico: ' || coalesce((select max(b.version || '_' || b.name) from base_migrations b
            where b.version in (select version from live_migrations)), 'nenhuma') || '. '
          || (select case count(*) when 1 then 'Falta 1 migração da base' else 'Faltam ' || count(*) || ' migrações da base' end
            from base_migrations b where b.version not in (select version from live_migrations))
          || ': as diferenças abaixo podem vir delas. Aplique as migrações e rode este check de novo, ou rode o db-drift-check.sql da versão instalada.' end,
      'Alterados: ' || (select count(*) from result where situacao = 'alterado') || '.',
      'Ausentes: ' || (select count(*) from result where situacao = 'ausente' and tipo <> 'migração') || '.',
      'Ganchos em uso: ' || (select count(*) from result where situacao = 'gancho' and gravidade = 'informação') || '.',
      case when (select count(*) from result where situacao = 'gancho' and gravidade = 'atenção') > 0
        then 'Funções com o nome de um gancho e outros argumentos: ' || (select count(*) from result where situacao = 'gancho' and gravidade = 'atenção') || '.' end,
      'Extras: ' || (select count(*) from result where situacao = 'extra') || '.',
      case when (select count(*) from result where situacao = 'extra' and gravidade = 'atenção') > 0
        then 'Extras com atenção (abrem dados pela API): ' || (select count(*) from result where situacao = 'extra' and gravidade = 'atenção') || '.' end) as detalhe
  from manifest_doc d, history h
  union all
  select ordem, gravidade, situacao, tipo, objeto, detalhe from result
) r
order by r.ordem, r.tipo collate "C", r.objeto collate "C";
`;

/** O SQL do check, com o manifesto num literal $manifest$…$manifest$. */
export function renderDriftCheck(manifest) {
  const json = renderManifest(manifest).trimEnd();
  if (json.includes(MANIFEST_MARKER))
    throw new ManifestError(`O manifesto contém o marcador ${MANIFEST_MARKER}; o check não pode embuti-lo.`);
  return `${DRIFT_CHECK_HEADER(manifest)}${DRIFT_CHECK_QUERY.replace('__MANIFEST__', () => `\n${json}\n`)}`;
}

/** O texto do check sem o manifesto embutido, sem comentários e sem literais: o que a consulta executa. */
export function driftCheckCode(sql) {
  const start = sql.indexOf(MANIFEST_MARKER);
  const end = sql.indexOf(MANIFEST_MARKER, start + MANIFEST_MARKER.length);
  const withoutManifest = start === -1 ? sql : `${sql.slice(0, start)}''${sql.slice(end + MANIFEST_MARKER.length)}`;
  return withoutManifest.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
}

// Primeira linha diferente, para a mensagem de erro apontar onde olhar (a mesma do gen:types).
export function firstDifference(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index])
      return [
        `  Primeira diferença na linha ${index + 1}:`,
        `    gerado:     ${expectedLines[index] ?? '(fim do arquivo)'}`,
        `    versionado: ${actualLines[index] ?? '(fim do arquivo)'}`,
      ];
  }
  return [];
}

const normalize = (text) => text.replace(/\r\n/g, '\n');
const REBUILD_HINT = 'Rode npm run manifest:build e faça commit dos arquivos gerados.';
const CUSTOM_HINT =
  'Se você personaliza uma instância, dê às suas migrações o nome <data e hora>_custom_<nome>.sql: o manifesto descreve só a base, e o manifest:build e o manifest:check ignoram essas migrações. Se os dois arquivos foram editados à mão, volte-os ao último commit (git checkout HEAD -- supabase/base-manifest.json supabase/db-drift-check.sql) ou rode npm run manifest:build.';

/**
 * Grava (ou, com `checkOnly`, só confere) os arquivos gerados. `read(path)` devolve o texto ou `null` se o arquivo não
 * existe; `write(path, content)` grava. Devolve o resumo; no check, um arquivo ausente ou diferente vira ManifestError.
 */
export async function syncGeneratedFiles({ files, checkOnly, read, write }) {
  const current = [];
  for (const file of files) current.push({ ...file, current: await read(file.path) });
  if (checkOnly) {
    for (const file of current) {
      if (file.current === null) throw new ManifestError(`${file.path} não existe. ${REBUILD_HINT}`);
      if (normalize(file.current) !== file.content)
        throw new ManifestError(
          [
            `${file.path} está diferente do que as migrações geram (arquivo editado à mão ou migração sem manifesto).`,
            ...firstDifference(file.content, normalize(file.current)),
            `  ${REBUILD_HINT}`,
            `  ${CUSTOM_HINT}`,
          ].join('\n'),
        );
    }
    return `${files.map((file) => file.path).join(' e ')} em dia com as migrações.`;
  }
  const changed = current.filter((file) => file.current === null || normalize(file.current) !== file.content);
  for (const file of changed) await write(file.path, file.content);
  return changed.length
    ? `${changed.map((file) => file.path).join(' e ')} gravado${changed.length > 1 ? 's' : ''}.`
    : `${files.map((file) => file.path).join(' e ')} já estavam em dia; nada mudou.`;
}
