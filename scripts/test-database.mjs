#!/usr/bin/env node
// Aplica a cadeia completa de migrações e roda as verificações de RLS num PostgreSQL 17 descartável.
// Funciona em Windows, macOS e Linux sem PostgreSQL instalado: o cluster temporário (porta livre em
// 127.0.0.1, diretório apagado ao final, inclusive em falha ou Ctrl+C) vem de `scripts/lib/embedded-db.mjs`.
// Nunca aponte estes arquivos para um banco remoto.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SqlFileError, TEMP_PREFIXES, runWithEmbeddedDb } from './lib/embedded-db.mjs';

const TEST_FILE = 'supabase/tests/commercial-security.sql';
// Migração do reforço do item 1.1: o bloco que cria o gatilho da prova em auth.mfa_amr_claims é executado de novo, sem
// o privilégio TRIGGER, pela verificação proofTriggerWithoutPrivilege.
const PROOF_MIGRATION = 'supabase/migrations/20261012110000_admission_email_proof.sql';
// Dados de atualização: `supabase/tests/upgrade/<migração>.sql` roda logo antes da migração de mesmo nome,
// com o schema anterior a ela, para os testes conferirem o backfill como numa instância já em uso.
const UPGRADE_DIR = 'supabase/tests/upgrade';
// Contas da corrida entre dois primeiros cadastros (item 1.1), da confirmação atômica e da confirmação sem link
// (reforço do item 1.1).
const RACE_USERS = ['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2'];
const CONFIRMED_USER = '00000000-0000-0000-0000-0000000000a3';
const UNLINKED_USER = '00000000-0000-0000-0000-0000000000a4';
const LOCK_WAIT_TIMEOUT_MS = 10_000;

let passCount = 0;
let lastPass = null;
let countingChecks = false;

class RaceCheckError extends Error {}
class ConfirmationCheckError extends Error {}
class PrivilegeCheckError extends Error {}

function pass(message) {
  passCount += 1;
  lastPass = message;
  process.stdout.write(`  PASS: ${message}\n`);
}

// Cada `PASS: ...` emitido por test_support.assert/denied conta como uma verificação aprovada.
function countPass(notice) {
  const message = notice.message ?? '';
  if (message.startsWith('PASS: ')) pass(message.slice('PASS: '.length));
  else process.stdout.write(`  ${notice.severity ?? 'NOTICE'}: ${message}\n`);
}

async function waitsForAdvisoryLock(admin, pid) {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await admin.query('select wait_event_type, wait_event from pg_stat_activity where pid = $1', [
      pid,
    ]);
    if (rows[0]?.wait_event_type === 'Lock' && rows[0]?.wait_event === 'advisory') return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// O que o Auth grava ao emitir uma sessão, na transação do pedido (tokens/service.go, IssueRefreshToken e
// AddClaimToSession): a linha em auth.sessions e o método em auth.mfa_amr_claims.
async function openAuthSession(client, userId, method) {
  await client.query(
    `with s as (insert into auth.sessions(id,user_id) values (gen_random_uuid(),$1) returning id)
      insert into auth.mfa_amr_claims(session_id,authentication_method) select id,$2 from s`,
    [userId, method],
  );
}

async function readAccount(client, userId) {
  return (
    await client.query(
      `select email_confirmed_at is not null as confirmed, coalesce(encrypted_password,'') as password,
        exists(select 1 from private.email_proofs where user_id=$1) as proven from auth.users where id=$1`,
      [userId],
    )
  ).rows[0];
}

// Reforço do item 1.1 (docs/arquitetura/1.1.md, seção 16): a senha escolhida antes da prova do e-mail é descartada no
// mesmo UPDATE que confirma a conta, pelo gatilho BEFORE, e a prova é gravada quando a sessão do link nasce na mesma
// transação (verifyGet e verifyPost do Auth). Uma segunda sessão lê a conta antes e depois do commit da confirmação:
// nenhuma leitura pode mostrar a conta confirmada com a senha antiga, o instante em que quem a pré-cadastrou entraria
// nela. Roda com a instância vazia (qualquer cadastro passa pelo portão).
async function confirmationIsAtomic(db, admin) {
  console.log('Executando a confirmação por link vista de outra sessão (descarte da senha no mesmo UPDATE)');
  const confirming = await db.openSession();
  const reader = await db.openSession();
  const read = () => readAccount(reader.client, CONFIRMED_USER);
  try {
    await admin.client.query(
      `insert into auth.users(id,email,encrypted_password) values ($1,'pre-cadastro-atomico@example.test','$2a$10$senha.do.intruso')`,
      [CONFIRMED_USER],
    );
    await confirming.client.query('begin');
    await confirming.client.query('update auth.users set email_confirmed_at=now() where id=$1', [CONFIRMED_USER]);
    await openAuthSession(confirming.client, CONFIRMED_USER, 'otp');
    const before = await read();
    if (before.confirmed || before.password !== '$2a$10$senha.do.intruso' || before.proven)
      throw new ConfirmationCheckError(
        `antes do commit, outra sessão devia ver a conta não confirmada, com a senha antiga e sem prova (viu: ${JSON.stringify(before)}).`,
      );
    pass(
      'confirmation by link: before the commit, another session sees the account unconfirmed, with the old password',
    );
    await confirming.client.query('commit');
    const after = await read();
    if (!after.confirmed || after.password !== '' || !after.proven)
      throw new ConfirmationCheckError(
        `depois do commit, outra sessão devia ver a conta confirmada, sem senha e com a prova (viu: ${JSON.stringify(after)}).`,
      );
    pass(
      'confirmation by link: after the commit, another session sees the account confirmed, without password and proven',
    );
  } catch (error) {
    throw error instanceof ConfirmationCheckError
      ? error
      : new ConfirmationCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await reader.close();
    await confirming.close();
  }
}

// Revisão do reforço do item 1.1 (rodada 2): com a confirmação de e-mail desligada no Auth, /signup com o e-mail de uma
// conta que já existe sem confirmação a confirma numa transação sem INSERT e sem sessão e, noutra transação, entrega a
// quem pediu uma sessão por senha (api/signup.go 191-237 e 306-315). A marca da confirmação é local da transação: com
// os pedidos em transações separadas, na mesma conexão (como o Auth faz com o pool), nem essa sessão nem uma sessão de
// link aberta depois (o link de acesso que /otp envia) gravam a prova. Só transações de verdade conferem que a marca
// acaba no commit.
async function confirmationWithoutLinkProvesNothing(db, admin) {
  console.log('Executando a confirmação sem link em pedidos separados (a marca da confirmação acaba no commit)');
  const auth = await db.openSession();
  const request = async (run) => {
    await auth.client.query('begin');
    await run(auth.client);
    await auth.client.query('commit');
  };
  try {
    await admin.client.query(
      `insert into auth.users(id,email,encrypted_password) values ($1,'confirmada-sem-link@example.test','$2a$10$senha.do.intruso')`,
      [UNLINKED_USER],
    );
    await request((client) =>
      client.query('update auth.users set email_confirmed_at=now() where id=$1', [UNLINKED_USER]),
    );
    await request((client) => openAuthSession(client, UNLINKED_USER, 'password'));
    const afterSignup = await readAccount(admin.client, UNLINKED_USER);
    if (!afterSignup.confirmed || afterSignup.password !== '' || afterSignup.proven)
      throw new ConfirmationCheckError(
        `depois da confirmação sem link e da sessão por senha, a conta devia estar confirmada, sem senha e sem prova (viu: ${JSON.stringify(afterSignup)}).`,
      );
    pass('confirmation without a link: the password session of the next request records no proof');
    await request((client) => openAuthSession(client, UNLINKED_USER, 'otp'));
    const afterLink = await readAccount(admin.client, UNLINKED_USER);
    if (afterLink.proven)
      throw new ConfirmationCheckError(
        'uma sessão de link aberta num pedido posterior à confirmação gravou a prova: a marca da confirmação sobreviveu ao commit.',
      );
    pass('confirmation without a link: a link session in a later request records no proof either');
  } catch (error) {
    throw error instanceof ConfirmationCheckError
      ? error
      : new ConfirmationCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await auth.close();
  }
}

// Revisão do reforço do item 1.1 (13/10/2026): auth.mfa_amr_claims fica fora da lista de tabelas do Auth em que o
// Supabase documenta gatilhos, e o postgres só tem TRIGGER nela pelos privilégios padrão do schema auth. Sem esse
// privilégio, o CREATE TRIGGER falha com 42501; a migração o cria num bloco que, nesse caso, só avisa e segue (sem o
// gatilho, nenhuma prova é gravada e a admissão continua exigindo a sessão do link). Aqui, o mesmo bloco, lido da
// migração, roda num papel sem o privilégio, dentro de uma transação desfeita no fim.
async function proofTriggerWithoutPrivilege(db) {
  console.log('Executando o gatilho da prova num papel sem o privilégio TRIGGER em auth.mfa_amr_claims');
  const block = readFileSync(path.join(ROOT, PROOF_MIGRATION), 'utf8')
    .match(/^do \$\$[\s\S]*?^end \$\$;/gm)
    ?.find((statement) => statement.includes('on auth.mfa_amr_claims'));
  if (!block)
    throw new PrivilegeCheckError(`o bloco do gatilho record_email_proof não foi achado em ${PROOF_MIGRATION}.`);
  const warnings = [];
  const session = await db.openSession({
    onNotice: (notice) => {
      if (notice.severity === 'WARNING') warnings.push(notice.message ?? '');
    },
  });
  try {
    await session.client.query('begin');
    await session.client.query('create role crm_probe_without_trigger nologin');
    await session.client.query('grant usage on schema auth, private to crm_probe_without_trigger');
    await session.client.query('grant execute on function private.record_email_proof() to crm_probe_without_trigger');
    await session.client.query('drop trigger record_email_proof on auth.mfa_amr_claims');
    await session.client.query('set local role crm_probe_without_trigger');
    await session.client.query('savepoint bare');
    const bare = await session.client
      .query(
        'create trigger record_email_proof after insert on auth.mfa_amr_claims for each row execute function private.record_email_proof()',
      )
      .then(
        () => null,
        (error) => error,
      );
    if (bare?.code !== '42501')
      throw new PrivilegeCheckError(
        `sem o privilégio TRIGGER, o CREATE TRIGGER devia falhar com 42501 (resultado: ${bare ? `${bare.code} ${bare.message}` : 'gatilho criado'}).`,
      );
    await session.client.query('rollback to savepoint bare');
    pass('proof trigger without the TRIGGER privilege: a bare CREATE TRIGGER fails with 42501');
    await session.client.query(block);
    await session.client.query('reset role');
    const {
      rows: [{ created }],
    } = await session.client.query(
      `select exists(select 1 from pg_trigger where tgrelid='auth.mfa_amr_claims'::regclass and tgname='record_email_proof') as created`,
    );
    if (created || !warnings.some((message) => message.includes('record_email_proof')))
      throw new PrivilegeCheckError(
        `o bloco da migração devia seguir com um aviso e sem o gatilho (gatilho: ${created ? 'criado' : 'ausente'}; avisos: ${JSON.stringify(warnings)}).`,
      );
    pass('proof trigger without the TRIGGER privilege: the migration block goes on with a warning and no trigger');
  } catch (error) {
    throw error instanceof PrivilegeCheckError
      ? error
      : new PrivilegeCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await session.client.query('rollback').catch(() => undefined);
    await session.close();
  }
}

// Item 1.1 (decisão D6): dois primeiros cadastros simultâneos numa instância vazia criam uma única empresa. Precisa
// de duas transações abertas ao mesmo tempo, então roda aqui, depois do arquivo principal (que termina em rollback).
// Sem o lock consultivo de create_workspace, a segunda sessão não espera e a instância fica com duas empresas.
// As duas sessões são abertas pelo link enviado ao e-mail (amr otp): desde o reforço, create_workspace exige a prova.
async function raceFirstCompany(db, admin) {
  console.log('Executando a corrida entre dois primeiros cadastros (create_workspace em duas sessões)');
  const first = await db.openSession();
  const second = await db.openSession();
  try {
    await admin.client.query(
      `insert into auth.users(id,email,email_confirmed_at) values ($1,'corrida-a@example.test',now()),($2,'corrida-b@example.test',now())`,
      RACE_USERS,
    );
    const begin = async (session, userId) => {
      await session.client.query('begin');
      await session.client.query('set local role authenticated');
      await session.client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: 'authenticated', amr: [{ method: 'otp', timestamp: 0 }] }),
      ]);
    };
    await begin(first, RACE_USERS[0]);
    await first.client.query("select public.create_workspace('Empresa da corrida A')");
    await begin(second, RACE_USERS[1]);
    const {
      rows: [{ pid }],
    } = await second.client.query('select pg_backend_pid() as pid');
    const secondResult = second.client.query("select public.create_workspace('Empresa da corrida B')").then(
      () => null,
      (error) => error,
    );
    if (!(await waitsForAdvisoryLock(admin.client, pid)))
      throw new RaceCheckError('o segundo create_workspace não esperou o lock consultivo do primeiro.');
    pass('first-company race: the second create_workspace waits for the advisory lock of the first');
    await first.client.query('commit');
    const error = await secondResult;
    if (!error || !String(error.message).includes('Este CRM já tem uma empresa'))
      throw new RaceCheckError(
        `o segundo create_workspace devia ser recusado com "Este CRM já tem uma empresa" (resultado: ${error ? error.message : 'empresa criada'}).`,
      );
    pass('first-company race: after the first commit, the second create_workspace is refused');
    await second.client.query('rollback');
    const {
      rows: [{ count }],
    } = await admin.client.query('select count(*)::int as count from public.organizations');
    if (count !== 1) throw new RaceCheckError(`a corrida deixou ${count} empresas na instância.`);
    pass('first-company race: the instance ends with exactly one company');
  } catch (error) {
    throw error instanceof RaceCheckError
      ? error
      : new RaceCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await second.close();
    await first.close();
  }
}

// Verificações com mais de uma sessão, depois do arquivo principal (que termina em rollback). O cluster é descartável e
// estas são as últimas verificações: o esvaziamento da instância é gravado de vez, sem os avisos de cascata de cada
// tabela.
async function checksWithTwoSessions(db) {
  await proofTriggerWithoutPrivilege(db);
  const admin = await db.openSession();
  try {
    await admin.client.query('set client_min_messages=warning');
    await admin.client.query('truncate auth.users, public.organizations cascade');
    await confirmationIsAtomic(db, admin);
    await confirmationWithoutLinkProvesNothing(db, admin);
    await raceFirstCompany(db, admin);
  } finally {
    await admin.close();
  }
}

await runWithEmbeddedDb({
  tempPrefix: TEMP_PREFIXES.testDb,
  applicationName: 'crm-test-db',
  async run(db) {
    await db.applySchema({
      async beforeMigration(migration) {
        const seed = path.join(ROOT, UPGRADE_DIR, migration);
        if (!existsSync(seed)) return;
        console.log(`  ${UPGRADE_DIR}/${migration} (dados no formato anterior)`);
        await db.runInFreshSession(seed);
      },
    });
    console.log(`Executando ${TEST_FILE}`);
    countingChecks = true;
    await db.runInFreshSession(path.join(ROOT, TEST_FILE), { onNotice: countPass });
    if (passCount === 0) throw new SqlFileError('nenhuma verificação PASS foi emitida', TEST_FILE, 1, true);
    await checksWithTwoSessions(db);
    countingChecks = false;
  },
  sqlFailureDetails: () =>
    countingChecks
      ? [`  Verificações aprovadas antes da falha: ${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`]
      : [],
  describeError: (error) =>
    error instanceof RaceCheckError || error instanceof ConfirmationCheckError || error instanceof PrivilegeCheckError
      ? [
          `${
            error instanceof RaceCheckError
              ? 'Falha na corrida entre dois primeiros cadastros'
              : error instanceof PrivilegeCheckError
                ? 'Falha no gatilho da prova sem o privilégio TRIGGER'
                : 'Falha na confirmação do e-mail vista de outra sessão'
          }: ${error.message}`,
          `  Verificações aprovadas antes da falha: ${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`,
        ]
      : undefined,
  successMessage: () => `\n${passCount} verificações PostgreSQL passaram. Cluster temporário removido.`,
});
