// Restauração de um backup do CRM num projeto Supabase novo (item 1.5; desenho em docs/arquitetura/1.5.md, seção 6; guia
// em docs/BACKUP-RESTAURACAO.md). O processo fica em scripts/restore-backup.mjs (`npm run backup:restore`); o ensaio de
// ponta a ponta, em scripts/test-restore.mjs (`npm run test:restore`), chama estas mesmas funções.
//
// O caminho é "migrações + dados": o schema vem do `npx supabase db push` com as mesmas migrações do backup, e daqui só
// os dados do `data.sql` gerado pelo workflow "Backup do banco" (`supabase db dump --data-only`, em INSERT). Nada aqui
// precisa de psql, Docker ou PostgreSQL instalado: o `pg` executa cada comando do dump, numa transação só.
//
// Recusas, todas antes de gravar ou com a transação desfeita: pasta incompleta ou alterada (sha256), comando fora da
// lista permitida ou meta-comando do psql, versões das migrações diferentes das do backup, projeto que não está vazio,
// sessão da API e qualquer falha das conferências depois da carga. A ferramenta nunca apaga nada.
//
// A lista permitida confere cada comando inteiro, no formato exato do pg_dump (revisão do item 1.5, rodada 1): um INSERT
// só passa com a lista de colunas e tuplas de literais (texto entre aspas simples, número, NULL, true, false e B'...'),
// sem subconsulta, chamada de função, SELECT, ON CONFLICT ou RETURNING; um set_config só põe o search_path vazio. Cada
// SET só passa com o par exato de parâmetro e valor que o pg_dump e o CLI escrevem (revisão do item 1.5, rodada 2): um
// `SET standard_conforming_strings = off` faria o servidor ler `\'` como aspa escapada e fechar um literal antes do que
// esta leitura enxerga. Como defesa a mais, cada comando roda pelo protocolo estendido, que recusa vários comandos numa
// mensagem, e antes de cada INSERT a sessão precisa estar com standard_conforming_strings on e client_encoding UTF8. O
// sha256 não protege contra quem alterou a pasta inteira (o backup-info.json vem junto), por isso a lista é a proteção.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, runSqlFile, splitSqlScript } from './embedded-db.mjs';

export const BACKUP_FORMAT = 1;
export const BACKUP_FILES = Object.freeze({ data: 'data.sql', history: 'history.sql', info: 'backup-info.json' });
export const PREPARE_FILE = 'supabase/backup/restore-prepare.sql';
export const CHECK_FILE = 'supabase/backup/restore-check.sql';
export const DRIFT_FILE = 'supabase/db-drift-check.sql';
// Schemas em que o dump pode gravar: os dados do CRM (public e private), as contas (auth) e o Storage.
export const RESTORE_SCHEMAS = Object.freeze(['auth', 'public', 'private', 'storage']);
// Schemas de recursos da plataforma que a empresa pode ligar no painel do Supabase (pg_cron, pg_net, Database Webhooks e
// Queues) e que o CLI não exclui do dump de dados. A ferramenta deixa esses dados de fora, com aviso: eles não são do CRM,
// o projeto novo pode não ter o recurso ligado e um job do pg_cron roda SQL como postgres. Hoje a base não usa nenhum
// deles: o que estiver ali foi ligado pela empresa no painel, e é lá que ela recria. Um item da base que passar a criar
// jobs do próprio CRM no pg_cron (3.1) precisa recriá-los pela migração, a partir de configuração do CRM, ou tirar
// `cron` desta lista, tratar esses dados na lista permitida e cobri-los no ensaio (revisão do item 1.5, rodada 2).
export const PLATFORM_SCHEMAS = Object.freeze(['cron', 'net', 'supabase_functions', 'pgmq']);
// Tabelas que uma migração preenche num projeto novo (a mesma lista de `v_seeded` em supabase/backup/restore-prepare.sql).
// Vazia: nenhuma migração grava linha num projeto novo. O test:db reprova o dia em que alguma passar a gravar.
export const RESTORE_SEEDED_TABLES = Object.freeze([]);
// Os únicos SET aceitos, com o valor exato que o pg_dump 17 escreve no começo do dump (mais o session_replication_role
// do CLI e os dois que o pg_dump escreve antes de uma tabela). Qualquer outro parâmetro ou valor é recusado: role e
// session_authorization mudariam quem grava, e standard_conforming_strings ou client_encoding mudariam a leitura das
// aspas no servidor.
export const ALLOWED_SETTINGS = Object.freeze({
  statement_timeout: '0',
  lock_timeout: '0',
  idle_in_transaction_session_timeout: '0',
  transaction_timeout: '0',
  client_encoding: "'UTF8'",
  standard_conforming_strings: 'on',
  check_function_bodies: 'false',
  xmloption: 'content',
  client_min_messages: 'warning',
  row_security: 'off',
  session_replication_role: 'replica',
  default_table_access_method: 'heap',
  default_tablespace: "''",
});
// O commit gravado pelo workflow (GITHUB_SHA). Outro valor no backup-info.json é ignorado, porque entraria num comando
// sugerido para copiar e colar no terminal.
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;
const MAX_LISTED = 10;

export class RestoreError extends Error {}

export const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const unquoteIdentifier = (text) => text.replace(/""/g, '"');
const listed = (items) =>
  items.length > MAX_LISTED
    ? `${items.slice(0, MAX_LISTED).join(', ')} e mais ${items.length - MAX_LISTED}`
    : items.join(', ');

/**
 * Lê a pasta extraída do `.7z`: os três arquivos presentes, o `sha256` de cada um igual ao de `backup-info.json` e o
 * formato conhecido. Devolve `{ info, data, history }` (os dois SQL como texto).
 */
export function readBackupDir(dir) {
  const notBackup = (detail) =>
    new RestoreError(
      `Esta pasta não é um backup completo do CRM (${detail}). Extraia o arquivo crm-backup-<data>.7z inteiro, com a senha, e aponte --dir para a pasta com data.sql, history.sql e backup-info.json.`,
    );
  if (!dir || !existsSync(dir)) throw new RestoreError(`A pasta ${dir ?? '(não informada)'} não existe.`);
  for (const file of Object.values(BACKUP_FILES))
    if (!existsSync(path.join(dir, file))) throw notBackup(`falta ${file}`);
  let info;
  try {
    info = JSON.parse(readFileSync(path.join(dir, BACKUP_FILES.info), 'utf8'));
  } catch {
    throw notBackup(`${BACKUP_FILES.info} não é um JSON válido`);
  }
  if (
    !info ||
    typeof info !== 'object' ||
    info.format !== BACKUP_FORMAT ||
    !info.files ||
    typeof info.files !== 'object'
  )
    throw notBackup(`${BACKUP_FILES.info} sem o formato ${BACKUP_FORMAT}`);
  if (info.commit !== undefined && !(typeof info.commit === 'string' && COMMIT_PATTERN.test(info.commit)))
    info.commit = null;
  const contents = {};
  for (const key of ['data', 'history']) {
    const file = BACKUP_FILES[key];
    const buffer = readFileSync(path.join(dir, file));
    const expected = info.files[file]?.sha256;
    if (typeof expected !== 'string') throw notBackup(`${BACKUP_FILES.info} não traz o sha256 de ${file}`);
    if (sha256(buffer) !== expected.toLowerCase())
      throw notBackup(`${file} foi alterado ou está incompleto: o sha256 não bate com o de ${BACKUP_FILES.info}`);
    contents[key] = buffer.toString('utf8');
  }
  return { info, data: contents.data, history: contents.history };
}

const SET_STATEMENT = /^SET ([a-z_]+) = ('[A-Za-z0-9]*'|[a-z0-9]+);?$/;
// O pg_dump só escreve este set_config: o search_path vazio, para a sessão toda.
const SET_CONFIG = /^SELECT pg_catalog\.set_config\('search_path', '', false\);?$/;
const SETVAL = /^SELECT\s+pg_catalog\.setval\('"((?:[^"']|"")+)"\."(?:[^"']|"")+"',\s*-?\d+,\s*(?:true|false)\);?$/;
const RESET_ALL = /^RESET ALL\s*;?$/;
const QUOTED_IDENTIFIER = /"((?:[^"]|"")+)"/y;
// Os literais que o pg_dump --column-inserts escreve: texto entre aspas simples (com standard_conforming_strings, sem
// barra invertida especial), bit (B'0101'), NULL, true, false e números (só dígitos, sinal, ponto e expoente).
const LITERAL = /'(?:[^']|'')*'|B'[01]*'|NULL|true|false|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/y;

function literalValue(token) {
  if (token === 'NULL') return null;
  return token.startsWith("'") ? token.slice(1, -1).replace(/''/g, "'") : token;
}

/**
 * Um INSERT no formato exato do `pg_dump --column-inserts --rows-per-insert`: `INSERT INTO "schema"."tabela" ("a",
 * "b") [OVERRIDING SYSTEM VALUE] VALUES (literal, literal), (...);`, com o mesmo número de valores e de colunas em cada
 * tupla e nada depois da última. Devolve `{ schema, table, columns, rows }`, mais `tuples` com `withValues` (texto sem
 * as aspas, `null` para NULL e o resto como escrito), ou `null` fora desse formato.
 */
export function parseInsert(sql, { withValues = false } = {}) {
  const text = sql.trim();
  let at = 0;
  const take = (literal) => {
    if (!text.startsWith(literal, at)) return false;
    at += literal.length;
    return true;
  };
  const skipSpace = () => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
  };
  const identifier = () => {
    QUOTED_IDENTIFIER.lastIndex = at;
    const match = QUOTED_IDENTIFIER.exec(text);
    if (!match) return null;
    at = QUOTED_IDENTIFIER.lastIndex;
    return unquoteIdentifier(match[1]);
  };
  if (!take('INSERT INTO ')) return null;
  const schema = identifier();
  if (schema === null || !take('.')) return null;
  const table = identifier();
  if (table === null || !take(' (')) return null;
  const columns = [];
  do {
    const column = identifier();
    if (column === null) return null;
    columns.push(column);
  } while (take(', '));
  if (!take(')')) return null;
  skipSpace();
  if (take('OVERRIDING SYSTEM VALUE')) skipSpace();
  if (!take('VALUES')) return null;
  const tuples = [];
  let rows = 0;
  for (;;) {
    skipSpace();
    if (!take('(')) return null;
    const values = [];
    let count = 0;
    for (;;) {
      skipSpace();
      LITERAL.lastIndex = at;
      const match = LITERAL.exec(text);
      if (!match) return null;
      at = LITERAL.lastIndex;
      count += 1;
      if (withValues) values.push(literalValue(match[0]));
      skipSpace();
      if (take(',')) continue;
      if (take(')')) break;
      return null;
    }
    if (count !== columns.length) return null;
    rows += 1;
    if (withValues) tuples.push(values);
    skipSpace();
    if (!take(',')) break;
  }
  take(';');
  skipSpace();
  if (at !== text.length) return null;
  return withValues ? { schema, table, columns, rows, tuples } : { schema, table, columns, rows };
}

/**
 * O tipo de um comando do dump, ou `null` se ele não está na lista permitida. Um INSERT ou setval num schema de
 * PLATFORM_SCHEMAS vira `skip`: fica de fora da restauração, com aviso.
 */
export function classifyDumpStatement(sql) {
  const text = sql.trim();
  const set = SET_STATEMENT.exec(text);
  if (set)
    return Object.hasOwn(ALLOWED_SETTINGS, set[1]) && ALLOWED_SETTINGS[set[1]] === set[2]
      ? { kind: 'set', name: set[1] }
      : null;
  if (SET_CONFIG.test(text)) return { kind: 'set_config' };
  const setval = SETVAL.exec(text);
  if (setval) {
    const schema = unquoteIdentifier(setval[1]);
    if (PLATFORM_SCHEMAS.includes(schema)) return { kind: 'skip', table: `${schema} (sequências)` };
    return RESTORE_SCHEMAS.includes(schema) ? { kind: 'setval' } : null;
  }
  if (RESET_ALL.test(text)) return { kind: 'reset' };
  const insert = parseInsert(text);
  if (insert) {
    const table = `${insert.schema}.${insert.table}`;
    if (PLATFORM_SCHEMAS.includes(insert.schema)) return { kind: 'skip', table };
    if (!RESTORE_SCHEMAS.includes(insert.schema)) return null;
    return { kind: 'insert', table };
  }
  return null;
}

/** As tabelas dos schemas da plataforma que a restauração deixa de fora (os comandos `skip` de `parseDump`). */
export const skippedTables = (statements) => [
  ...new Set(statements.filter((statement) => statement.kind === 'skip').map((statement) => statement.table)),
];

/**
 * Lê o `data.sql` sem interpretar nada: cada comando precisa estar na lista permitida (SET de ALLOWED_SETTINGS com o
 * valor exato, set_config do search_path vazio,
 * setval, INSERT de literais em auth, public, private e storage, RESET ALL), e nenhum meta-comando do psql é aceito, nem
 * `\ir`. Os INSERT e setval dos schemas da plataforma (PLATFORM_SCHEMAS) voltam como `skip`. Devolve os comandos, na
 * ordem, com a linha e o tipo.
 */
export function parseDump(text, file = BACKUP_FILES.data) {
  const steps = splitSqlScript(text, file, { restricted: true });
  const statements = [];
  for (const step of steps) {
    if (step.kind === 'meta') {
      if (/^\\(un)?restrict\b/.test(step.command))
        throw new RestoreError(
          `${file}, linha ${step.line}: "${step.command.split(/\s+/)[0]}" sem comentário. Este arquivo veio de um pg_dump direto, fora do supabase db dump: use o backup do workflow "Backup do banco" ou um arquivo gerado por npx supabase db dump --data-only.`,
        );
      throw new RestoreError(
        `${file}, linha ${step.line}: meta-comando do psql não aceito (${step.command.slice(0, 40)}). O backup do CRM só tem comandos SQL.`,
      );
    }
    const kind = classifyDumpStatement(step.sql);
    if (!kind) {
      const preview = step.sql.replace(/\s+/g, ' ').slice(0, 80);
      throw new RestoreError(
        `${file}, linha ${step.line}: comando fora da lista permitida (${preview}). O backup do CRM só tem SET com os valores do pg_dump, set_config do search_path, setval, INSERT com valores literais em auth, public, private e storage e RESET ALL, no formato do supabase db dump; nada foi gravado.`,
      );
    }
    statements.push({ ...kind, sql: step.sql, line: step.line });
  }
  if (!statements.some((statement) => statement.kind === 'insert' && statement.table === 'public.organizations'))
    throw new RestoreError(`${file} não tem os dados da empresa (public.organizations): o backup saiu vazio.`);
  return statements;
}

/**
 * As versões (e os nomes) das migrações do `history.sql` (`supabase db dump --data-only --schema supabase_migrations`),
 * pela lista de colunas do INSERT. A coluna `statements` guarda SQL de verdade, com aspas, vírgulas e parênteses.
 */
export function parseHistoryVersions(text, file = BACKUP_FILES.history) {
  const migrations = [];
  for (const step of splitSqlScript(text, file, { restricted: true })) {
    if (step.kind !== 'sql') continue;
    if (!step.sql.trim().startsWith('INSERT INTO "supabase_migrations"."schema_migrations" ')) continue;
    const insert = parseInsert(step.sql, { withValues: true });
    if (!insert)
      throw new RestoreError(
        `${file}, linha ${step.line}: o histórico de migrações não está no formato do supabase db dump. Gere outro backup.`,
      );
    const versionAt = insert.columns.indexOf('version');
    const nameAt = insert.columns.indexOf('name');
    if (versionAt === -1) throw new RestoreError(`${file}: o histórico de migrações não tem a coluna version.`);
    for (const tuple of insert.tuples)
      migrations.push({ version: String(tuple[versionAt]), name: nameAt === -1 ? null : tuple[nameAt] });
  }
  if (!migrations.length)
    throw new RestoreError(`${file} não tem nenhuma migração: o backup saiu sem o histórico. Gere outro backup.`);
  return migrations.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

const labelOf = (migration) => (migration.name ? `${migration.version}_${migration.name}` : migration.version);

/** O que falta no projeto (está no backup) e o que sobra nele (não está no backup), pela versão. */
export function compareVersions(project, backup) {
  const projectVersions = new Set(project.map((migration) => migration.version));
  const backupVersions = new Set(backup.map((migration) => migration.version));
  return {
    missing: backup.filter((migration) => !projectVersions.has(migration.version)).map(labelOf),
    extra: project.filter((migration) => !backupVersions.has(migration.version)).map(labelOf),
  };
}

export function versionProblems(project, backup, commit) {
  const { missing, extra } = compareVersions(project, backup);
  if (!missing.length && !extra.length) return null;
  const lines = ['As migrações do projeto não são as mesmas do backup. Nada foi gravado.'];
  if (missing.length) lines.push(`  Faltam no projeto: ${listed(missing)}.`);
  if (extra.length) lines.push(`  Sobram no projeto: ${listed(extra)}.`);
  lines.push(
    `  Restaure com o repositório na versão do backup${commit ? ` (git switch --detach ${commit})` : ''}, rode npx supabase db push num projeto novo e tente de novo. Depois, git switch - e db push de novo aplicam as migrações mais novas sobre os dados restaurados (veja docs/BACKUP-RESTAURACAO.md).`,
  );
  return lines.join('\n');
}

/**
 * O ref do projeto Supabase na conexão: `postgres.<ref>` no usuário do pooler ou `db.<ref>.supabase.co` na conexão
 * direta. `null` se a conexão não for de um projeto Supabase.
 */
export function projectRefFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const user = decodeURIComponent(parsed.username);
  const fromUser = /^postgres\.([a-z0-9]{20})$/.exec(user)?.[1];
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(parsed.hostname)?.[1]?.toLowerCase();
  return fromUser ?? fromHost ?? null;
}

/** Problemas da conexão e do `--confirm`, antes de conectar. */
export function connectionProblems(url, confirm) {
  if (!url)
    return 'Defina a variável CRM_RESTORE_DB_URL com a conexão do projeto NOVO (Connect → Session pooler, com a senha do banco). A conexão nunca vai na linha de comando.';
  if (!/^postgres(ql)?:\/\//.test(url))
    return 'CRM_RESTORE_DB_URL precisa começar por postgresql://. Copie a conexão do Session pooler em Connect, no painel do projeto novo.';
  const invalid =
    'CRM_RESTORE_DB_URL não é uma conexão válida. Se a senha do banco tem @, #, /, % ou outros símbolos, codifique-os (veja a tabela em docs/BACKUP-RESTAURACAO.md).';
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return invalid;
  }
  // Um # ou ? sem código na senha faz o resto da conexão virar outra coisa (parte da senha seria lida como o servidor).
  if (parsed.hash || parsed.search.includes('@')) return invalid;
  const ref = projectRefFromUrl(url);
  if (!ref)
    return 'A conexão de CRM_RESTORE_DB_URL não é de um projeto Supabase (o usuário postgres.<ref> do Session pooler ou o servidor db.<ref>.supabase.co).';
  if (!confirm)
    return `Informe --confirm ${'<ref do projeto novo>'} para confirmar o projeto em que os dados serão gravados.`;
  if (confirm !== ref)
    return `--confirm ${confirm} não é o projeto da conexão (${ref}). Confira se a conexão é a do projeto NOVO; o projeto em uso nunca deve receber uma restauração.`;
  return null;
}

/** As versões de supabase_migrations.schema_migrations do projeto (deixadas pelo `npx supabase db push`). */
export async function readProjectVersions(client) {
  const { rows } = await client.query(
    "select to_regclass('supabase_migrations.schema_migrations') is not null as present",
  );
  if (!rows[0].present)
    throw new RestoreError(
      'O projeto não tem o histórico de migrações (supabase_migrations.schema_migrations). Rode npx supabase link e npx supabase db push no projeto novo antes de restaurar.',
    );
  const result = await client.query('select version, name from supabase_migrations.schema_migrations order by version');
  return result.rows.map((row) => ({ version: String(row.version), name: row.name ?? null }));
}

/**
 * A sessão lê as aspas do jeito que `parseInsert` leu: standard_conforming_strings on (a barra invertida não escapa nada)
 * e client_encoding UTF8. A lista permitida já garante isso; esta conferência é a defesa a mais.
 */
async function assertQuoting(client) {
  const { rows } = await client.query(
    "select current_setting('standard_conforming_strings') as scs, current_setting('client_encoding') as enc",
  );
  if (rows[0].scs !== 'on' || rows[0].enc !== 'UTF8')
    throw new RestoreError(
      `A sessão ficou com standard_conforming_strings ${rows[0].scs} e client_encoding ${rows[0].enc}; o backup só é lido com on e UTF8.`,
    );
}

const quoteTable = (table) => {
  const [schema, ...rest] = table.split('.');
  return `"${schema.replace(/"/g, '""')}"."${rest.join('.').replace(/"/g, '""')}"`;
};

/**
 * A restauração em si, numa transação só: o projeto vazio (restore-prepare.sql), a carga de cada comando do dump (com os
 * gatilhos desligados pela própria primeira linha do arquivo), as contagens por tabela iguais às informadas por cada
 * INSERT, as tabelas de public e private fora do dump ainda vazias, as chaves estrangeiras, os gatilhos e a RLS
 * (restore-check.sql). Só então `COMMIT` com `apply`; sem `apply`, `ROLLBACK` (ensaio). Qualquer falha desfaz tudo.
 * `backup` vem de `readBackupDir`; `client` é um `pg.Client` conectado ao projeto novo, como postgres.
 */
export async function restoreBackup({ client, backup, apply = false, log = () => undefined, root = ROOT }) {
  const statements = parseDump(backup.data);
  const skipped = skippedTables(statements);
  const backupVersions = parseHistoryVersions(backup.history);
  log('Conferindo as migrações do projeto');
  const problems = versionProblems(await readProjectVersions(client), backupVersions, backup.info?.commit);
  if (problems) throw new RestoreError(problems);
  const serverVersion = Number((await client.query('show server_version_num')).rows[0].server_version_num);
  const expected = new Map();
  const started = Date.now();
  await client.query('begin');
  try {
    await client.query('set local statement_timeout = 0');
    log('Conferindo se o projeto está vazio');
    await runSqlFile(client, path.join(root, PREPARE_FILE));
    log(`Gravando ${statements.filter((statement) => statement.kind === 'insert').length} comandos INSERT do backup`);
    if (skipped.length)
      log(`Deixando de fora os dados dos recursos ligados no painel, fora da base do CRM: ${listed(skipped)}`);
    for (const statement of statements) {
      if (statement.kind === 'skip') continue;
      // O pg_dump 17 escreve este parâmetro, que um servidor anterior ao 17 não conhece (ele não muda os dados).
      if (statement.kind === 'set' && statement.name === 'transaction_timeout' && serverVersion < 170000) continue;
      let result;
      try {
        if (statement.kind === 'insert') await assertQuoting(client);
        // Protocolo estendido: um comando por mensagem, nunca vários (revisão do item 1.5, rodada 2).
        result = await client.query({ text: statement.sql, queryMode: 'extended' });
      } catch (error) {
        throw new RestoreError(
          `${BACKUP_FILES.data}, comando da linha ${statement.line}${statement.table ? ` (${statement.table})` : ''}: ${error?.message ?? error}. Nada foi gravado.`,
        );
      }
      if (statement.kind === 'insert')
        expected.set(statement.table, (expected.get(statement.table) ?? 0) + (result.rowCount ?? 0));
    }
    // O RESET ALL do fim do dump volta os parâmetros ao padrão do papel.
    await client.query('set local statement_timeout = 0');
    log('Conferindo as contagens, as chaves estrangeiras, os gatilhos e a RLS');
    const counts = [];
    for (const [table, rows] of expected) {
      const { n } = (await client.query(`select count(*)::bigint as n from ${quoteTable(table)}`)).rows[0];
      if (Number(n) !== rows)
        throw new RestoreError(
          `A tabela ${table} ficou com ${n} linha(s), e o backup gravou ${rows}. Nada foi gravado.`,
        );
      counts.push({ table, rows });
    }
    const { rows: others } = await client.query(
      `select n.nspname||'.'||c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','private') and c.relkind in ('r','p') and not c.relispartition order by 1`,
    );
    for (const { name } of others) {
      if (expected.has(name) || RESTORE_SEEDED_TABLES.includes(name)) continue;
      const { present } = (await client.query(`select exists(select 1 from ${quoteTable(name)}) as present`)).rows[0];
      if (present)
        throw new RestoreError(`A tabela ${name}, fora do backup, tem linhas depois da carga. Nada foi gravado.`);
    }
    await runSqlFile(client, path.join(root, CHECK_FILE));
    await client.query(apply ? 'commit' : 'rollback');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (error instanceof RestoreError) throw error;
    const message = String(error?.message ?? error);
    throw new RestoreError(
      /nada foi gravado/i.test(message) ? message : `${message.replace(/\.$/, '')}. Nada foi gravado.`,
    );
  }
  return {
    applied: apply,
    counts: [...expected].map(([table, rows]) => ({ table, rows })),
    skipped,
    migrations: backupVersions.length,
    createdAt: backup.info?.createdAt ?? null,
    elapsedMs: Date.now() - started,
  };
}

/** O resumo da conferência de drift (supabase/db-drift-check.sql), numa transação só de leitura. */
export async function driftSummary(client, root = ROOT) {
  const sql = readFileSync(path.join(root, DRIFT_FILE), 'utf8');
  await client.query('begin read only');
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.query('rollback').catch(() => undefined);
  }
}
