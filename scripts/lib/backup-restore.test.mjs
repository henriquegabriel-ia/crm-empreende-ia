// @vitest-environment node
// Item 1.5 (docs/arquitetura/1.5.md, seção 16.1): as funções puras da restauração (`npm run backup:restore`): a pasta do
// backup, a lista permitida de comandos do dump, o histórico das migrações, a comparação das versões e a conexão. A
// restauração num banco de verdade é conferida pelo test:db (os SQL de apoio e o ensaio com o pg_dump simulado) e pelo
// ensaio `npm run test:restore` (com o pg_dump real).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BACKUP_FILES,
  PLATFORM_SCHEMAS,
  PREPARE_FILE,
  RESTORE_SEEDED_TABLES,
  RestoreError,
  classifyDumpStatement,
  compareVersions,
  connectionProblems,
  parseDump,
  parseHistoryVersions,
  parseInsert,
  projectRefFromUrl,
  readBackupDir,
  sha256,
  skippedTables,
  versionProblems,
} from './backup-restore.mjs';
import { ROOT, splitSqlScript } from './embedded-db.mjs';

const REF = 'abcdefghijklmnopqrst';
const POOLER = `postgresql://postgres.${REF}:senha%40forte@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
const DIRECT = `postgresql://postgres:senha@db.${REF}.supabase.co:5432/postgres`;

// Um data.sql no formato do supabase db dump --data-only (pg_dump 17 com --column-inserts e o pós-processamento do CLI).
const DATA_SQL = `SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \\restrict 7f3kq9XyZ

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

INSERT INTO "auth"."users" ("instance_id", "id", "email", "encrypted_password") VALUES
\t('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000001', 'dono@example.test', '$2a$10$abc;def');

INSERT INTO "public"."organizations" ("id", "name") VALUES
\t('10000000-0000-0000-0000-000000000001', 'Empresa; com ponto e vírgula');

INSERT INTO "public"."activities" ("id", "org_id", "title", "description") VALUES
\t('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ligar (de novo)', 'Disse: "não hoje"; ligar amanhã $$ às 10h'),
\t('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'D''Ávila', NULL);

SELECT pg_catalog.setval('"public"."sequencia_exemplo"', 42, true);

-- \\unrestrict 7f3kq9XyZ

RESET ALL;
`;

// O history.sql (supabase db dump --data-only --schema supabase_migrations): a coluna statements guarda SQL de verdade.
const HISTORY_SQL = `SET session_replication_role = replica;
SET statement_timeout = 0;
INSERT INTO "supabase_migrations"."schema_migrations" ("version", "statements", "name") VALUES
\t('20260906051319', '{"create table public.x (id uuid, nome text default ''a,b'')","select 1; -- (comentário)"}', 'commercial_foundation'),
\t('20261019110000', '{"create function private.f() returns void language sql as $$ select 1 $$"}', 'update_protection');
RESET ALL;
`;

const temporary = [];
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

function backupDir({ data = DATA_SQL, history = HISTORY_SQL, info } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-restore-vitest-'));
  temporary.push(dir);
  writeFileSync(path.join(dir, BACKUP_FILES.data), data);
  writeFileSync(path.join(dir, BACKUP_FILES.history), history);
  const files = {
    [BACKUP_FILES.data]: { bytes: Buffer.byteLength(data), sha256: sha256(data) },
    [BACKUP_FILES.history]: { bytes: Buffer.byteLength(history), sha256: sha256(history) },
  };
  writeFileSync(
    path.join(dir, BACKUP_FILES.info),
    JSON.stringify(info ?? { format: 1, createdAt: '2026-10-19T05:30:00Z', commit: 'abc1234', files }),
  );
  return dir;
}

describe('pasta do backup', () => {
  it('lê os três arquivos e confere o sha256 de cada um', () => {
    const backup = readBackupDir(backupDir());
    expect(backup.info.createdAt).toBe('2026-10-19T05:30:00Z');
    expect(backup.data).toBe(DATA_SQL);
    expect(backup.history).toBe(HISTORY_SQL);
  });

  it('recusa pasta ausente, arquivo faltando, JSON inválido, formato desconhecido e sha256 diferente', () => {
    expect(() => readBackupDir(path.join(tmpdir(), 'nao-existe-crm'))).toThrow(/não existe/);
    const missing = backupDir();
    rmSync(path.join(missing, BACKUP_FILES.history));
    expect(() => readBackupDir(missing)).toThrow(/Esta pasta não é um backup completo do CRM \(falta history.sql\)/);
    const broken = backupDir();
    writeFileSync(path.join(broken, BACKUP_FILES.info), '{ quebrado');
    expect(() => readBackupDir(broken)).toThrow(/não é um JSON válido/);
    expect(() => readBackupDir(backupDir({ info: { format: 2, files: {} } }))).toThrow(/sem o formato 1/);
    const tampered = backupDir();
    writeFileSync(path.join(tampered, BACKUP_FILES.data), `${DATA_SQL}-- alterado\n`);
    expect(() => readBackupDir(tampered)).toThrow(/data.sql foi alterado ou está incompleto: o sha256 não bate/);
  });

  it('só aceita um commit no formato do GITHUB_SHA: outro valor não entra no comando sugerido', () => {
    expect(readBackupDir(backupDir()).info.commit).toBe('abc1234');
    const files = JSON.parse(readFileSync(path.join(backupDir(), BACKUP_FILES.info), 'utf8')).files;
    for (const commit of ['abc; Remove-Item -Recurse C:\\', 'main', '$(rm -rf ~)', 42]) {
      const backup = readBackupDir(backupDir({ info: { format: 1, commit, files } }));
      expect(backup.info.commit, String(commit)).toBeNull();
      const message = versionProblems([], parseHistoryVersions(HISTORY_SQL), backup.info.commit);
      expect(message).not.toContain('git switch --detach');
      expect(message).not.toContain('Remove-Item');
    }
  });
});

describe('lista permitida do dump', () => {
  it('aceita cada forma que o pg_dump e o CLI escrevem', () => {
    const statements = parseDump(DATA_SQL);
    expect(statements.map((statement) => statement.kind)).toEqual([
      ...Array(7).fill('set'),
      'set_config',
      ...Array(4).fill('set'),
      'insert',
      'insert',
      'insert',
      'setval',
      'reset',
    ]);
    expect(statements.filter((statement) => statement.kind === 'insert').map((statement) => statement.table)).toEqual([
      'auth.users',
      'public.organizations',
      'public.activities',
    ]);
    // O INSERT de várias linhas, com ; e $$ dentro dos valores, é um comando só.
    expect(statements.find((statement) => statement.table === 'public.activities').sql).toContain("'D''Ávila', NULL);");
  });

  it('recusa DDL, DO, COPY, INSERT fora de auth, public, private e storage, e SET role', () => {
    for (const sql of [
      'DROP TABLE public.contacts;',
      'CREATE TABLE public.x (id int);',
      'DO $$ begin perform 1; end $$;',
      'COPY "public"."contacts" ("id") FROM stdin;',
      'INSERT INTO "extensions"."x" ("id") VALUES (1);',
      'INSERT INTO "supabase_migrations"."schema_migrations" ("version") VALUES (\'1\');',
      'SET role = authenticated;',
      'SET session_authorization = postgres;',
      // Só o par exato do pg_dump passa: outro valor mudaria a leitura das aspas no servidor (revisão do 1.5, rodada 2).
      'SET standard_conforming_strings = off;',
      "SET client_encoding = 'SJIS';",
      "SET client_encoding = 'utf8';",
      'SET session_replication_role = origin;',
      'SET search_path = public;',
      'SET statement_timeout TO 0;',
      'SET  lock_timeout = 0;',
      'SET Row_Security = off;',
      "SELECT pg_catalog.set_config('search_path', '', false), private.anonymize_contact(null);",
      'SELECT private.provision_organization(null, null);',
      'TRUNCATE public.contacts;',
    ])
      expect(classifyDumpStatement(sql), sql).toBeNull();
    expect(() => parseDump(DATA_SQL.replace('RESET ALL;', 'DROP TABLE public.contacts;\nRESET ALL;'))).toThrow(
      /linha \d+: comando fora da lista permitida \(DROP TABLE public.contacts;\)/,
    );
  });

  it('recusa o dump que desliga standard_conforming_strings para fechar um literal antes e injetar um COMMIT', () => {
    const injected = `SET session_replication_role = replica;
SET standard_conforming_strings = off;
INSERT INTO "public"."organizations" ("id", "name", "slug") VALUES ('x\\',' , 1, 2); COMMIT; CREATE ROLE evil LOGIN; --', 3);
RESET ALL;
`;
    expect(() => parseDump(injected)).toThrow(
      /linha 2: comando fora da lista permitida \(SET standard_conforming_strings = off;\)/,
    );
    expect(() => parseDump(DATA_SQL.replace("SET client_encoding = 'UTF8';", "SET client_encoding = 'SJIS';"))).toThrow(
      /comando fora da lista permitida \(SET client_encoding = 'SJIS';\)/,
    );
  });

  it('recusa meta-comandos do psql sem segui-los, com a explicação do \\restrict sem comentário', () => {
    expect(() => parseDump(`\\ir outro.sql\n${DATA_SQL}`)).toThrow(
      /linha 1: meta-comando do psql não aceito \(\\ir outro.sql\)/,
    );
    expect(() => parseDump(`\\restrict chave\n${DATA_SQL}`)).toThrow(/"\\restrict" sem comentário.*pg_dump direto/);
    expect(() => parseDump(`${DATA_SQL}\\unrestrict chave\n`)).toThrow(/"\\unrestrict" sem comentário/);
    expect(() => parseDump(`\\gset\n${DATA_SQL}`)).toThrow(/meta-comando do psql/);
    // O modo restrito do leitor devolve o meta-comando em vez de interpretá-lo.
    expect(splitSqlScript('\\ir x.sql\nselect 1;', 'x.sql', { restricted: true })[0]).toEqual({
      kind: 'meta',
      command: '\\ir x.sql',
      line: 1,
    });
  });

  it('confere o INSERT inteiro no formato do pg_dump: só literais, sem subconsulta, função, SELECT, ON CONFLICT ou RETURNING', () => {
    const head = 'INSERT INTO "public"."organizations" ("id", "name")';
    for (const sql of [
      `${head} VALUES ((SELECT pg_catalog.set_config('session_replication_role', 'origin', false)), 'x');`,
      `${head} VALUES ('1', (select 'x'));`,
      `${head} VALUES ('1', now());`,
      `${head} VALUES ('1', cron.schedule('x', '* * * * *', 'grant all on all tables in schema public to anon'));`,
      'INSERT INTO "public"."organizations" ("id") SELECT id FROM auth.users;',
      `INSERT INTO "auth"."users" ("id") VALUES ('x') ON CONFLICT ("id") DO UPDATE SET encrypted_password = 'trocada';`,
      `${head} VALUES ('1', 'a') RETURNING *;`,
      `${head} VALUES ('1', 'a'); DELETE FROM public.contacts;`,
      `${head} VALUES ('1');`,
      `${head} VALUES ('1', 'a', 'b');`,
      `${head} VALUES ('1', E'a\\'b');`,
      `${head} VALUES ('1', 'a'::text);`,
      `${head} VALUES ('1', DEFAULT);`,
      `${head} VALUES ('1', 'a') -- comentário`,
      `${head} VALUES ('1', 'a'),;`,
      `${head} VALUES;`,
      'INSERT INTO public.organizations ("id") VALUES (1);',
    ])
      expect(classifyDumpStatement(sql), sql).toBeNull();
    // As formas que o pg_dump escreve passam: identidade ALWAYS, números, bit, booleanos e NULL.
    const accepted = parseInsert(
      `INSERT INTO "public"."t" ("a", "b", "c", "d", "e", "f") OVERRIDING SYSTEM VALUE VALUES\n\t(1, -2.5e-05, B'0101', true, false, NULL),\n\t(3, .5, B'', true, false, 'x''y');`,
      { withValues: true },
    );
    expect(accepted).toMatchObject({ schema: 'public', table: 't', rows: 2 });
    expect(accepted.tuples[1]).toEqual(['3', '.5', "B''", 'true', 'false', "x'y"]);
  });

  it('recusa set_config de outro parâmetro que não o search_path, e setval fora dos schemas do CRM', () => {
    expect(classifyDumpStatement("SELECT pg_catalog.set_config('search_path', '', false);")).toEqual({
      kind: 'set_config',
    });
    for (const sql of [
      "SELECT pg_catalog.set_config('role', 'authenticated', false);",
      "SELECT pg_catalog.set_config('session_authorization', 'postgres', false);",
      "SELECT pg_catalog.set_config('session_replication_role', 'origin', false);",
      "SELECT pg_catalog.set_config('search_path', 'public, pg_temp', false);",
      "SELECT pg_catalog.set_config('search_path', '', true);",
      'SELECT pg_catalog.setval(\'"extensions"."x_seq"\', 1, true);',
      "SELECT pg_catalog.setval('public.x_seq', 1, true);",
    ])
      expect(classifyDumpStatement(sql), sql).toBeNull();
  });

  it('deixa de fora, com aviso, os dados dos recursos da plataforma (pg_cron, pg_net, webhooks e filas)', () => {
    expect(PLATFORM_SCHEMAS).toEqual(['cron', 'net', 'supabase_functions', 'pgmq']);
    const platform = `INSERT INTO "cron"."job" ("jobid", "command") VALUES\n\t(1, 'select 1');
INSERT INTO "net"."_http_response" ("id") VALUES\n\t(1);
INSERT INTO "supabase_functions"."hooks" ("id") VALUES\n\t(1);
SELECT pg_catalog.setval('"cron"."jobid_seq"', 1, true);
`;
    const statements = parseDump(DATA_SQL.replace('RESET ALL;', `${platform}RESET ALL;`));
    expect(skippedTables(statements)).toEqual([
      'cron.job',
      'net._http_response',
      'supabase_functions.hooks',
      'cron (sequências)',
    ]);
    // Um comando de plataforma fora do formato continua recusado.
    expect(classifyDumpStatement('INSERT INTO "cron"."job" ("jobid") SELECT 1;')).toBeNull();
  });

  it('recusa um dump sem os dados da empresa (backup vazio)', () => {
    expect(() => parseDump('SET statement_timeout = 0;\nRESET ALL;\n')).toThrow(/não tem os dados da empresa/);
  });
});

describe('histórico das migrações', () => {
  it('lê as versões e os nomes pela lista de colunas, com SQL de verdade nas statements', () => {
    expect(parseHistoryVersions(HISTORY_SQL)).toEqual([
      { version: '20260906051319', name: 'commercial_foundation' },
      { version: '20261019110000', name: 'update_protection' },
    ]);
    const reordered = HISTORY_SQL.replace('("version", "statements", "name")', '("name", "statements", "version")')
      .replace("('20260906051319',", "('commercial_foundation',")
      .replace("'commercial_foundation'),", "'20260906051319'),")
      .replace("('20261019110000',", "('update_protection',")
      .replace("'update_protection');", "'20261019110000');");
    expect(parseHistoryVersions(reordered).map((migration) => migration.version)).toEqual([
      '20260906051319',
      '20261019110000',
    ]);
  });

  it('recusa um histórico vazio ou fora do formato do pg_dump', () => {
    expect(() => parseHistoryVersions('SET statement_timeout = 0;\n')).toThrow(/não tem nenhuma migração/);
    expect(() =>
      parseHistoryVersions(
        'INSERT INTO "supabase_migrations"."schema_migrations" ("version") VALUES ((select \'1\'));\n',
      ),
    ).toThrow(/linha 1: o histórico de migrações não está no formato do supabase db dump/);
  });

  it('compara as versões: iguais, faltando e sobrando, com os nomes', () => {
    const backup = parseHistoryVersions(HISTORY_SQL);
    expect(compareVersions(backup, backup)).toEqual({ missing: [], extra: [] });
    expect(versionProblems(backup, backup)).toBeNull();
    const project = [backup[0], { version: '20261101090000', name: 'custom_regra' }];
    expect(compareVersions(project, backup)).toEqual({
      missing: ['20261019110000_update_protection'],
      extra: ['20261101090000_custom_regra'],
    });
    const message = versionProblems(project, backup, 'abc1234');
    expect(message).toContain('Faltam no projeto: 20261019110000_update_protection.');
    expect(message).toContain('Sobram no projeto: 20261101090000_custom_regra.');
    expect(message).toContain('git switch --detach abc1234');
    expect(message).toContain('Nada foi gravado');
  });
});

describe('conexão e --confirm', () => {
  it('lê o ref do usuário do pooler e do servidor da conexão direta', () => {
    expect(projectRefFromUrl(POOLER)).toBe(REF);
    expect(projectRefFromUrl(DIRECT)).toBe(REF);
    expect(projectRefFromUrl('postgresql://postgres:x@127.0.0.1:5432/postgres')).toBeNull();
    expect(projectRefFromUrl('não é url')).toBeNull();
  });

  it('recusa sem conexão, fora do Supabase, sem --confirm e com outro projeto', () => {
    expect(connectionProblems(undefined, REF)).toMatch(/Defina a variável CRM_RESTORE_DB_URL/);
    expect(connectionProblems('mysql://x', REF)).toMatch(/precisa começar por postgresql:\/\//);
    expect(connectionProblems('postgresql://postgres:x@127.0.0.1/postgres', REF)).toMatch(
      /não é de um projeto Supabase/,
    );
    // Um # ou um ? sem código na senha: o servidor lido seria parte da senha.
    expect(connectionProblems(`postgresql://postgres:p@ss#w@db.${REF}.supabase.co:5432/postgres`, REF)).toMatch(
      /não é uma conexão válida/,
    );
    expect(
      connectionProblems(`postgresql://postgres.${REF}:12?x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`, REF),
    ).toMatch(/não é uma conexão válida/);
    expect(connectionProblems(POOLER, undefined)).toMatch(/Informe --confirm/);
    expect(connectionProblems(POOLER, 'tsrqponmlkjihgfedcba')).toMatch(
      /não é o projeto da conexão \(abcdefghijklmnopqrst\)/,
    );
    expect(connectionProblems(POOLER, REF)).toBeNull();
    expect(connectionProblems(DIRECT, REF)).toBeNull();
  });
});

describe('SQL de apoio', () => {
  it('a lista de tabelas preenchidas por migração é a mesma no arquivo SQL e no código (vazia hoje)', () => {
    const prepare = readFileSync(path.join(ROOT, PREPARE_FILE), 'utf8');
    const literal = /v_seeded text\[\] := array\[(.*?)\]::text\[\];/.exec(prepare)?.[1];
    expect(literal).toBeDefined();
    const fromSql = literal
      .split(',')
      .map((item) => item.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(fromSql).toEqual([...RESTORE_SEEDED_TABLES]);
  });
});

describe('npm run backup:restore (processo)', () => {
  const run = (args, env = {}) =>
    spawnSync(process.execPath, ['scripts/restore-backup.mjs', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, CRM_RESTORE_DB_URL: '', ...env },
      windowsHide: true,
    });

  it('sem --dir, mostra o uso e sai com 2', () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Uso: npm run backup:restore');
  });

  it('recusa sem conectar: sem a conexão, com o projeto errado e com a pasta incompleta', () => {
    const noUrl = run(['--dir', backupDir(), '--confirm', REF]);
    expect(noUrl.status).toBe(1);
    expect(noUrl.stderr).toContain('Defina a variável CRM_RESTORE_DB_URL');
    expect(noUrl.stderr).toContain('Nada foi gravado no projeto.');
    const wrong = run(['--dir', backupDir(), '--confirm', 'tsrqponmlkjihgfedcba'], { CRM_RESTORE_DB_URL: POOLER });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('não é o projeto da conexão');
    const incomplete = backupDir();
    rmSync(path.join(incomplete, BACKUP_FILES.data));
    const partial = run(['--dir', incomplete, '--confirm', REF], { CRM_RESTORE_DB_URL: POOLER });
    expect(partial.status).toBe(1);
    expect(partial.stderr).toContain('Esta pasta não é um backup completo do CRM (falta data.sql)');
  });

  it('recusa um dump com comando fora da lista antes de conectar', () => {
    const data = DATA_SQL.replace('RESET ALL;', 'DROP TABLE public.contacts;\nRESET ALL;');
    const result = run(['--dir', backupDir({ data }), '--confirm', REF], { CRM_RESTORE_DB_URL: POOLER });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('comando fora da lista permitida');
    expect(result.stdout).not.toContain('Conferindo as migrações');
  });

  it('o RestoreError é a classe das recusas', () => {
    expect(new RestoreError('x')).toBeInstanceOf(Error);
  });
});
