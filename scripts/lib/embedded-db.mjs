// PostgreSQL 17 descartável para os scripts do banco (`npm run test:db` e `npm run gen:types`).
// Funciona em Windows, macOS e Linux sem PostgreSQL instalado: os binários vêm de `embedded-postgres`.
// O cluster escuta só em 127.0.0.1, numa porta livre, dentro de um diretório temporário que é
// apagado ao final, inclusive em falha ou Ctrl+C. Nunca aponte estes arquivos para um banco remoto.
//
// Uso: `await runWithEmbeddedDb({ run: async (db) => { await db.applySchema(); ... } })`. O runner sobe o
// cluster, chama `run`, imprime a falha (se houver), apaga o cluster e encerra o processo com o código certo.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BOOTSTRAP_FILE = 'supabase/tests/local-bootstrap.sql';
export const MIGRATIONS_DIR = 'supabase/migrations';
// Prefixos dos diretórios temporários de cada script; a limpeza de execuções antigas cobre todos.
export const TEMP_PREFIXES = Object.freeze({ testDb: 'crm-test-db-', genTypes: 'crm-gen-types-' });
const STALE_AFTER_MS = 60 * 60 * 1000;
const MAX_INCLUDE_DEPTH = 8;
const SERVER_LOG_LINES = 40;
const BYTE_ORDER_MARK = 0xfeff;

const state = {
  tempRoot: null,
  dataDir: null,
  cluster: null,
  startup: null,
  clusterStarted: false,
  client: null,
  interrupted: false,
  interruption: null,
};
const serverLog = [];

export class SqlFileError extends Error {
  constructor(cause, file, line, exact) {
    super(cause instanceof Error ? cause.message : String(cause));
    Object.assign(this, { cause, file, line, exact });
  }
}

export const toDisplayPath = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const countLines = (text, end) => {
  let lines = 0;
  for (let index = 0; index < end; index += 1) if (text.charCodeAt(index) === 10) lines += 1;
  return lines;
};

function remember(message) {
  for (const line of String(message).split(/\r?\n/)) if (line.trim()) serverLog.push(line);
  if (serverLog.length > SERVER_LOG_LINES) serverLog.splice(0, serverLog.length - SERVER_LOG_LINES);
}

// ---------------------------------------------------------------------------------------------
// Leitura dos arquivos SQL, como `psql -f`: cada comando vai ao servidor separadamente, na ordem
// do arquivo, para que a falha aponte o arquivo e a linha. O único meta-comando aceito é
// `\ir arquivo.sql` (`\include_relative`), que mantém os testes compatíveis com o psql.
// ---------------------------------------------------------------------------------------------
const isIdentifierChar = (char) => char !== undefined && /[\p{L}\p{N}_$]/u.test(char);
const DOLLAR_QUOTE = /^\$(?:[\p{L}_][\p{L}\p{N}_]*)?\$/u;
const ROUTINE_WORDS = new Set(['create', 'or', 'replace', 'function', 'procedure']);

function skipQuoted(text, start, quote, backslashEscapes) {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (backslashEscapes && char === '\\') index += 2;
    else if (char === quote && text[index + 1] === quote) index += 2;
    else if (char === quote) return index + 1;
    else index += 1;
  }
  return text.length;
}

function parseMetaCommand(command, file, line) {
  const [name, ...rest] = command.split(/\s+/);
  const argument = rest
    .join(' ')
    .replace(/^'(.*)'$/s, '$1')
    .trim();
  if ((name === '\\ir' || name === '\\include_relative') && argument)
    return { kind: 'include', target: argument, line };
  throw new SqlFileError(
    `meta-comando do psql não suportado: ${command}. O runner aceita só \\ir; troque \\gset e :'variável' por set_config('test.<nome>', ..., true) e current_setting('test.<nome>').`,
    file,
    line,
    true,
  );
}

// Divide o script nos mesmos pontos que o psql: `;` fora de aspas, comentários, dollar quotes e
// parênteses, e fora de corpos BEGIN ATOMIC ... END de CREATE [OR REPLACE] FUNCTION|PROCEDURE.
export function splitSqlScript(source, file) {
  const text = source.charCodeAt(0) === BYTE_ORDER_MARK ? source.slice(1) : source;
  const steps = [];
  let firstToken = -1;
  let parenDepth = 0;
  let blockDepth = 0;
  let words = [];
  const lineOf = (position) => 1 + countLines(text, position);
  const finish = (end) => {
    if (firstToken !== -1) steps.push({ kind: 'sql', sql: text.slice(firstToken, end), line: lineOf(firstToken) });
    firstToken = -1;
    parenDepth = 0;
    blockDepth = 0;
    words = [];
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '-' && next === '-') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      let depth = 1;
      index += 2;
      while (index < text.length && depth > 0) {
        if (text[index] === '/' && text[index + 1] === '*') {
          depth += 1;
          index += 2;
        } else if (text[index] === '*' && text[index + 1] === '/') {
          depth -= 1;
          index += 2;
        } else index += 1;
      }
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '\\') {
      const end = text.indexOf('\n', index);
      const lineEnd = end === -1 ? text.length : end;
      const step = parseMetaCommand(text.slice(index, lineEnd).trim(), file, lineOf(index));
      if (firstToken !== -1) throw new SqlFileError('\\ir no meio de um comando SQL', file, step.line, true);
      steps.push(step);
      index = lineEnd;
      continue;
    }
    if (firstToken === -1) firstToken = index;
    const dollarTag =
      char === '$' && !isIdentifierChar(text[index - 1])
        ? DOLLAR_QUOTE.exec(text.slice(index, index + 64))?.[0]
        : undefined;
    if (char === "'") {
      const escapeString = /[eE]/.test(text[index - 1] ?? '') && !isIdentifierChar(text[index - 2]);
      index = skipQuoted(text, index, "'", escapeString);
    } else if (char === '"') {
      index = skipQuoted(text, index, '"', false);
    } else if (dollarTag) {
      const close = text.indexOf(dollarTag, index + dollarTag.length);
      index = close === -1 ? text.length : close + dollarTag.length;
    } else if (/[\p{L}_]/u.test(char)) {
      let end = index + 1;
      while (end < text.length && isIdentifierChar(text[end])) end += 1;
      const word = text.slice(index, end).toLowerCase();
      words.push(ROUTINE_WORDS.has(word) ? word : '');
      const [first, second, third, fourth] = words;
      const createsRoutine =
        first === 'create' &&
        (second === 'function' ||
          second === 'procedure' ||
          (second === 'or' && third === 'replace' && (fourth === 'function' || fourth === 'procedure')));
      if (createsRoutine && parenDepth === 0) {
        if (word === 'begin') blockDepth += 1;
        else if (word === 'case' && blockDepth > 0) blockDepth += 1;
        else if (word === 'end' && blockDepth > 0) blockDepth -= 1;
      }
      index = end;
    } else if (char === '(') {
      parenDepth += 1;
      index += 1;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      index += 1;
    } else if (char === ';' && parenDepth === 0 && blockDepth === 0) {
      index += 1;
      finish(index);
    } else index += 1;
  }
  finish(text.length);
  return steps;
}

export async function runSqlFile(client, absolutePath, depth = 0) {
  const file = toDisplayPath(absolutePath);
  const steps = splitSqlScript(await readFile(absolutePath, 'utf8'), file);
  for (const step of steps) {
    if (step.kind === 'include') {
      if (depth >= MAX_INCLUDE_DEPTH)
        throw new SqlFileError(`\\ir aninhado demais (limite ${MAX_INCLUDE_DEPTH})`, file, step.line, true);
      const target = path.resolve(path.dirname(absolutePath), step.target);
      if (!existsSync(target))
        throw new SqlFileError(`arquivo incluído não encontrado: ${step.target}`, file, step.line, true);
      await runSqlFile(client, target, depth + 1);
      continue;
    }
    try {
      await client.query(step.sql);
    } catch (error) {
      const position = Number(error?.position);
      const exact = Number.isInteger(position) && position > 0;
      throw new SqlFileError(error, file, exact ? step.line + countLines(step.sql, position - 1) : step.line, exact);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ciclo de vida do cluster temporário.
// ---------------------------------------------------------------------------------------------
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function isPostgresProcess(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const probe =
    process.platform === 'win32'
      ? spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
      : spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
  return /postgres/i.test(probe.stdout ?? '');
}

function readPostmasterPid(dataDir) {
  try {
    const pid = Number.parseInt(readFileSync(path.join(dataDir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0], 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// Último recurso, síncrono: encerra um postmaster que ainda esteja vivo neste diretório.
function killPostmasterSync(dataDir) {
  const pid = dataDir && readPostmasterPid(dataDir);
  if (!pid || !isPostgresProcess(pid)) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(pid, 'SIGQUIT');
    } catch {
      /* já encerrado */
    }
  }
  for (let attempt = 0; attempt < 50 && isPostgresProcess(pid); attempt += 1) sleepSync(100);
}

function removeTempRootSync() {
  if (!state.tempRoot) return;
  killPostmasterSync(state.dataDir);
  try {
    rmSync(state.tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* o aviso abaixo informa o caminho */
  }
  if (existsSync(state.tempRoot))
    process.stderr.write(`Aviso: não foi possível apagar ${state.tempRoot}; apague manualmente.\n`);
  state.tempRoot = null;
}

// Execuções encerradas à força (sem chance de limpeza) deixam diretórios para trás: apagar os antigos.
function sweepStaleClusters() {
  let entries = [];
  try {
    entries = readdirSync(tmpdir(), { withFileTypes: true });
  } catch {
    return;
  }
  const prefixes = Object.values(TEMP_PREFIXES);
  for (const entry of entries) {
    if (!entry.isDirectory() || !prefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
    const directory = path.join(tmpdir(), entry.name);
    try {
      if (Date.now() - statSync(directory).mtimeMs < STALE_AFTER_MS) continue;
      const pid = readPostmasterPid(path.join(directory, 'data'));
      if (pid && isPostgresProcess(pid)) continue;
      rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* fica para a próxima execução */
    }
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: tempo esgotado após ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const postmasterRunning = () => {
  const pid = state.dataDir && readPostmasterPid(state.dataDir);
  return Boolean(pid && isPostgresProcess(pid));
};

let cleanupPromise = null;
function cleanup() {
  cleanupPromise ??= (async () => {
    // Espera initdb/start terminarem: os arquivos do cluster só podem ser apagados depois disso.
    await state.startup?.catch(() => undefined);
    if (state.client) await withTimeout(state.client.end(), 5_000, 'encerrar conexão').catch(() => undefined);
    if (state.cluster && state.clusterStarted && postmasterRunning()) {
      await withTimeout(state.cluster.stop(), 20_000, 'parar PostgreSQL').catch((error) => remember(error.message));
    }
    killPostmasterSync(state.dataDir);
    if (state.tempRoot) {
      await rm(state.tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
        () => undefined,
      );
      if (existsSync(state.tempRoot))
        throw new Error(`não foi possível apagar o cluster temporário em ${state.tempRoot}`);
      state.tempRoot = null;
    }
  })();
  return cleanupPromise;
}

// Ctrl+C e afins: o gancho de sinais do `embedded-postgres` encerra o processo sem esperar o initdb
// nem apagar o diretório temporário, então é substituído por este. Um segundo sinal força a saída;
// o gancho síncrono de `exit` ainda tenta encerrar o postmaster e apagar o diretório.
let hooksInstalled = false;
function installProcessHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on('exit', removeTempRootSync);
  // O mesmo pacote registra um `beforeExit` que chama process.exit(0): se algum await ficasse pendente
  // com o event loop vazio, a execução terminaria "verde" sem ter terminado o trabalho.
  for (const listener of process.listeners('beforeExit')) process.removeListener('beforeExit', listener);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    for (const listener of process.listeners(signal)) process.removeListener(signal, listener);
    process.on(signal, () => {
      if (state.interrupted) process.exit(130);
      state.interrupted = true;
      process.stderr.write(`\nInterrompido (${signal}); parando e apagando o cluster temporário.\n`);
      state.interruption = cleanup().then(
        () => process.stderr.write('Cluster temporário removido.\n'),
        (error) => process.stderr.write(`Falha ao remover o cluster temporário: ${error.message}\n`),
      );
      state.interruption.finally(() => process.exit(130));
    });
  }
}

const printNotice = (notice) => process.stdout.write(`  ${notice.severity ?? 'NOTICE'}: ${notice.message ?? ''}\n`);

function printFailure(error, { sqlFailureDetails, describeError }) {
  if (state.interrupted) return;
  const lines = [];
  if (error instanceof SqlFileError) {
    const cause = error.cause;
    lines.push(`Falha em ${error.file}, ${error.exact ? 'linha' : 'comando iniciado na linha'} ${error.line}:`);
    lines.push(`  ${cause?.severity ?? 'ERRO'}${cause?.code ? ` ${cause.code}` : ''}: ${error.message}`);
    if (cause?.detail) lines.push(`  Detalhe: ${cause.detail}`);
    if (cause?.hint) lines.push(`  Dica: ${cause.hint}`);
    if (cause?.where) lines.push(`  Contexto: ${cause.where.replace(/\n/g, '\n            ')}`);
    if (cause?.internalQuery) lines.push(`  Consulta interna: ${cause.internalQuery}`);
    lines.push(...(sqlFailureDetails?.() ?? []));
  } else {
    const described = describeError?.(error);
    if (described) lines.push(...described);
    else {
      lines.push(
        `Falha ao preparar o PostgreSQL temporário: ${error instanceof Error && error.message ? error.message : String(error ?? 'processo encerrado')}`,
      );
      if (serverLog.length) lines.push('  Últimas linhas do servidor:', ...serverLog.map((line) => `    ${line}`));
    }
  }
  process.stderr.write(`${lines.join('\n')}\n`);
}

// Sobe o cluster e devolve as operações disponíveis para o script; `null` se houve interrupção.
async function startCluster({ tempPrefix, applicationName }) {
  sweepStaleClusters();
  state.tempRoot = await mkdtemp(path.join(tmpdir(), tempPrefix));
  state.dataDir = path.join(state.tempRoot, 'data');
  const port = await findFreePort();
  const password = randomBytes(24).toString('base64url');

  state.cluster = new EmbeddedPostgres({
    databaseDir: state.dataDir,
    port,
    user: 'postgres',
    password,
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: [
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      'unix_socket_directories=',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ],
    onLog: remember,
    onError: (error) => remember(error instanceof Error ? error.message : String(error)),
  });

  state.startup = state.cluster.initialise();
  await state.startup;
  if (state.interrupted) return null;
  state.startup = withTimeout(state.cluster.start(), 60_000, 'iniciar PostgreSQL').then(() => {
    state.clusterStarted = true;
  });
  await state.startup;
  if (state.interrupted) return null;

  const connection = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' };

  // Uma sessão nova por chamada, como `psql -f` em processos separados: papel, search_path,
  // transações e GUCs de um arquivo não vazam para o seguinte.
  const withSession = async (work, { onNotice = printNotice } = {}) => {
    const client = new pg.Client({ ...connection, application_name: applicationName });
    client.on('error', (error) => remember(error.message));
    client.on('notice', onNotice);
    state.client = client;
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end().catch(() => undefined);
      state.client = null;
    }
  };
  const runInFreshSession = (absolutePath, options) =>
    withSession((client) => runSqlFile(client, absolutePath), options);

  const probe = new pg.Client(connection);
  await probe.connect();
  const { rows } = await probe.query('show server_version');
  await probe.end();
  console.log(`PostgreSQL ${rows[0].server_version} temporário em 127.0.0.1:${port}`);

  return {
    port,
    withSession,
    runInFreshSession,
    // Bootstrap local (papéis e schema auth mínimos do Supabase) e todas as migrações, em ordem.
    // `beforeMigration(nome)` roda antes de cada migração, por exemplo para gravar dados no formato
    // antigo e conferir depois o backfill feito por ela.
    async applySchema({ beforeMigration } = {}) {
      console.log(`Aplicando ${BOOTSTRAP_FILE}`);
      await runInFreshSession(path.join(ROOT, BOOTSTRAP_FILE));
      const migrations = (await readdir(path.join(ROOT, MIGRATIONS_DIR)))
        .filter((name) => name.endsWith('.sql'))
        .sort();
      console.log(`Aplicando ${migrations.length} migrações de ${MIGRATIONS_DIR}`);
      for (const migration of migrations) {
        await beforeMigration?.(migration);
        console.log(`  ${migration}`);
        await runInFreshSession(path.join(ROOT, MIGRATIONS_DIR, migration));
      }
    },
  };
}

/**
 * Sobe o cluster, executa `run(db)`, apaga o cluster e encerra o processo (0, 1 ou 130 se interrompido).
 * - `successMessage()`: texto impresso quando tudo deu certo, depois da limpeza;
 * - `sqlFailureDetails()`: linhas extras quando um arquivo SQL falha;
 * - `describeError(error)`: linhas para erros próprios do script (sem retorno, vale a mensagem padrão).
 */
export async function runWithEmbeddedDb({
  tempPrefix = TEMP_PREFIXES.testDb,
  applicationName = 'crm-test-db',
  run,
  successMessage = () => 'Cluster temporário removido.',
  sqlFailureDetails,
  describeError,
}) {
  installProcessHooks();
  let exitCode = 0;
  try {
    const db = await startCluster({ tempPrefix, applicationName });
    if (db) await run(db);
  } catch (error) {
    exitCode = 1;
    printFailure(error, { sqlFailureDetails, describeError });
  }
  try {
    await cleanup();
    if (state.interrupted) {
      await state.interruption;
      process.exit(130);
    }
    if (exitCode === 0) console.log(successMessage());
    else console.error('Cluster temporário removido.');
  } catch (error) {
    exitCode = 1;
    console.error(`Falha ao remover o cluster temporário: ${error.message}`);
  }
  // Saída explícita: o gancho de saída do embedded-postgres encerraria com código 0 em `beforeExit`.
  process.exit(state.interrupted ? 130 : exitCode);
}

export const isInterrupted = () => state.interrupted;
