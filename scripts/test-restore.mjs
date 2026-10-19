#!/usr/bin/env node
// Ensaio de restauração de um backup do CRM, de verdade (item 1.5; desenho em docs/arquitetura/1.5.md, seção 7), num
// PostgreSQL 17 descartável (scripts/lib/embedded-db.mjs). Nunca aponte este script para um banco remoto.
//
// 1. Banco crm_origem: bootstrap, todas as migrações (como o db push) com o histórico, a equipe (Dono, administradora,
//    colaborador e uma pessoa desativada, com senha), um convite pendente, uma sessão do Auth, a prova de e-mail e o seed
//    de demonstração (item 1.15).
// 2. Dump REAL com o pg_dump 17 e as opções do CLI fixado (scripts/lib/backup-dump.mjs), mais os -x do workflow e o
//    mesmo pós-processamento do CLI, e o backup-info.json com os sha256: a mesma pasta que sai do .7z do workflow.
// 3. Banco crm_destino: as mesmas migrações e o histórico; restauração com o código do npm run backup:restore (--apply).
// 4. Conferências: conteúdo de cada tabela, senhas e desativação, RLS, gatilhos funcionando, extensões e schemas,
//    drift zero, a remoção da demonstração e o caminho descartado (o schema do CLI sem os gatilhos em auth).
// 5. Recusas, num banco de destino à parte que termina vazio.
//
// Exige o pg_dump 17 ou mais novo, que o embedded-postgres não traz: CRM_PG_BIN, o PATH ou, no Windows,
// C:\Program Files\PostgreSQL\<17 a 19>\bin. Sem ele, termina com 1 e diz como instalar (o ensaio nunca "passa" pulado).
// O test:db roda o mesmo ensaio com o pg_dump simulado (scripts/lib/pg-dump-simulator.mjs), que prova o código da
// restauração em qualquer máquina, mas não o formato do programa real: essa prova é só daqui.
// `--check-cli` também compara as opções fixadas com o `supabase db dump --dry-run` do CLI fixado (precisa de rede).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  BACKUP_CLI_VERSION,
  BACKUP_EXCLUDED_TABLES,
  CLI_DATA_DUMP,
  CLI_HISTORY_DUMP,
  dryRunDifferences,
} from './lib/backup-dump.mjs';
import { RestoreError } from './lib/backup-restore.mjs';
import { TEMP_PREFIXES, runWithEmbeddedDb } from './lib/embedded-db.mjs';
import { RehearsalError, check, pgDumpRunner, rehearsalProgress, rehearse } from './lib/restore-rehearsal.mjs';

const USAGE = 'Uso: npm run test:restore [-- --check-cli]';
const MIN_PG_DUMP_MAJOR = 17;

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check-cli')) {
  console.error(USAGE);
  process.exit(2);
}
const checkCli = args.includes('--check-cli');

// ---------------------------------------------------------------------------------------------
function findPgDump() {
  const executable = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  const candidates = [];
  if (process.env.CRM_PG_BIN) candidates.push(path.join(process.env.CRM_PG_BIN, executable));
  candidates.push(executable);
  if (process.platform === 'win32')
    for (const major of [19, 18, 17]) candidates.push(`C:\\Program Files\\PostgreSQL\\${major}\\bin\\pg_dump.exe`);
  const found = [];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status !== 0) continue;
    const major = Number(/(\d+)(?:\.\d+)?/.exec(probe.stdout)?.[1]);
    found.push(`${candidate} (${probe.stdout.trim()})`);
    if (major >= MIN_PG_DUMP_MAJOR) return { path: candidate, version: probe.stdout.trim() };
  }
  return { path: null, found };
}

function missingPgDump(found) {
  const lines = [
    `O ensaio de restauração precisa do pg_dump ${MIN_PG_DUMP_MAJOR} ou mais novo (o mesmo major do PostgreSQL do ensaio ou acima), e ele não foi encontrado.`,
  ];
  if (found.length) lines.push(`  Encontrado, mas antigo: ${found.join('; ')}.`);
  lines.push(
    '  Windows: o instalador oficial do PostgreSQL 17 (postgresql.org/download/windows) com só "Command Line Tools" marcado,',
    '    ou os binários em zip, extraídos numa pasta qualquer, sem instalar nada, e $env:CRM_PG_BIN = "<pasta>\\pgsql\\bin".',
    '  macOS: brew install libpq (e CRM_PG_BIN apontando para $(brew --prefix libpq)/bin).',
    '  Linux: o pacote postgresql-client-17 do repositório do PostgreSQL (PGDG).',
    '  No CI, o job "restauracao" instala o cliente 17 e roda este ensaio.',
    '  Sem o pg_dump, o npm run test:db roda o mesmo ensaio com um pg_dump simulado, que não substitui este.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// As opções fixadas contra o --dry-run do CLI.
// ---------------------------------------------------------------------------------------------
function compareWithCli() {
  console.log(`Comparando as opções do dump com o --dry-run do CLI ${BACKUP_CLI_VERSION}`);
  const dummy = 'postgresql://postgres:ensaio@127.0.0.1:1/postgres';
  const run = (extra) => {
    const result = spawnSync(
      'npx',
      [
        '--yes',
        `supabase@${BACKUP_CLI_VERSION}`,
        'db',
        'dump',
        '--db-url',
        dummy,
        '--data-only',
        '--dry-run',
        ...extra,
      ],
      { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.status !== 0) throw new RehearsalError(`o --dry-run do CLI falhou: ${result.stderr || result.stdout}`);
    return `${result.stdout}\n${result.stderr}`;
  };
  const data = dryRunDifferences(
    run(BACKUP_EXCLUDED_TABLES.flatMap((table) => ['-x', table])),
    CLI_DATA_DUMP,
    BACKUP_EXCLUDED_TABLES,
  );
  check(!data.length, `cli: the data dump options match supabase db dump --dry-run of CLI ${BACKUP_CLI_VERSION}`, data);
  const history = dryRunDifferences(run(['--schema', 'supabase_migrations']), CLI_HISTORY_DUMP);
  check(
    !history.length,
    `cli: the history dump options match supabase db dump --dry-run of CLI ${BACKUP_CLI_VERSION}`,
    history,
  );
}

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
const pgDumpFound = findPgDump();
if (!pgDumpFound.path) {
  console.error(missingPgDump(pgDumpFound.found));
  process.exit(1);
}
console.log(`pg_dump: ${pgDumpFound.path} (${pgDumpFound.version})`);
if (checkCli) {
  try {
    compareWithCli();
  } catch (error) {
    console.error(`Falha na comparação com o CLI: ${error.message}`);
    process.exit(1);
  }
}

const progress = () => {
  const { passCount, lastPass } = rehearsalProgress();
  return `${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`;
};

await runWithEmbeddedDb({
  tempPrefix: TEMP_PREFIXES.restore,
  applicationName: 'crm-test-restore',
  run: (db) => rehearse(db, pgDumpRunner(pgDumpFound.path)),
  describeError: (error) =>
    error instanceof RehearsalError || error instanceof RestoreError
      ? [`Falha no ensaio de restauração: ${error.message}`, `  Verificações aprovadas antes da falha: ${progress()}`]
      : undefined,
  sqlFailureDetails: () => [`  Verificações aprovadas antes da falha: ${progress()}`],
  successMessage: () =>
    `\n${rehearsalProgress().passCount} verificações do ensaio de restauração passaram. Cluster temporário removido.`,
});
