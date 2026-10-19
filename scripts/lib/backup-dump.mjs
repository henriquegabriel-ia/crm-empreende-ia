// O dump do backup do CRM (item 1.5; desenho em docs/arquitetura/1.5.md, seções 5.3 e 5.4). O workflow
// .github/workflows/backup-banco.yml roda o `supabase db dump` do CLI fixado; o ensaio `npm run test:restore` roda o
// `pg_dump` com as MESMAS opções que esse CLI usa, guardadas aqui e conferidas contra o `--dry-run` do CLI (o texto
// de 2.119.0 em scripts/lib/fixtures/ no Vitest, e o vivo com `npm run test:restore -- --check-cli` no CI).
// Uma atualização do CLI que mude as opções reprova o CI até alguém atualizar estas constantes e rodar o ensaio.
import { SUPABASE_CLI_VERSION } from './supabase-config.mjs';

export const BACKUP_CLI_VERSION = SUPABASE_CLI_VERSION;
export const BACKUP_WORKFLOW_FILE = '.github/workflows/backup-banco.yml';
export const DRY_RUN_FIXTURES = Object.freeze({
  data: 'scripts/lib/fixtures/supabase-db-dump-data-dry-run.txt',
  history: 'scripts/lib/fixtures/supabase-db-dump-history-dry-run.txt',
});

// Schemas que o CLI deixa de fora dos dados (mantidos pela plataforma). auth, storage, private e public ficam.
const CLI_DATA_EXCLUDED_SCHEMAS = [
  'information_schema',
  'pg_*',
  'graphql',
  'graphql_public',
  'pgsodium',
  'pgsodium_masks',
  'pgtle',
  'repack',
  'tiger',
  'tiger_data',
  'timescaledb_*',
  '_timescaledb_*',
  'topology',
  'vault',
  'etl',
  'extensions',
  'pgbouncer',
  'realtime',
  'supabase_migrations',
  '_analytics',
  '_realtime',
  '_supavisor',
].join('|');
const CLI_EXCLUDED_HISTORY_TABLES = ['auth.schema_migrations', 'storage.migrations', 'supabase_functions.migrations'];
const excludedHistoryArgs = CLI_EXCLUDED_HISTORY_TABLES.flatMap((table) => ['--exclude-table', table]);

/** `supabase db dump --data-only` do CLI fixado: os argumentos do `pg_dump`, na ordem do `--dry-run`. */
export const CLI_DATA_DUMP = Object.freeze({
  cliVersion: BACKUP_CLI_VERSION,
  args: Object.freeze([
    '--data-only',
    '--quote-all-identifier',
    '--role',
    'postgres',
    '--exclude-schema',
    CLI_DATA_EXCLUDED_SCHEMAS,
    ...excludedHistoryArgs,
    '--schema',
    '*',
    '--column-inserts',
    '--rows-per-insert',
    '100000',
  ]),
});
/** `supabase db dump --data-only --schema supabase_migrations`: o histórico das migrações. */
export const CLI_HISTORY_DUMP = Object.freeze({
  cliVersion: BACKUP_CLI_VERSION,
  args: Object.freeze([
    '--data-only',
    '--quote-all-identifier',
    '--role',
    'postgres',
    '--exclude-schema',
    '',
    ...excludedHistoryArgs,
    '--schema',
    'supabase_migrations',
    '--column-inserts',
    '--rows-per-insert',
    '100000',
  ]),
});
// O schema do CLI deixa de fora auth, storage e supabase_migrations, entre outros: o caminho de restauração da
// documentação do Supabase perde os gatilhos do CRM em auth.users e auth.mfa_amr_claims (decisão B8 do desenho).
export const CLI_SCHEMA_EXCLUDED_SCHEMAS =
  'information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault';

// Tabelas do Auth com credenciais vivas (sessões e tokens), que o backup nunca leva (decisão B5). As senhas (hash) e as
// identidades ficam; depois de restaurar, todos entram de novo.
export const CREDENTIAL_TABLES = Object.freeze([
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.mfa_amr_claims',
  'auth.one_time_tokens',
  'auth.flow_state',
]);
// Os `-x` do workflow: as tabelas de vetores do Storage (o CLI mesmo sugere excluí-las) e as credenciais.
export const BACKUP_EXCLUDED_TABLES = Object.freeze([
  'storage.buckets_vectors',
  'storage.vector_indexes',
  ...CREDENTIAL_TABLES,
]);

/** `-x schema.tabela` vira `--exclude-table "schema"."tabela"`, como o CLI faz. */
export const excludeTableArgs = (tables = BACKUP_EXCLUDED_TABLES) =>
  tables.flatMap((table) => {
    const [schema, name] = table.split('.');
    return ['--exclude-table', `"${schema}"."${name}"`];
  });

/**
 * O pós-processamento do CLI sobre a saída do `pg_dump`: `SET session_replication_role = replica;` antes (gatilhos
 * desligados na carga), as linhas `\restrict` e `\unrestrict` do pg_dump novo comentadas e `RESET ALL;` no fim.
 */
export function postProcessDump(raw) {
  const body = raw.replace(/\r\n/g, '\n').replace(/^\\(un)?restrict .*$/gm, (line) => `-- ${line}`);
  return `SET session_replication_role = replica;\n\n${body}${body.endsWith('\n') ? '' : '\n'}RESET ALL;\n`;
}

// Divide uma linha de shell em palavras, com aspas duplas e `\"` dentro delas.
function shellWords(line) {
  const words = [];
  let current = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '"') {
      current ??= '';
      index += 1;
      while (index < line.length && line[index] !== '"') {
        if (line[index] === '\\' && line[index + 1] !== undefined) index += 1;
        current += line[index];
        index += 1;
      }
      index += 1;
    } else if (char === '\\' && line[index + 1] !== undefined) {
      current = (current ?? '') + line[index + 1];
      index += 2;
    } else if (/\s/.test(char)) {
      if (current !== null) words.push(current);
      current = null;
      index += 1;
    } else {
      current = (current ?? '') + char;
      index += 1;
    }
  }
  if (current !== null) words.push(current);
  return words;
}

/**
 * Os argumentos do `pg_dump` no script impresso por `supabase db dump --dry-run`, e o que vem antes e depois dele (o
 * `SET session_replication_role`, o `sed` do `\restrict` e o `RESET ALL`).
 */
export function parseCliDryRun(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === 'pg_dump \\');
  if (start === -1) throw new Error('o --dry-run do CLI não imprimiu o comando pg_dump');
  const command = [];
  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith('|')) {
    command.push(lines[end].replace(/\\\s*$/, ''));
    end += 1;
  }
  const args = shellWords(command.join(' '));
  return {
    args,
    replica: text.includes('SET session_replication_role = replica;'),
    restrictSed: lines.slice(end).some((line) => line.includes("sed -E 's/^\\\\(un)?restrict .*$/-- &/'")),
    resetAll: text.includes('echo "RESET ALL;"'),
  };
}

/** Diferenças entre as opções fixadas e as do `--dry-run`, com os `-x` do workflow quando `excluded` é passado. */
export function dryRunDifferences(text, expected, excluded = []) {
  const parsed = parseCliDryRun(text);
  const wanted = [...expected.args, ...excludeTableArgs(excluded)];
  const problems = [];
  if (JSON.stringify(parsed.args) !== JSON.stringify(wanted))
    problems.push(
      `argumentos do pg_dump diferentes:\n  CLI:      ${parsed.args.join(' ')}\n  fixados:  ${wanted.join(' ')}`,
    );
  if (!parsed.replica) problems.push('o CLI não abre mais o dump com SET session_replication_role = replica;');
  if (!parsed.restrictSed) problems.push('o CLI não comenta mais as linhas \\restrict do pg_dump');
  if (!parsed.resetAll) problems.push('o CLI não fecha mais o dump com RESET ALL;');
  return problems;
}
