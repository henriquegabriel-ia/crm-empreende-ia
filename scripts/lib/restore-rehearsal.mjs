// O ensaio de restauração de um backup do CRM (item 1.5; desenho em docs/arquitetura/1.5.md, seção 7), separado do
// processo para receber o programa que faz o dump: o pg_dump 17 de verdade, com as opções do CLI fixado, no
// `npm run test:restore` (scripts/test-restore.mjs), ou o pg_dump simulado de scripts/lib/pg-dump-simulator.mjs, no
// test:db (seção 21 do desenho). Roda só no cluster descartável de scripts/lib/embedded-db.mjs; nunca aponte para um
// banco remoto.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BACKUP_CLI_VERSION,
  BACKUP_EXCLUDED_TABLES,
  CLI_DATA_DUMP,
  CLI_HISTORY_DUMP,
  CLI_SCHEMA_EXCLUDED_SCHEMAS,
  CREDENTIAL_TABLES,
  excludeTableArgs,
  postProcessDump,
} from './backup-dump.mjs';
import {
  BACKUP_FILES,
  BACKUP_FORMAT,
  PREPARE_FILE,
  RestoreError,
  classifyDumpStatement,
  connectionProblems,
  driftSummary,
  readBackupDir,
  restoreBackup,
  sha256,
} from './backup-restore.mjs';
import { REMOVE_FILE, SEED_FILE } from './demo-seed.mjs';
import { beginAs, claimsOf, failureOf, provisionTeam } from './demo-instance.mjs';
import { ROOT, TEMP_PREFIXES, runSqlFile } from './embedded-db.mjs';

const ORIGIN = 'crm_origem';
const TARGET = 'crm_destino';
const REFUSALS = 'crm_recusas';
const USERS = Object.freeze({
  owner: { id: '00000000-0000-0000-0000-000000001501', email: 'dono-ensaio@example.test', role: 'owner' },
  admin: { id: '00000000-0000-0000-0000-000000001502', email: 'admin-ensaio@example.test', role: 'admin' },
  member: { id: '00000000-0000-0000-0000-000000001503', email: 'colaborador-ensaio@example.test', role: 'member' },
  gone: { id: '00000000-0000-0000-0000-000000001504', email: 'desativada-ensaio@example.test', role: 'member' },
});
// Um hash no formato do bcrypt do Auth (não é de senha nenhuma): o ensaio confere que ele volta igual.
const passwordOf = (index) => `$2a$10$ensaioDeRestauracao${String(index).padStart(2, '0')}abcdefghijklmnopqrstuvwxy`;

let passCount = 0;
let lastPass = null;
// Quem conta as verificações: o próprio ensaio (test:restore) ou o contador do test:db (setPassReporter).
let reporter = null;
export class RehearsalError extends Error {}
const pass = (message) => {
  passCount += 1;
  lastPass = message;
  if (reporter) reporter(message);
  else process.stdout.write(`  PASS: ${message}\n`);
};

/** Faz cada verificação aprovada passar por `report` (o `pass` do test:db), em vez de escrever aqui. */
export const setPassReporter = (report) => {
  reporter = report;
};
export const check = (ok, message, seen) => {
  if (!ok) throw new RehearsalError(`${message}${seen === undefined ? '' : ` (viu: ${JSON.stringify(seen)})`}`);
  pass(message);
};

/** Quantas verificações passaram e a última, para a mensagem de falha e o resumo. */
export const rehearsalProgress = () => ({ passCount, lastPass });

// ---------------------------------------------------------------------------------------------
/**
 * O programa de dump do ensaio: o pg_dump em `pgDumpPath`, com a conexão do banco de origem nas variáveis PG*. O ensaio
 * aceita também um `dump` assíncrono (o simulado do test:db).
 */
export const pgDumpRunner = (pgDumpPath) => (connection, dumpArgs) => {
  const result = spawnSync(pgDumpPath, dumpArgs, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 512 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: connection.host,
      PGPORT: String(connection.port),
      PGUSER: connection.user,
      PGPASSWORD: connection.password,
      PGDATABASE: connection.database,
    },
  });
  if (result.status !== 0) throw new RehearsalError(`o pg_dump falhou: ${result.stderr || result.error?.message}`);
  return result.stdout;
};

// Um commit no formato do GITHUB_SHA, para o backup-info.json do ensaio.
const ENSAIO_COMMIT = '1505000000000000000000000000000000000000';

// A pasta do backup, como sai do .7z do workflow: data.sql, history.sql e backup-info.json.
function writeBackup(dir, { data, history }) {
  writeFileSync(path.join(dir, BACKUP_FILES.data), data);
  writeFileSync(path.join(dir, BACKUP_FILES.history), history);
  const files = {};
  for (const file of [BACKUP_FILES.data, BACKUP_FILES.history]) {
    const content = readFileSync(path.join(dir, file));
    files[file] = { bytes: content.length, sha256: sha256(content) };
  }
  writeFileSync(
    path.join(dir, BACKUP_FILES.info),
    `${JSON.stringify({ format: BACKUP_FORMAT, createdAt: new Date().toISOString(), commit: ENSAIO_COMMIT, repository: 'local', cliVersion: BACKUP_CLI_VERSION, files }, null, 2)}\n`,
  );
}

async function populateOrigin(sql) {
  const team = [USERS.owner, USERS.admin, USERS.member, USERS.gone].map((person, index) => ({
    ...person,
    password: passwordOf(index),
    deactivated: person === USERS.gone,
  }));
  const org = await provisionTeam(sql, { team, company: 'Empresa do ensaio de restauração' });
  await sql.query(
    "insert into public.invitations(org_id,email,role,invited_by) values($1,'convite-ensaio@example.test','member',$2)",
    [org, USERS.owner.id],
  );
  // Uma sessão do Auth (fica de fora do backup) e a prova de e-mail do Dono (fica).
  await sql.query(
    `with s as (insert into auth.sessions(id,user_id) values (gen_random_uuid(),$1) returning id)
      insert into auth.mfa_amr_claims(session_id,authentication_method) select id,'password' from s`,
    [USERS.owner.id],
  );
  await sql.query('insert into private.email_proofs(user_id,email) values($1,$2)', [USERS.owner.id, USERS.owner.email]);
  await runSqlFile(sql, path.join(ROOT, SEED_FILE));
  return org;
}

// Contagem e md5 das linhas ordenadas de cada tabela de public, private e auth.
async function tableFingerprints(sql) {
  const { rows: tables } = await sql.query(
    `select n.nspname||'.'||c.relname as name, format('%I.%I',n.nspname,c.relname) as quoted from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind in ('r','p')
      order by 1`,
  );
  const result = new Map();
  for (const { name, quoted } of tables) {
    const { rows } = await sql.query(
      `select count(*)::int as n, md5(coalesce(string_agg(t::text,'|' order by t::text),'')) as hash from ${quoted} t`,
    );
    result.set(name, rows[0]);
  }
  return result;
}

const readAs = async (session, claims, query) => {
  await beginAs(session, claims);
  try {
    return (await session.client.query(query)).rows[0];
  } finally {
    await session.client.query('rollback');
  }
};

/**
 * O ensaio inteiro no cluster `db`, com `dump(connection, args)` devolvendo a saída do pg_dump (pgDumpRunner) ou uma
 * promessa dela (o simulado). Com `simulated`, pula a prova do caminho descartado, que depende do schema do pg_dump real.
 */
export async function rehearse(db, dump, { simulated = false } = {}) {
  const workDir = mkdtempSync(path.join(tmpdir(), `${TEMP_PREFIXES.restore}files-`));
  try {
    // 1. Origem.
    await db.createDatabase(ORIGIN);
    await db.applySchema({ database: ORIGIN, recordHistory: true, quiet: true });
    const origin = await db.openSession({ database: ORIGIN, onNotice: () => undefined });
    const org = await populateOrigin(origin.client);
    console.log('Origem preenchida: equipe, convite, sessão do Auth, prova de e-mail e seed de demonstração');

    // 2. O dump real.
    const connection = db.connectionFor(ORIGIN);
    const backupDir = path.join(workDir, 'backup');
    mkdirSync(backupDir);
    const dataRaw = await dump(connection, [...CLI_DATA_DUMP.args, ...excludeTableArgs()]);
    const historyRaw = await dump(connection, [...CLI_HISTORY_DUMP.args]);
    const files = { data: postProcessDump(dataRaw), history: postProcessDump(historyRaw) };
    writeBackup(backupDir, files);
    check(
      files.data.startsWith('SET session_replication_role = replica;') &&
        files.data.trimEnd().endsWith('RESET ALL;') &&
        !/^\\(un)?restrict/m.test(files.data) &&
        !files.data.includes('COPY '),
      `dump: ${simulated ? 'the simulated pg_dump' : 'pg_dump'} with the CLI options writes INSERT, with replica mode before, RESET ALL after and no live \\restrict line`,
    );
    for (const table of CREDENTIAL_TABLES) {
      const [schema, name] = table.split('.');
      check(
        !files.data.includes(`INSERT INTO "${schema}"."${name}"`),
        `dump: ${table} (live credentials) stays out of the backup`,
      );
    }

    // 3. Destino e restauração.
    await db.createDatabase(TARGET);
    await db.applySchema({ database: TARGET, recordHistory: true, quiet: true });
    const target = await db.openSession({ database: TARGET, onNotice: () => undefined });
    const backup = readBackupDir(backupDir);
    const restored = await restoreBackup({ client: target.client, backup, apply: true });
    check(
      restored.applied && restored.counts.some((entry) => entry.table === 'public.contacts' && entry.rows > 0),
      `restore: backup:restore loads ${restored.counts.reduce((sum, entry) => sum + entry.rows, 0)} rows in ${restored.counts.length} tables with --apply, in ${restored.elapsedMs} ms`,
    );

    // 4. Conferências.
    const before = await tableFingerprints(origin.client);
    const after = await tableFingerprints(target.client);
    const differing = [];
    for (const [name, value] of before) {
      if (CREDENTIAL_TABLES.includes(name) || !after.has(name)) continue;
      const restoredValue = after.get(name);
      if (restoredValue.n !== value.n || restoredValue.hash !== value.hash)
        differing.push({ name, value, restoredValue });
    }
    check(
      !differing.length,
      `content: the ${[...before.keys()].filter((name) => !CREDENTIAL_TABLES.includes(name)).length} tables of public, private and auth have the same count and md5 of their rows in origin and target`,
      differing.slice(0, 5),
    );
    const credentials = CREDENTIAL_TABLES.filter((name) => after.has(name)).map((name) => [name, after.get(name).n]);
    check(
      credentials.every(([, n]) => n === 0) && (before.get('auth.sessions')?.n ?? 0) > 0,
      'content: sessions and amr claims of the origin stay empty in the target',
      credentials,
    );
    const accounts = await target.client.query(
      `select u.id, u.encrypted_password, r.deactivated_at is not null as deactivated from auth.users u
        left join public.user_roles r on r.user_id=u.id order by u.id`,
    );
    check(
      accounts.rows.length === 4 &&
        accounts.rows.every((row, index) => row.encrypted_password === passwordOf(index)) &&
        accounts.rows.find((row) => row.id === USERS.gone.id)?.deactivated === true,
      'accounts: password hashes come back unchanged, and the deactivated person stays deactivated',
      accounts.rows,
    );
    const readQuery = `select (select count(*) from public.contacts)::int as contacts,(select count(*) from public.deals)::int as deals,
      (select count(*) from public.activities)::int as activities`;
    const memberClaims = claimsOf(USERS.member.id);
    const memberBefore = await readAs(origin, memberClaims, readQuery);
    const memberAfter = await readAs(target, memberClaims, readQuery);
    check(
      JSON.stringify(memberBefore) === JSON.stringify(memberAfter) && memberAfter.contacts > 0,
      'rls: a collaborator reads the same contacts, deals and activities in origin and target',
      { memberBefore, memberAfter },
    );
    const goneAfter = await readAs(target, claimsOf(USERS.gone.id), readQuery);
    check(
      goneAfter.contacts === 0 && goneAfter.deals === 0 && goneAfter.activities === 0,
      'rls: the deactivated person reads nothing in the target (item 1.2)',
      goneAfter,
    );
    await target.client.query('begin');
    await target.client.query('set local role anon');
    const anon = await failureOf(target.client.query('select count(*)::int as n from public.contacts'));
    const anonRows = anon ? 0 : null;
    await target.client.query('rollback');
    check(anonRows === 0, 'rls: the anon role reads no contact in the target', anon?.message);
    const privacy = (
      await target.client.query(
        `select has_table_privilege('authenticated','public.privacy_actions','INSERT')
          or has_table_privilege('authenticated','public.privacy_actions','UPDATE')
          or has_table_privilege('authenticated','public.privacy_actions','DELETE') as writable`,
      )
    ).rows[0];
    check(!privacy.writable, 'rls: privacy_actions stays without writes for the API (item 1.10)');

    // Gatilhos funcionando depois da carga (o modo replica valeu só durante ela).
    const { id: contactId } = (
      await target.client.query(
        'select id from public.contacts where org_id=$1 and anonymized_at is null and not do_not_contact order by created_at limit 1',
        [org],
      )
    ).rows[0];
    const audits = async () =>
      (
        await target.client.query(
          "select count(*)::int as n from public.audit_logs where entity_id=$1 and action='update'",
          [contactId],
        )
      ).rows[0].n;
    const auditsBefore = await audits();
    await beginAs(target, memberClaims);
    const stamp = (
      await target.client.query(
        "update public.contacts set job_title='Cargo depois da restauração' where id=$1 returning updated_at>now()-interval '1 minute' as fresh",
        [contactId],
      )
    ).rows[0];
    await target.client.query('commit');
    check(
      stamp?.fresh === true && (await audits()) === auditsBefore + 1,
      'triggers: a contact edited by a collaborator after the restore writes the audit and the updated_at',
      { stamp, auditsBefore },
    );
    const signup = await failureOf(
      target.client.query("insert into auth.users(id,email) values(gen_random_uuid(),'sem-convite@example.test')"),
    );
    check(
      String(signup?.message).includes('só por convite'),
      'triggers: a signup without an invitation is refused after the restore (enforce_invite_only_signup, item 1.1)',
      signup?.message ?? 'gravou',
    );
    const { id: blockedContact } = (
      await target.client.query(
        'select id from public.contacts where org_id=$1 and do_not_contact and anonymized_at is null limit 1',
        [org],
      )
    ).rows[0];
    await beginAs(target, memberClaims);
    const blocked = await failureOf(
      target.client.query(
        "insert into public.activities(org_id,type,title,contact_id,due_date,user_id) values($1,'call','Ligar',$2,now()+interval '1 day',$3)",
        [org, blockedContact, USERS.member.id],
      ),
    );
    await target.client.query('rollback');
    check(
      blocked !== null && /Não contatar/i.test(String(blocked?.message)),
      'triggers: a call scheduled for a "Não contatar" contact is refused after the restore (item 1.10)',
      blocked?.message ?? 'gravou',
    );
    const proofTriggers = (
      await target.client.query(
        `select count(*)::int as n from pg_trigger where not tgisinternal and tgenabled<>'D'
          and tgrelid in ('auth.users'::regclass,'auth.mfa_amr_claims'::regclass)`,
      )
    ).rows[0].n;
    const originProofTriggers = (
      await origin.client.query(
        `select count(*)::int as n from pg_trigger where not tgisinternal and tgenabled<>'D'
          and tgrelid in ('auth.users'::regclass,'auth.mfa_amr_claims'::regclass)`,
      )
    ).rows[0].n;
    check(
      proofTriggers === originProofTriggers && proofTriggers >= 4,
      `triggers: the ${proofTriggers} triggers of the CRM in auth.users and auth.mfa_amr_claims are enabled in the target`,
      { proofTriggers, originProofTriggers },
    );

    // Extensões, schemas e as funções de private.
    const structure = async (sql) =>
      (
        await sql.query(
          `select (select json_agg(json_build_array(extname,extnamespace::regnamespace::text) order by extname) from pg_extension) as extensions,
            (select json_agg(nspname order by nspname) from pg_namespace where nspname not like 'pg\\_%' and nspname<>'information_schema') as schemas,
            (select json_build_array(nspowner::regrole::text,nspacl::text) from pg_namespace where nspname='private') as private_schema,
            (select json_agg(json_build_array(p.oid::regprocedure::text,p.proconfig) order by p.oid::regprocedure::text)
              from pg_proc p where p.pronamespace='private'::regnamespace) as private_functions,
            (select count(*) from pg_proc p where p.pronamespace='private'::regnamespace
              and p.proconfig is distinct from array['search_path=""'])::int as without_empty_path`,
        )
      ).rows[0];
    const originStructure = await structure(origin.client);
    const targetStructure = await structure(target.client);
    check(
      JSON.stringify(originStructure) === JSON.stringify(targetStructure),
      'structure: the same extensions, schemas, owner and ACL of private, and functions of private in origin and target',
      { originStructure, targetStructure },
    );
    check(
      targetStructure.without_empty_path === originStructure.without_empty_path,
      `structure: the functions of private keep their search_path (${targetStructure.private_functions.length} functions)`,
    );

    // Drift zero.
    const fingerprints = async (sql) =>
      JSON.stringify((await sql.query('select * from private.base_fingerprints() order by 1,2')).rows);
    check(
      (await fingerprints(origin.client)) === (await fingerprints(target.client)),
      'drift: private.base_fingerprints() is the same in origin and target',
    );
    const drift = await driftSummary(target.client);
    check(
      drift.length === 1 &&
        drift[0].detalhe.includes('Histórico com todas as migrações da base.') &&
        drift[0].detalhe.includes('Alterados: 0. Ausentes: 0. Ganchos em uso: 0. Extras: 0.'),
      'drift: the drift check of the target returns only the summary, with zero changes and the full history',
      drift.map((row) => `${row.situacao}/${row.objeto}/${row.detalhe}`),
    );

    // A remoção da demonstração funciona no destino (os vínculos e os ids sobreviveram).
    const removal = await failureOf(runSqlFile(target.client, path.join(ROOT, REMOVE_FILE)));
    const left = (await target.client.query('select count(*)::int as n from public.deals where org_id=$1', [org]))
      .rows[0].n;
    check(removal === null && left === 0, 'functional: supabase/seed-demo-remove.sql deletes the demo in the target', {
      error: removal?.message,
      left,
    });

    // O caminho descartado: o schema do CLI deixa auth de fora, e com ele os gatilhos do CRM em auth. Só com o pg_dump
    // real: o simulado não faz o dump do schema.
    if (!simulated) {
      const schemaDump = await dump(connection, [
        '--schema-only',
        '--quote-all-identifier',
        '--role',
        'postgres',
        '--exclude-schema',
        CLI_SCHEMA_EXCLUDED_SCHEMAS,
      ]);
      check(
        /CREATE TABLE "public"\."contacts"/.test(schemaDump) &&
          !/CREATE (OR REPLACE )?TRIGGER [^\n]* ON "auth"\./.test(schemaDump) &&
          originProofTriggers >= 4,
        'discarded path: the schema dump of the CLI has no trigger on auth (the CRM triggers in auth.users and auth.mfa_amr_claims would be lost)',
      );
    }
    await origin.close();
    await target.close();

    // 5. Recusas.
    await refusals(db, { dump, connection, backupDir, workDir });
  } finally {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function refusals(db, { dump, connection, backupDir, workDir }) {
  console.log('Executando as recusas da restauração');
  await db.createDatabase(REFUSALS);
  await db.applySchema({ database: REFUSALS, recordHistory: true, quiet: true });
  const session = await db.openSession({ database: REFUSALS, onNotice: () => undefined });
  const sql = session.client;
  const stillEmpty = async () => {
    await sql.query('begin');
    try {
      return (await failureOf(runSqlFile(sql, path.join(ROOT, PREPARE_FILE)))) === null;
    } finally {
      await sql.query('rollback');
    }
  };
  const restoreFrom = (dir, apply = true) =>
    failureOf(restoreBackup({ client: sql, backup: readBackupDir(dir), apply }));
  // Uma cópia da pasta do backup com o data.sql trocado (e o sha256 refeito, para chegar à leitura do SQL).
  let copies = 0;
  const variant = (transform, { refreshHash = true } = {}) => {
    copies += 1;
    const dir = path.join(workDir, `variante-${copies}`);
    cpSync(backupDir, dir, { recursive: true });
    const dataFile = path.join(dir, BACKUP_FILES.data);
    writeFileSync(dataFile, transform(readFileSync(dataFile, 'utf8')));
    if (refreshHash) {
      const infoFile = path.join(dir, BACKUP_FILES.info);
      const info = JSON.parse(readFileSync(infoFile, 'utf8'));
      const content = readFileSync(dataFile);
      info.files[BACKUP_FILES.data] = { bytes: content.length, sha256: sha256(content) };
      writeFileSync(infoFile, JSON.stringify(info));
    }
    return dir;
  };
  try {
    // Destino com uma linha em public.contacts e com uma conta.
    await sql.query(
      "insert into public.organizations(id,name) values('00000000-0000-0000-0000-00000000c0de','Já existia')",
    );
    await sql.query(
      "insert into public.contacts(org_id,first_name) values('00000000-0000-0000-0000-00000000c0de','Contato que já existia')",
    );
    const withContact = await restoreFrom(backupDir);
    check(
      String(withContact?.message).includes('Este projeto não está vazio') &&
        String(withContact?.message).includes('public.contacts'),
      'refusal: a target with a row in public.contacts is refused, naming the table',
      withContact?.message ?? 'restaurou',
    );
    await sql.query('set client_min_messages=warning');
    await sql.query('truncate public.organizations cascade');
    await sql.query("insert into auth.users(id,email) values(gen_random_uuid(),'conta-antes@example.test')");
    const withAccount = await restoreFrom(backupDir);
    check(
      String(withAccount?.message).includes('auth.users'),
      'refusal: a target with an account is refused (restore before the first access)',
      withAccount?.message ?? 'restaurou',
    );
    await sql.query('truncate auth.users cascade');
    check(await stillEmpty(), 'refusal: the refusal target is empty again after the setup rows are removed');

    // Destino sem a última migração no histórico.
    const { rows: lastRows } = await sql.query(
      'delete from supabase_migrations.schema_migrations where version=(select max(version) from supabase_migrations.schema_migrations) returning version,name,statements',
    );
    const [last] = lastRows;
    const behind = await restoreFrom(backupDir);
    check(
      String(behind?.message).includes('Faltam no projeto') &&
        String(behind?.message).includes(`${last.version}_${last.name}`),
      'refusal: a target without the last migration in its history is refused, citing the migration by name',
      behind?.message ?? 'restaurou',
    );
    await sql.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [
      last.version,
      last.name,
      last.statements,
    ]);

    // --confirm errado.
    const wrongConfirm = connectionProblems(
      'postgresql://postgres.abcdefghijklmnopqrst:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
      'tsrqponmlkjihgfedcba',
    );
    check(
      String(wrongConfirm).includes('não é o projeto da conexão'),
      'refusal: a --confirm different from the project of the connection is refused before connecting',
      wrongConfirm,
    );

    // sha256 alterado.
    const tampered = await failureOf(
      Promise.resolve().then(() => readBackupDir(variant((text) => `${text}-- alterado\n`, { refreshHash: false }))),
    );
    check(
      tampered instanceof RestoreError && tampered.message.includes('sha256'),
      'refusal: a data.sql whose sha256 differs from backup-info.json is refused',
      tampered?.message ?? 'aceitou',
    );

    // Comandos fora da lista e meta-comandos. Os INSERT adulterados usam uma linha de verdade do dump.
    const orgInsert = readFileSync(path.join(backupDir, BACKUP_FILES.data), 'utf8')
      .split('\n')
      .find((line) => line.startsWith('INSERT INTO "public"."organizations" ('))
      ?.replace(/ VALUES$/, '');
    check(Boolean(orgInsert), 'refusal: the dump has the INSERT of public.organizations used by the tampered commands');
    const before = (text, statement) => text.replace('RESET ALL;', `${statement}\nRESET ALL;`);
    for (const [transform, fragment, message] of [
      [
        (text) => before(text, 'DROP TABLE public.contacts;'),
        'fora da lista permitida',
        'a DROP TABLE added to data.sql',
      ],
      [
        (text) =>
          before(
            text,
            `${orgInsert} VALUES ((SELECT pg_catalog.set_config('session_replication_role', 'origin', false)), 'x');`,
          ),
        'fora da lista permitida',
        'an INSERT with a subquery in VALUES',
      ],
      [
        (text) =>
          before(
            text,
            `INSERT INTO "auth"."users" ("id", "email") VALUES ('${USERS.owner.id}', 'x@example.test') ON CONFLICT ("id") DO UPDATE SET "encrypted_password" = 'trocada';`,
          ),
        'fora da lista permitida',
        'an INSERT with ON CONFLICT DO UPDATE',
      ],
      [
        (text) => before(text, 'INSERT INTO "public"."organizations" ("id") SELECT "id" FROM "auth"."users";'),
        'fora da lista permitida',
        'an INSERT ... SELECT',
      ],
      [
        (text) => before(text, "SELECT pg_catalog.set_config('role', 'authenticated', false);"),
        'fora da lista permitida',
        "a set_config('role')",
      ],
      [(text) => `\\ir outro.sql\n${text}`, 'meta-comando do psql', 'a \\ir line'],
      [(text) => `\\restrict chave\n${text}`, 'pg_dump direto', 'an uncommented \\restrict line'],
    ]) {
      const failure = await restoreFrom(variant(transform));
      check(
        failure instanceof RestoreError && failure.message.includes(fragment) && (await stillEmpty()),
        `refusal: ${message} is refused and the target stays empty`,
        failure?.message ?? 'restaurou',
      );
    }

    // SET que muda a leitura das aspas no servidor (revisão do item 1.5, rodada 2): com standard_conforming_strings off, o
    // servidor leria \' como aspa escapada, fecharia a tupla antes e rodaria o COMMIT e o CREATE ROLE de dentro do literal.
    const injectedRole = 'crm_ensaio_injetado';
    const injection = await restoreFrom(
      variant((text) =>
        before(
          text,
          `SET standard_conforming_strings = off;\n${orgInsert} VALUES ('x\\',' , 'y'); COMMIT; CREATE ROLE ${injectedRole} LOGIN; --', 'z');`,
        ),
      ),
      false,
    );
    const { rows: injectedRoles } = await sql.query('select 1 from pg_roles where rolname = $1', [injectedRole]);
    check(
      injection instanceof RestoreError &&
        injection.message.includes('SET standard_conforming_strings = off') &&
        !injectedRoles.length &&
        (await stillEmpty()),
      'refusal: a SET standard_conforming_strings = off followed by an INSERT that hides a COMMIT and a CREATE ROLE is refused, with no role created and the target empty',
      injection?.message ?? 'restaurou',
    );
    const otherEncoding = await restoreFrom(
      variant((text) => text.replace("SET client_encoding = 'UTF8';", "SET client_encoding = 'SJIS';")),
      false,
    );
    check(
      otherEncoding instanceof RestoreError &&
        otherEncoding.message.includes('fora da lista permitida') &&
        (await stillEmpty()),
      "refusal: a SET client_encoding other than 'UTF8' is refused and the target stays empty",
      otherEncoding?.message ?? 'restaurou',
    );

    // Um dump sem public.companies: a conferência das chaves estrangeiras recusa.
    const partialDir = path.join(workDir, 'parcial');
    cpSync(backupDir, partialDir, { recursive: true });
    writeBackup(partialDir, {
      data: postProcessDump(
        await dump(connection, [
          ...CLI_DATA_DUMP.args,
          ...excludeTableArgs([...BACKUP_EXCLUDED_TABLES, 'public.companies']),
        ]),
      ),
      history: readFileSync(path.join(backupDir, BACKUP_FILES.history), 'utf8'),
    });
    const partial = await restoreFrom(partialDir);
    check(
      String(partial?.message).includes('sem o registro de public.companies') && (await stillEmpty()),
      'refusal: a dump without public.companies fails the foreign key check, and the target stays empty',
      partial?.message ?? 'restaurou',
    );

    // Dados de um recurso da plataforma (pg_cron) ficam de fora, com aviso, e o resto restaura.
    const cronInsert = `INSERT INTO "cron"."job" ("jobid", "schedule", "command") VALUES\n\t(1, '* * * * *', 'select 1');`;
    const cronSetval = `SELECT pg_catalog.setval('"cron"."jobid_seq"', 1, true);`;
    const cronDir = variant((text) => before(text, `${cronInsert}\n${cronSetval}`));
    const withCron = await restoreBackup({ client: sql, backup: readBackupDir(cronDir), apply: false });
    check(
      classifyDumpStatement(cronInsert)?.kind === 'skip' &&
        classifyDumpStatement(cronSetval)?.kind === 'skip' &&
        JSON.stringify(withCron.skipped) === JSON.stringify(['cron.job', 'cron (sequências)']) &&
        (await stillEmpty()),
      'platform data: an INSERT in cron.job and its setval are left out with a warning, and the rest restores',
      withCron.skipped,
    );

    // Sem --apply: tudo gravado e conferido, e o destino vazio no fim.
    const dryRun = await failureOf(restoreBackup({ client: sql, backup: readBackupDir(backupDir), apply: false }));
    check(
      dryRun === null && (await stillEmpty()),
      'rehearsal: without --apply the restore loads and checks everything, then the target is empty again',
      dryRun?.message,
    );
  } finally {
    await session.close();
  }
}
