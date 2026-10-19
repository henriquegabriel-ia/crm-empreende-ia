#!/usr/bin/env node
// Aplica a cadeia completa de migrações e roda as verificações de RLS num PostgreSQL 17 descartável.
// Funciona em Windows, macOS e Linux sem PostgreSQL instalado: o cluster temporário (porta livre em
// 127.0.0.1, diretório apagado ao final, inclusive em falha ou Ctrl+C) vem de `scripts/lib/embedded-db.mjs`.
// Nunca aponte estes arquivos para um banco remoto.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEMO_SCHEMA,
  DEMO_TIME_ZONE,
  REMOVE_FILE,
  SEED_FILE,
  buildDemoSeedFiles,
  demoExpectedCounts,
} from './lib/demo-seed.mjs';
import {
  DRIFT_CHECK_FILE,
  GUIDE_FILE,
  MANIFEST_FILE,
  buildManifest,
  customizationGuideExamples,
  readBaseMigrationNames,
  refuseCustomMigrationsInBase,
  reservedPrefixProblems,
} from './lib/base-manifest.mjs';
import { CHECK_FILE, PREPARE_FILE, RESTORE_SEEDED_TABLES, RestoreError } from './lib/backup-restore.mjs';
import { beginAs, claimsOf, failureOf, provisionTeam } from './lib/demo-instance.mjs';
import {
  MIGRATIONS_DIR,
  ROOT,
  SqlFileError,
  TEMP_PREFIXES,
  runSqlFile,
  runWithEmbeddedDb,
} from './lib/embedded-db.mjs';
import { simulatedPgDump } from './lib/pg-dump-simulator.mjs';
import { RehearsalError, rehearse, setPassReporter } from './lib/restore-rehearsal.mjs';

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
// Contas da desativação vista de outra sessão (item 1.2): dono, membro desativado com o token antigo, colega que
// atribui trabalho, destinatária da carteira, pessoa com o volume do 0.10, as pessoas das corridas e das travas, os dois
// administradores que se desativam ao mesmo tempo e quem ficou desativado com contatos.
const DEACTIVATION_USERS = Object.freeze({
  owner: '00000000-0000-0000-0000-0000000000d1',
  member: '00000000-0000-0000-0000-0000000000d2',
  colleague: '00000000-0000-0000-0000-0000000000d3',
  recipient: '00000000-0000-0000-0000-0000000000d4',
  volume: '00000000-0000-0000-0000-0000000000d5',
  assignedAfterLock: '00000000-0000-0000-0000-0000000000d6',
  assignedBeforeLock: '00000000-0000-0000-0000-0000000000d7',
  heldDeal: '00000000-0000-0000-0000-0000000000d8',
  taskOnDeal: '00000000-0000-0000-0000-0000000000d9',
  referenced: '00000000-0000-0000-0000-0000000000da',
  adminA: '00000000-0000-0000-0000-0000000000db',
  adminB: '00000000-0000-0000-0000-0000000000dc',
  kept: '00000000-0000-0000-0000-0000000000dd',
});
// Volume do item 0.10 (scripts/lib/volume-data.mjs) numa pessoa só. A referência é o statement_timeout padrão de
// authenticated no Supabase (8 s), sem contar com os 60 s que as RPCs de transferência declaram; a verificação só
// reprova a partir de VOLUME_LIMIT_MS (seção (4) de deactivationSeenFromOtherSessions).
const DEACTIVATION_VOLUME = Object.freeze({ companies: 1_000, contacts: 5_000, deals: 2_000, activities: 15_000 });
const AUTHENTICATED_TIMEOUT_MS = 8_000;
const DECLARED_TIMEOUT_MS = 60_000;
const VOLUME_LIMIT_MS = 20_000;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
// Tempo-limite de uma gravação que só aponta para a carteira com a desativação aberta: ela não espera trava nenhuma.
const REFERENCE_TIMEOUT_MS = 3_000;
const PERMISSION_CHANGED = 'Sua permissão foi alterada. Atualize a página.';
// Contas da conclusão disputada (item 1.9): o dono e a colega que concluem a mesma ligação ao mesmo tempo.
const COMPLETION_USERS = Object.freeze({
  owner: '00000000-0000-0000-0000-0000000000f1',
  colleague: '00000000-0000-0000-0000-0000000000f2',
});
const ACTIVITY_CHANGED = 'Esta atividade mudou ou não está mais disponível';
// Contas da anonimização vista de outras sessões (item 1.10): quem anonimiza (a dona) e a colega que grava ao mesmo
// tempo. A pessoa do volume tem 200 atividades e o nome completo citado em 50 atividades de outros registros.
const PRIVACY_USERS = Object.freeze({
  owner: '00000000-0000-0000-0000-0000000000b8',
  colleague: '00000000-0000-0000-0000-0000000000b9',
});
const PRIVACY_VOLUME = Object.freeze({ completed: 150, pending: 50, citations: 50 });
const ANONYMIZED_REFUSAL = 'Este contato foi anonimizado e não recebe novos registros';
// Item 1.16: os casos de paridade da conta dos itens (os mesmos do Vitest) e as contas da gravação disputada.
const DEAL_ITEM_CASES = 'src/lib/deal-item-cases.json';
const ITEMS_USERS = Object.freeze({
  owner: '00000000-0000-0000-0000-000000000171',
  colleague: '00000000-0000-0000-0000-000000000172',
});
const DEAL_CHANGED = 'Esta oportunidade mudou ou não está mais disponível';
// Item 1.15: as contas do seed de demonstração (o Dono, uma colaboradora e uma administradora, cadastrados antes da
// empresa, como o portão do item 1.1 exige, e uma pessoa de fora, que ganha outra empresa só para a conferência da RLS).
const DEMO_USERS = Object.freeze({
  owner: '00000000-0000-0000-0000-000000000151',
  colleague: '00000000-0000-0000-0000-000000000152',
  admin: '00000000-0000-0000-0000-000000000153',
  outsider: '00000000-0000-0000-0000-000000000154',
});
// Tabelas com as linhas do seed, conferidas contra demoExpectedCounts (pipelines e etapas: além do funil padrão).
const DEMO_TABLES = [
  'products',
  'companies',
  'contacts',
  'deals',
  'deal_items',
  'activities',
  'payments',
  'automations',
  'automation_logs',
  'email_templates',
  'privacy_actions',
];

let passCount = 0;
let lastPass = null;
let countingChecks = false;

class RaceCheckError extends Error {}
class ConfirmationCheckError extends Error {}
class PrivilegeCheckError extends Error {}
class DeactivationCheckError extends Error {}
class CompletionCheckError extends Error {}
class AnonymizationCheckError extends Error {}
class DealItemCheckError extends Error {}
class DemoSeedCheckError extends Error {}
class DriftCheckError extends Error {}
class RestoreCheckError extends Error {}
class GuideCheckError extends Error {}

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

// A sessão `pid` espera uma trava (de linha, de transação ou, com `event`, uma específica, como a consultiva).
async function waitsForLock(admin, pid, event = null) {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await admin.query('select wait_event_type, wait_event from pg_stat_activity where pid = $1', [
      pid,
    ]);
    if (rows[0]?.wait_event_type === 'Lock' && (event === null || rows[0]?.wait_event === event)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
const waitsForAdvisoryLock = (admin, pid) => waitsForLock(admin, pid, 'advisory');

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

const pidOf = async (session) => (await session.client.query('select pg_backend_pid() as pid')).rows[0].pid;

// Item 1.2 (docs/arquitetura/1.2.md, seção 10.3): a desativação vista de outras sessões. (1) O token antigo: a conexão
// do membro, com as mesmas claims e sem transação aberta, lê os contatos; o dono desativa e faz commit; a mesma conexão,
// com as mesmas claims, não lê nem grava mais. (2) Atribuição depois da trava: com a desativação aberta, o colega que
// cria uma oportunidade em aberto para a pessoa espera a trava do papel e, depois do commit, é recusado. (3) Atribuição
// antes da trava: a desativação espera o commit do colega e leva a oportunidade dele na transferência. (5) O colega que
// segura uma oportunidade em aberto da pessoa e atribui a ela uma tarefa: a desativação espera a trava prévia da
// carteira e leva a tarefa. (6) A tarefa na oportunidade da pessoa, com o papel já travado pelo gatilho: sem impasse.
// (7) Uma gravação que só aponta para a carteira não espera a desativação aberta. (8) Dois administradores que se
// desativam ao mesmo tempo, e as outras RPCs de quem está sendo desativado: a trava da organização serializa, e quem
// age relê o próprio papel ativo. (4) Volume do 0.10 numa pessoa só, por último, com o tempo impresso.
async function deactivationSeenFromOtherSessions(db, admin) {
  console.log('Executando a desativação vista de outras sessões (token antigo, corridas, travas e volume)');
  const users = DEACTIVATION_USERS;
  const owner = await db.openSession();
  const member = await db.openSession();
  const colleague = await db.openSession();
  // As chamadas do administrador que está sendo desativado, cada uma na sua conexão e sem transação aberta.
  const adminB = [await db.openSession(), await db.openSession(), await db.openSession()];
  const deactivate = (session, userId, accounts = false) =>
    session.client.query(
      'select deals, activities, contacts, companies, invitations from public.deactivate_member($1, $2, $3)',
      [userId, accounts, users.recipient],
    );
  const settle = (promise) =>
    promise.then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
  try {
    await admin.client.query('truncate auth.users, public.organizations cascade');
    // Instância vazia: o portão de cadastro aceita as contas, e a empresa nasce pelo provisionamento interno.
    await admin.client.query(
      `insert into auth.users(id,email,email_confirmed_at)
        select id::uuid,'desativacao-'||right(id,2)||'@example.test',now() from unnest($1::text[]) id`,
      [Object.values(users)],
    );
    const {
      rows: [{ org }],
    } = await admin.client.query("select private.provision_organization($1,'Empresa da desativação') as org", [
      users.owner,
    ]);
    const members = Object.values(users).filter((id) => id !== users.owner);
    await admin.client.query('update public.profiles set org_id=$1 where id = any($2::uuid[])', [org, members]);
    await admin.client.query(
      "insert into public.user_roles(user_id,org_id,role) select unnest($2::uuid[]),$1,'member'",
      [org, members],
    );
    await admin.client.query("update public.user_roles set role='admin' where user_id = any($1::uuid[])", [
      [users.adminA, users.adminB],
    ]);
    const {
      rows: [{ pipeline, stage }],
    } = await admin.client.query(
      `select p.id as pipeline, s.id as stage from public.pipelines p join public.pipeline_stages s on s.pipeline_id=p.id
        where p.org_id=$1 order by s."order" limit 1`,
      [org],
    );
    await admin.client.query(
      "insert into public.contacts(org_id,first_name,owner_id) select $1,'Contato '||n,$2 from generate_series(1,3) n",
      [org, users.member],
    );
    // Registros gravados pela sessão de administração para os cenários com duas transações, e o que ficou em aberto com
    // uma pessoa (oportunidades em aberto e atividades pendentes).
    const dealOf = async (userId, title) =>
      (
        await admin.client.query(
          "insert into public.deals(org_id,pipeline_id,stage_id,title,owner_id,status) values($1,$2,$3,$4,$5,'open') returning id",
          [org, pipeline, stage, title, userId],
        )
      ).rows[0].id;
    const contactOf = async (userId, name) =>
      (
        await admin.client.query(
          'insert into public.contacts(org_id,first_name,owner_id) values($1,$2,$3) returning id',
          [org, name, userId],
        )
      ).rows[0].id;
    const leftWith = async (userId) =>
      (
        await admin.client.query(
          `select (select count(*)::int from public.deals where owner_id=$1 and status='open')
            + (select count(*)::int from public.activities where user_id=$1 and completed_at is null and type<>'note') as left`,
          [userId],
        )
      ).rows[0].left;
    const taskFor = (session, userId, title, dealId = null) =>
      session.client.query(
        "insert into public.activities(org_id,type,title,user_id,deal_id,due_date) values($1,'task',$2,$3,$4,now()+interval '1 day')",
        [org, title, userId, dealId],
      );

    // (1) O token antigo.
    const memberClaims = claimsOf(users.member);
    await member.client.query('set role authenticated');
    await member.client.query("select set_config('request.jwt.claims', $1, false)", [memberClaims]);
    const readContacts = async () =>
      (await member.client.query('select count(*)::int as count from public.contacts')).rows[0].count;
    if ((await readContacts()) !== 3)
      throw new DeactivationCheckError('antes da desativação, o membro devia ler os 3 contatos da empresa.');
    pass('old token: before the deactivation, the member connection reads the contacts of the company');
    await beginAs(owner, claimsOf(users.owner));
    await deactivate(owner, users.member, true);
    await owner.client.query('commit');
    const after = await readContacts();
    if (after !== 0)
      throw new DeactivationCheckError(
        `depois do commit da desativação, a mesma conexão do membro, com as mesmas claims, leu ${after} contatos.`,
      );
    pass('old token: after the commit, the same connection with the same claims reads no contact');
    const writeError = await failureOf(
      member.client.query("insert into public.contacts(org_id,first_name) values($1,'Depois da desativação')", [org]),
    );
    if (writeError?.code !== '42501')
      throw new DeactivationCheckError(
        `a gravação com o token antigo devia ser recusada pela RLS (resultado: ${writeError ? `${writeError.code} ${writeError.message}` : 'gravada'}).`,
      );
    pass('old token: the same connection cannot write either');
    await member.client.query('reset role');

    const openDealFor = (userId, title) =>
      colleague.client.query(
        "insert into public.deals(org_id,pipeline_id,stage_id,title,owner_id,status) values($1,$2,$3,$4,$5,'open')",
        [org, pipeline, stage, title, userId],
      );
    const colleagueClaims = claimsOf(users.colleague);
    const ownerClaims = claimsOf(users.owner);

    // (2) Atribuição depois da trava do papel.
    await beginAs(owner, ownerClaims);
    await deactivate(owner, users.assignedAfterLock);
    await beginAs(colleague, colleagueClaims);
    const colleaguePid = await pidOf(colleague);
    const assignment = failureOf(openDealFor(users.assignedAfterLock, 'Atribuída durante a desativação'));
    if (!(await waitsForLock(admin.client, colleaguePid)))
      throw new DeactivationCheckError('a atribuição feita durante a desativação não esperou a trava do papel.');
    pass('assignment after the lock: the colleague waits for the role lock of the deactivation');
    await owner.client.query('commit');
    const refused = await assignment;
    if (!String(refused?.message).includes('O responsável escolhido foi desativado'))
      throw new DeactivationCheckError(
        `depois do commit da desativação, a atribuição devia ser recusada (resultado: ${refused ? refused.message : 'gravada'}).`,
      );
    await colleague.client.query('rollback');
    pass('assignment after the lock: once the deactivation commits, the assignment is refused');
    const leftAfter = await leftWith(users.assignedAfterLock);
    if (leftAfter !== 0)
      throw new DeactivationCheckError(`${leftAfter} registros em aberto ficaram com a pessoa desativada.`);
    pass('assignment after the lock: no open deal is left with the deactivated person');

    // (3) Atribuição antes da trava do papel.
    await beginAs(colleague, colleagueClaims);
    await openDealFor(users.assignedBeforeLock, 'Atribuída antes da desativação');
    await beginAs(owner, ownerClaims);
    const ownerPid = await pidOf(owner);
    const deactivation = settle(deactivate(owner, users.assignedBeforeLock));
    if (!(await waitsForLock(admin.client, ownerPid)))
      throw new DeactivationCheckError('a desativação não esperou a atribuição que o colega ainda não confirmou.');
    pass('assignment before the lock: the deactivation waits for the colleague commit');
    await colleague.client.query('commit');
    const outcome = await deactivation;
    if (outcome.error) throw outcome.error;
    await owner.client.query('commit');
    const moved = outcome.result.rows[0];
    const {
      rows: [{ owner_id: newOwner }],
    } = await admin.client.query("select owner_id from public.deals where title='Atribuída antes da desativação'");
    if (moved.deals !== 1 || newOwner !== users.recipient)
      throw new DeactivationCheckError(
        `a desativação devia levar a oportunidade do colega para a destinatária (passou ${moved.deals}; responsável: ${newOwner}).`,
      );
    pass('assignment before the lock: the deactivation takes the colleague deal along to the recipient');

    // (5) O colega segura uma oportunidade em aberto da pessoa (altera a linha) e, na mesma transação, atribui a ela
    // uma tarefa, como a automação de uma mudança de etapa. A desativação trava as linhas da carteira antes do papel:
    // espera o colega, e a tarefa entra na transferência. Sem as travas prévias, ela travaria o papel primeiro, e as
    // duas transações fechariam um impasse.
    const heldDeal = await dealOf(users.heldDeal, 'Oportunidade segurada pelo colega');
    await beginAs(colleague, colleagueClaims);
    await colleague.client.query("update public.deals set title=title||' (editada)' where id=$1", [heldDeal]);
    await beginAs(owner, ownerClaims);
    const holding = settle(deactivate(owner, users.heldDeal));
    if (!(await waitsForLock(admin.client, ownerPid)))
      throw new DeactivationCheckError('a desativação não esperou o colega que segura uma oportunidade da pessoa.');
    pass('held deal: the deactivation waits for the colleague who holds an open deal of the person');
    const heldTask = await failureOf(taskFor(colleague, users.heldDeal, 'Tarefa da mudança de etapa', heldDeal));
    if (heldTask)
      throw new DeactivationCheckError(
        `a tarefa do colega para a pessoa, com a desativação esperando, devia ser gravada (resultado: ${heldTask.code} ${heldTask.message}).`,
      );
    await colleague.client.query('commit');
    const held = await holding;
    if (held.error) throw held.error;
    await owner.client.query('commit');
    const heldMoved = held.result.rows[0];
    if (heldMoved.deals !== 1 || heldMoved.activities !== 1 || (await leftWith(users.heldDeal)) !== 0)
      throw new DeactivationCheckError(
        `a desativação devia levar a oportunidade e a tarefa do colega (passou ${JSON.stringify(heldMoved)}).`,
      );
    pass('held deal: the task the colleague assigned enters the transfer, and nothing is left with the person');

    // (6) A tarefa na oportunidade da pessoa: o colega atribui uma tarefa a ela (o gatilho trava o papel em FOR KEY
    // SHARE), a desativação trava a carteira e espera o papel, e o colega cria outra tarefa para ela na oportunidade
    // dela. A verificação de FK dessa tarefa não pode esperar a trava prévia da oportunidade (FOR NO KEY UPDATE, e não
    // FOR UPDATE): seria um impasse.
    const taskDeal = await dealOf(users.taskOnDeal, 'Oportunidade de quem sai');
    await beginAs(colleague, colleagueClaims);
    await taskFor(colleague, users.taskOnDeal, 'Primeira tarefa para quem sai');
    await beginAs(owner, ownerClaims);
    const locked = settle(deactivate(owner, users.taskOnDeal, true));
    if (!(await waitsForLock(admin.client, ownerPid)))
      throw new DeactivationCheckError('a desativação não esperou a trava do papel que a tarefa do colega segura.');
    pass('task on the deal: the deactivation waits for the role held by the colleague assignment');
    const secondTask = await failureOf(taskFor(colleague, users.taskOnDeal, 'Tarefa na oportunidade dela', taskDeal));
    if (secondTask)
      throw new DeactivationCheckError(
        `a tarefa na oportunidade da pessoa devia ser gravada sem impasse (resultado: ${secondTask.code} ${secondTask.message}).`,
      );
    await colleague.client.query('commit');
    const lockedOutcome = await locked;
    if (lockedOutcome.error) throw lockedOutcome.error;
    await owner.client.query('commit');
    const taskMoved = lockedOutcome.result.rows[0];
    if (taskMoved.deals !== 1 || taskMoved.activities !== 2 || (await leftWith(users.taskOnDeal)) !== 0)
      throw new DeactivationCheckError(
        `a desativação devia levar a oportunidade e as duas tarefas (passou ${JSON.stringify(taskMoved)}).`,
      );
    pass('task on the deal: no deadlock, and the deal and both tasks enter the transfer');

    // (7) Com a desativação aberta (a carteira travada e já passada), um colega registra uma ligação dele mesmo na
    // oportunidade e no contato da pessoa: a verificação de FK não espera a passagem terminar.
    const referencedDeal = await dealOf(users.referenced, 'Oportunidade citada pelo colega');
    const referencedContact = await contactOf(users.referenced, 'Contato citado pelo colega');
    await beginAs(owner, ownerClaims);
    await deactivate(owner, users.referenced, true);
    await beginAs(colleague, colleagueClaims);
    await colleague.client.query(`set local statement_timeout='${REFERENCE_TIMEOUT_MS}ms'`);
    const reference = await failureOf(
      colleague.client.query(
        `insert into public.activities(org_id,type,title,user_id,deal_id,contact_id,due_date,completed_at)
          values($1,'call','Ligação do colega',$2,$3,$4,now(),now())`,
        [org, users.colleague, referencedDeal, referencedContact],
      ),
    );
    if (reference)
      throw new DeactivationCheckError(
        `a gravação que só aponta para a carteira esperou a desativação aberta (resultado: ${reference.code} ${reference.message}).`,
      );
    await colleague.client.query('commit');
    await owner.client.query('commit');
    pass('reference to the portfolio: a colleague links a call to a deal and a contact of the person without waiting');

    // (8) adminA desativa adminB e segura a transação; com o mesmo token, adminB tenta, cada chamada na sua conexão,
    // desativar adminA, passar a carteira de quem ficou desativado com um contato e reativar o membro de (1). As três
    // esperam a trava da organização e, depois do commit, releem o papel de quem age: recusadas.
    await contactOf(users.kept, 'Contato que ficou');
    await admin.client.query('update public.user_roles set deactivated_at=now() where user_id=$1', [users.kept]);
    await beginAs(owner, claimsOf(users.adminA));
    await deactivate(owner, users.adminB);
    const adminBClaims = claimsOf(users.adminB);
    const adminBPids = [];
    for (const session of adminB) {
      await session.client.query('set role authenticated');
      await session.client.query("select set_config('request.jwt.claims', $1, false)", [adminBClaims]);
      adminBPids.push(await pidOf(session));
    }
    const attempts = [
      ['deactivate_member', settle(deactivate(adminB[0], users.adminA))],
      [
        'transfer_portfolio',
        settle(
          adminB[1].client.query('select * from public.transfer_portfolio($1, true, $2)', [
            users.kept,
            users.recipient,
          ]),
        ),
      ],
      [
        'reactivate_member',
        settle(adminB[2].client.query("select public.reactivate_member($1, 'member')", [users.member])),
      ],
    ];
    for (const [index, pid] of adminBPids.entries())
      if (!(await waitsForLock(admin.client, pid)))
        throw new DeactivationCheckError(
          `${attempts[index][0]} de quem está sendo desativado não esperou a trava da organização.`,
        );
    pass('managers at the same time: the calls of the administrator being deactivated wait for the organization lock');
    await owner.client.query('commit');
    for (const [rpc, attempt] of attempts) {
      const { error } = await attempt;
      if (error?.message !== PERMISSION_CHANGED)
        throw new DeactivationCheckError(
          `${rpc} de quem foi desativado ao mesmo tempo devia ser recusada com "${PERMISSION_CHANGED}" (resultado: ${error ? error.message : 'aceita'}).`,
        );
    }
    pass(
      'managers at the same time: after the commit, deactivate_member, transfer_portfolio and reactivate_member reread the role and refuse',
    );
    const {
      rows: [race],
    } = await admin.client.query(
      `select (select deactivated_at is null from public.user_roles where user_id=$1) as a_active,
        (select deactivated_at is not null from public.user_roles where user_id=$2) as b_deactivated,
        (select count(*)::int from public.contacts where owner_id=$3) as kept_contacts,
        (select deactivated_at is not null from public.user_roles where user_id=$4) as member_deactivated`,
      [users.adminA, users.adminB, users.kept, users.member],
    );
    if (!race.a_active || !race.b_deactivated || race.kept_contacts !== 1 || !race.member_deactivated)
      throw new DeactivationCheckError(
        `a corrida entre os administradores devia deixar só a primeira desativação (viu: ${JSON.stringify(race)}).`,
      );
    pass('managers at the same time: only the first deactivation stays, and nothing else changes');

    // (4) Volume do 0.10 numa pessoa só. Os dados entram sem gatilhos, como nos arquivos de atualização; a passagem roda
    // com todos eles (auditoria, versão e a conferência do destinatário) e com o statement_timeout de 60 s que a RPC
    // declara. O tempo é impresso e comparado com os 8 s do padrão de authenticated, a referência do desenho; a
    // verificação só reprova a partir de 20 s (mais de 4 vezes o medido em 13/10/2026), porque o tempo acompanha a carga
    // da máquina, e uma máquina ocupada passava dos 8 s sem regressão nenhuma. A medição local não garante os 8 s no
    // Supabase hospedado (pendência de validação do roteiro).
    await admin.client.query('set session_replication_role=replica');
    await admin.client.query(
      "insert into public.companies(org_id,name,owner_id) select $1,'Empresa '||n,$2 from generate_series(1,$3::int) n",
      [org, users.volume, DEACTIVATION_VOLUME.companies],
    );
    await admin.client.query(
      "insert into public.contacts(org_id,first_name,owner_id) select $1,'Contato do volume '||n,$2 from generate_series(1,$3::int) n",
      [org, users.volume, DEACTIVATION_VOLUME.contacts],
    );
    await admin.client.query(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,owner_id,status)
        select $1,$2,$3,'Oportunidade '||n,$4,'open' from generate_series(1,$5::int) n`,
      [org, pipeline, stage, users.volume, DEACTIVATION_VOLUME.deals],
    );
    await admin.client.query(
      `insert into public.activities(org_id,type,title,user_id,due_date)
        select $1,'task','Tarefa '||n,$2,now()+make_interval(days=>n%30) from generate_series(1,$3::int) n`,
      [org, users.volume, DEACTIVATION_VOLUME.activities],
    );
    await admin.client.query('set session_replication_role=origin');
    await admin.client.query('analyze');
    await beginAs(owner, ownerClaims);
    await owner.client.query(`set local statement_timeout='${DECLARED_TIMEOUT_MS}ms'`);
    const started = performance.now();
    const volumeResult = await deactivate(owner, users.volume, true);
    const elapsed = Math.round(performance.now() - started);
    await owner.client.query('commit');
    const counts = volumeResult.rows[0];
    const expected = DEACTIVATION_VOLUME;
    if (
      counts.deals !== expected.deals ||
      counts.activities !== expected.activities ||
      counts.contacts !== expected.contacts ||
      counts.companies !== expected.companies
    )
      throw new DeactivationCheckError(
        `a passagem do volume devolveu contagens diferentes: ${JSON.stringify(counts)}.`,
      );
    if (elapsed >= VOLUME_LIMIT_MS)
      throw new DeactivationCheckError(
        `a passagem do volume levou ${elapsed} ms, a partir do limite de ${VOLUME_LIMIT_MS} ms (a referência é ${AUTHENTICATED_TIMEOUT_MS} ms).`,
      );
    if (elapsed >= AUTHENTICATED_TIMEOUT_MS)
      process.stdout.write(
        `  AVISO: a passagem do volume levou ${elapsed} ms, acima da referência de ${AUTHENTICATED_TIMEOUT_MS} ms (máquina ocupada ou regressão: compare com uma execução sem carga).\n`,
      );
    pass(
      `volume: ${expected.companies} companies, ${expected.contacts} contacts, ${expected.deals} deals and ${expected.activities} activities passed in ${elapsed} ms (reference ${AUTHENTICATED_TIMEOUT_MS} ms; fails from ${VOLUME_LIMIT_MS} ms)`,
    );
  } catch (error) {
    throw error instanceof DeactivationCheckError
      ? error
      : new DeactivationCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    // Fechar a conexão desfaz a transação que uma falha deixou aberta.
    for (const session of [owner, member, colleague, ...adminB]) await session.close();
  }
}

// Item 1.9 (docs/arquitetura/1.9.md, seção 11.3): duas pessoas concluem a mesma ligação com a mesma versão, cada uma com
// uma próxima ação de id diferente. A primeira fica com a transação aberta; a segunda espera a trava da linha (o FOR
// UPDATE de complete_activity), relê a ligação já concluída depois do commit (READ COMMITTED) e é recusada com "mudou
// ou não está mais disponível". Sobra uma conclusão e uma próxima ação. Sem o FOR UPDATE, a segunda esperaria só no
// UPDATE e concluiria de novo, com uma segunda próxima ação.
async function completeActivityRace(db, admin) {
  console.log('Executando a conclusão da mesma atividade por duas sessões (complete_activity)');
  const users = COMPLETION_USERS;
  const first = await db.openSession();
  const second = await db.openSession();
  try {
    await admin.client.query('truncate auth.users, public.organizations cascade');
    await admin.client.query(
      `insert into auth.users(id,email,email_confirmed_at) values
        ($1,'conclusao-dono@example.test',now()),($2,'conclusao-colega@example.test',now())`,
      [users.owner, users.colleague],
    );
    const {
      rows: [{ org }],
    } = await admin.client.query("select private.provision_organization($1,'Empresa da conclusão') as org", [
      users.owner,
    ]);
    await admin.client.query('update public.profiles set org_id=$1 where id=$2', [org, users.colleague]);
    await admin.client.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'member')", [
      users.colleague,
      org,
    ]);
    // A versão vai como texto, com os microssegundos, como a tela a manda.
    const {
      rows: [{ id, version }],
    } = await admin.client.query(
      `insert into public.activities(org_id,type,title,user_id,due_date) values($1,'call','Ligação disputada',$2,now()+interval '1 hour')
        returning id, updated_at::text as version`,
      [org, users.owner],
    );
    const complete = (session) =>
      session.client.query('select public.complete_activity($1,$2::timestamptz,$3,null,$4::jsonb) as result', [
        id,
        version,
        'answered',
        JSON.stringify({
          id: randomUUID(),
          title: 'Retornar a ligação',
          due_date: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ]);
    await beginAs(first, claimsOf(users.owner));
    await complete(first);
    await beginAs(second, claimsOf(users.colleague));
    const pid = await pidOf(second);
    const secondResult = failureOf(complete(second));
    if (!(await waitsForLock(admin.client, pid)))
      throw new CompletionCheckError('a segunda conclusão não esperou a trava da linha que a primeira segura.');
    pass('completion race: the second complete_activity waits for the row lock of the first');
    await first.client.query('commit');
    const error = await secondResult;
    if (!error || !String(error.message).includes(ACTIVITY_CHANGED))
      throw new CompletionCheckError(
        `a segunda conclusão devia ser recusada com "${ACTIVITY_CHANGED}" (resultado: ${error ? error.message : 'concluída de novo'}).`,
      );
    pass('completion race: after the first commit, the second is refused because the activity changed');
    await second.client.query('rollback');
    const {
      rows: [after],
    } = await admin.client.query(
      `select (select count(*)::int from public.activities where org_id=$1 and id<>$2) as next_actions,
        (select outcome from public.activities where id=$2 and completed_at is not null) as outcome`,
      [org, id],
    );
    if (after.next_actions !== 1 || after.outcome !== 'answered')
      throw new CompletionCheckError(
        `a disputa devia deixar a ligação concluída uma vez e uma próxima ação (viu: ${JSON.stringify(after)}).`,
      );
    pass('completion race: the call is completed once, with exactly one next action');
  } catch (error) {
    throw error instanceof CompletionCheckError
      ? error
      : new CompletionCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    // Fechar a conexão desfaz a transação que uma falha deixou aberta.
    await second.close();
    await first.close();
  }
}

// Item 1.10 (docs/arquitetura/1.10.md, seções 6 e 10.3): a anonimização vista de outras sessões. Ela trava primeiro o
// que aponta para o contato (oportunidades, atividades e recebimentos) e por último o contato, com FOR UPDATE, que
// conflita com o FOR KEY SHARE dos gatilhos e das FKs de quem liga um registro a ele. (1) A colega grava uma ligação
// concluída para a pessoa e segura a transação: a anonimização espera a trava do contato e, depois do commit, limpa a
// ligação. (2) A anonimização segura a transação: a atividade nova da colega para a pessoa espera e, depois do commit,
// é recusada. (3) A colega conclui uma atividade pendente da pessoa com a próxima ação para ela (complete_activity) e
// segura a transação: a anonimização espera a trava da atividade, as duas terminam sem impasse (40P01), e a próxima ação
// é excluída. Com o contato travado antes das atividades, as duas se esperariam. (4) A colega cria uma oportunidade para
// a pessoa e segura a transação: a anonimização não a vê ao tomar as travas, espera a trava do contato e, depois do
// commit, relê as oportunidades com o contato travado; a nova sai sem o vínculo, com o nome trocado no título, e entra
// nas contagens devolvidas. Sem a releitura, ela ficaria ligada ao contato anonimizado, com o nome no título.
async function anonymizationRace(db, admin) {
  console.log(
    'Executando a anonimização vista de outras sessões (ligação, vínculo novo, complete_activity e oportunidade nova)',
  );
  const users = PRIVACY_USERS;
  const owner = await db.openSession();
  const colleague = await db.openSession();
  try {
    await admin.client.query('truncate auth.users, public.organizations cascade');
    await admin.client.query(
      `insert into auth.users(id,email,email_confirmed_at) values
        ($1,'privacidade-dona@example.test',now()),($2,'privacidade-colega@example.test',now())`,
      [users.owner, users.colleague],
    );
    const {
      rows: [{ org }],
    } = await admin.client.query("select private.provision_organization($1,'Empresa da privacidade') as org", [
      users.owner,
    ]);
    await admin.client.query('update public.profiles set org_id=$1 where id=$2', [org, users.colleague]);
    await admin.client.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'member')", [
      users.colleague,
      org,
    ]);
    // A versão vai como texto, com os microssegundos, como a tela a manda.
    const personOf = async (name, email) =>
      (
        await admin.client.query(
          `insert into public.contacts(org_id,first_name,last_name,email,owner_id) values($1,$2,'Disputada',$3,$4)
            returning id, updated_at::text as version`,
          [org, name, email, users.colleague],
        )
      ).rows[0];
    const anonymize = (person) =>
      owner.client.query('select public.anonymize_contact($1,$2::timestamptz) as result', [person.id, person.version]);
    const ownerClaims = claimsOf(users.owner);
    const colleagueClaims = claimsOf(users.colleague);

    // (1) A gravação começa antes da trava do contato.
    const first = await personOf('Bruna', 'bruna.disputada@example.test');
    await beginAs(colleague, colleagueClaims);
    await colleague.client.query(
      `insert into public.activities(org_id,type,title,body,contact_id,user_id,due_date,completed_at,outcome)
        values($1,'call','Ligação com a Bruna Disputada','Bruna pediu o contrato.',$2,$3,now(),now(),'answered')`,
      [org, first.id, users.colleague],
    );
    await beginAs(owner, ownerClaims);
    const ownerPid = await pidOf(owner);
    const waiting = failureOf(anonymize(first));
    if (!(await waitsForLock(admin.client, ownerPid)))
      throw new AnonymizationCheckError('a anonimização não esperou a ligação que a colega ainda não confirmou.');
    pass('anonymization race: the anonymization waits for the call the colleague is writing for the person');
    await colleague.client.query('commit');
    const firstError = await waiting;
    if (firstError) throw firstError;
    await owner.client.query('commit');
    const {
      rows: [scrubbed],
    } = await admin.client.query('select title, body from public.activities where contact_id=$1', [first.id]);
    if (scrubbed?.title !== 'Ligação (contato anonimizado)' || scrubbed?.body !== null)
      throw new AnonymizationCheckError(
        `a ligação confirmada durante a anonimização devia ficar sem título e sem detalhes (viu: ${JSON.stringify(scrubbed)}).`,
      );
    pass('anonymization race: once the colleague commits, the anonymization scrubs the call');

    // (2) A gravação começa depois da trava do contato.
    const second = await personOf('Clara', 'clara.disputada@example.test');
    await beginAs(owner, ownerClaims);
    await anonymize(second);
    await beginAs(colleague, colleagueClaims);
    const colleaguePid = await pidOf(colleague);
    const linking = failureOf(
      colleague.client.query(
        "insert into public.activities(org_id,type,title,contact_id,user_id,due_date) values($1,'task','Tarefa da Clara',$2,$3,now()+interval '1 day')",
        [org, second.id, users.colleague],
      ),
    );
    if (!(await waitsForLock(admin.client, colleaguePid)))
      throw new AnonymizationCheckError('a atividade nova para a pessoa não esperou a anonimização aberta.');
    pass('anonymization race: a new activity for the person waits for the anonymization in progress');
    await owner.client.query('commit');
    const refused = await linking;
    if (!String(refused?.message).includes(ANONYMIZED_REFUSAL))
      throw new AnonymizationCheckError(
        `depois do commit da anonimização, a atividade nova devia ser recusada (resultado: ${refused ? refused.message : 'gravada'}).`,
      );
    await colleague.client.query('rollback');
    pass('anonymization race: once the anonymization commits, the new activity is refused');

    // (3) complete_activity com a próxima ação para a pessoa, durante a anonimização.
    const third = await personOf('Dora', 'dora.disputada@example.test');
    const {
      rows: [pending],
    } = await admin.client.query(
      `insert into public.activities(org_id,type,title,contact_id,user_id,due_date)
        values($1,'call','Ligar para a Dora',$2,$3,now()+interval '1 hour') returning id, updated_at::text as version`,
      [org, third.id, users.colleague],
    );
    const nextId = randomUUID();
    // A colega segura a atividade (a primeira trava de complete_activity) antes de a anonimização começar e só depois
    // conclui e cria a próxima ação, que pede a trava do contato. Com o contato travado primeiro pela anonimização, as
    // duas se esperariam, e o PostgreSQL desfaria uma delas (40P01).
    await beginAs(colleague, colleagueClaims);
    await colleague.client.query('select 1 from public.activities where id=$1 for update', [pending.id]);
    await beginAs(owner, ownerClaims);
    const completing = failureOf(anonymize(third));
    if (!(await waitsForLock(admin.client, ownerPid)))
      throw new AnonymizationCheckError('a anonimização não esperou a atividade da pessoa que a colega segura.');
    pass('anonymization race: the anonymization waits for the activity of the person the colleague is completing');
    const completion = await failureOf(
      colleague.client.query('select public.complete_activity($1,$2::timestamptz,$3,null,$4::jsonb)', [
        pending.id,
        pending.version,
        'answered',
        JSON.stringify({
          id: nextId,
          type: 'whatsapp',
          title: 'Mandar a proposta para a Dora',
          due_date: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ]),
    );
    if (completion)
      throw new AnonymizationCheckError(
        `a conclusão com a próxima ação para a pessoa devia passar sem esperar a anonimização (resultado: ${completion.code} ${completion.message}).`,
      );
    await colleague.client.query('commit');
    const deadlock = await completing;
    if (deadlock)
      throw new AnonymizationCheckError(
        `a anonimização devia terminar depois da conclusão, sem impasse (resultado: ${deadlock.code} ${deadlock.message}).`,
      );
    await owner.client.query('commit');
    const {
      rows: [after],
    } = await admin.client.query(
      `select (select count(*)::int from public.activities where id=$1) as next_actions,
        (select title from public.activities where id=$2 and completed_at is not null) as completed`,
      [nextId, pending.id],
    );
    if (after.next_actions !== 0 || after.completed !== 'Ligação (contato anonimizado)')
      throw new AnonymizationCheckError(
        `a conclusão devia ficar limpa e a próxima ação, excluída (viu: ${JSON.stringify(after)}).`,
      );
    pass('anonymization race: no deadlock; the completion is scrubbed and the next action for the person is deleted');

    // (4) Uma oportunidade ligada à pessoa enquanto a anonimização toma as travas.
    const fourth = await personOf('Elisa', 'elisa.disputada@example.test');
    const {
      rows: [stage],
    } = await admin.client.query(
      `select p.id as pipeline, s.id as stage from public.pipelines p join public.pipeline_stages s on s.pipeline_id=p.id
        where p.org_id=$1 order by s."order" limit 1`,
      [org],
    );
    await beginAs(colleague, colleagueClaims);
    const {
      rows: [late],
    } = await colleague.client.query(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,value,contact_id,owner_id)
        values($1,$2,$3,'Plano da Elisa',900,$4,$5) returning id`,
      [org, stage.pipeline, stage.stage, fourth.id, users.colleague],
    );
    await beginAs(owner, ownerClaims);
    const rereading = anonymize(fourth).then(
      ({ rows }) => rows[0].result,
      (error) => error,
    );
    if (!(await waitsForLock(admin.client, ownerPid)))
      throw new AnonymizationCheckError('a anonimização não esperou a oportunidade que a colega ainda não confirmou.');
    pass('anonymization race: the anonymization waits for the deal the colleague is creating for the person');
    await colleague.client.query('commit');
    const counts = await rereading;
    if (counts instanceof Error) throw counts;
    await owner.client.query('commit');
    const {
      rows: [deal],
    } = await admin.client.query('select title, contact_id from public.deals where id=$1', [late.id]);
    if (
      deal?.contact_id !== null ||
      deal?.title !== 'Plano da [anonimizado]' ||
      counts?.deals !== 1 ||
      counts?.open_deals !== 1
    )
      throw new AnonymizationCheckError(
        `a oportunidade criada durante as travas devia sair sem o vínculo, com o nome trocado e nas contagens (viu: ${JSON.stringify({ deal, counts })}).`,
      );
    pass(
      'anonymization race: once the colleague commits, the deal created for the person is reread, unlinked, scrubbed and counted',
    );
  } catch (error) {
    throw error instanceof AnonymizationCheckError
      ? error
      : new AnonymizationCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    // Fechar a conexão desfaz a transação que uma falha deixou aberta.
    await colleague.close();
    await owner.close();
  }
}

// Item 1.10 (seção 10.3 do desenho): o volume do 0.10 numa organização, com uma pessoa de 200 atividades (150
// concluídas e 50 pendentes) e o nome completo citado em 50 atividades de outros registros. A varredura de
// anonymize_contact percorre a organização inteira com as expressões dos termos. Os dados entram sem gatilhos, como nos
// arquivos de atualização; a anonimização roda com todos eles (auditoria, versão, guardas) e com o statement_timeout de
// 60 s que a RPC declara. O tempo é impresso e comparado com os 8 s do padrão de authenticated; só reprova a partir de
// 20 s, como a medição do 1.2, porque o tempo acompanha a carga da máquina. A medição local não garante o tempo no
// Supabase hospedado (pendência de validação do roteiro).
async function anonymizationVolume(db, admin) {
  console.log('Executando a anonimização com o volume do item 0.10');
  const users = PRIVACY_USERS;
  const owner = await db.openSession();
  try {
    await admin.client.query('truncate auth.users, public.organizations cascade');
    await admin.client.query(
      "insert into auth.users(id,email,email_confirmed_at) values ($1,'privacidade-volume@example.test',now())",
      [users.owner],
    );
    const {
      rows: [{ org }],
    } = await admin.client.query(
      "select private.provision_organization($1,'Empresa do volume da privacidade') as org",
      [users.owner],
    );
    const {
      rows: [{ pipeline, stage }],
    } = await admin.client.query(
      `select p.id as pipeline, s.id as stage from public.pipelines p join public.pipeline_stages s on s.pipeline_id=p.id
        where p.org_id=$1 order by s."order" limit 1`,
      [org],
    );
    await admin.client.query('set session_replication_role=replica');
    await admin.client.query(
      "insert into public.companies(org_id,name,owner_id) select $1,'Empresa '||n,$2 from generate_series(1,$3::int) n",
      [org, users.owner, DEACTIVATION_VOLUME.companies],
    );
    await admin.client.query(
      `insert into public.contacts(org_id,first_name,notes,owner_id)
        select $1,'Contato do volume '||n,'Observação '||n,$2 from generate_series(1,$3::int) n`,
      [org, users.owner, DEACTIVATION_VOLUME.contacts],
    );
    await admin.client.query(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,owner_id,status)
        select $1,$2,$3,'Oportunidade '||n,$4,'open' from generate_series(1,$5::int) n`,
      [org, pipeline, stage, users.owner, DEACTIVATION_VOLUME.deals],
    );
    await admin.client.query(
      `insert into public.activities(org_id,type,title,body,user_id,due_date)
        select $1,'task','Tarefa '||n,'Detalhes '||n,$2,now()+make_interval(days=>n%30) from generate_series(1,$3::int) n`,
      [org, users.owner, DEACTIVATION_VOLUME.activities],
    );
    const {
      rows: [person],
    } = await admin.client.query(
      `insert into public.contacts(org_id,first_name,last_name,email,phone,notes,owner_id)
        values($1,'Ana','Volume Souza','ana.volume@example.test','+5511933330000','Prefere e-mail.',$2)
        returning id, updated_at::text as version`,
      [org, users.owner],
    );
    await admin.client.query(
      `insert into public.activities(org_id,type,title,body,contact_id,user_id,due_date,completed_at)
        select $1,'call','Ligação com Ana Volume Souza '||n,'Conversa '||n,$2,$3,now()-make_interval(days=>n),now()-make_interval(days=>n)
        from generate_series(1,$4::int) n`,
      [org, person.id, users.owner, PRIVACY_VOLUME.completed],
    );
    await admin.client.query(
      `insert into public.activities(org_id,type,title,contact_id,user_id,due_date)
        select $1,'task','Retornar para a Ana '||n,$2,$3,now()+make_interval(days=>n) from generate_series(1,$4::int) n`,
      [org, person.id, users.owner, PRIVACY_VOLUME.pending],
    );
    await admin.client.query(
      `insert into public.activities(org_id,type,title,user_id,due_date)
        select $1,'task','Falar sobre Ana Volume Souza '||n,$2,now()+make_interval(days=>n) from generate_series(1,$3::int) n`,
      [org, users.owner, PRIVACY_VOLUME.citations],
    );
    await admin.client.query('set session_replication_role=origin');
    await admin.client.query('analyze');
    await beginAs(owner, claimsOf(users.owner));
    await owner.client.query(`set local statement_timeout='${DECLARED_TIMEOUT_MS}ms'`);
    const started = performance.now();
    const {
      rows: [{ result }],
    } = await owner.client.query('select public.anonymize_contact($1,$2::timestamptz) as result', [
      person.id,
      person.version,
    ]);
    const elapsed = Math.round(performance.now() - started);
    await owner.client.query('commit');
    if (
      result.activities_scrubbed !== PRIVACY_VOLUME.completed ||
      result.activities_deleted !== PRIVACY_VOLUME.pending ||
      result.other_records !== PRIVACY_VOLUME.citations
    )
      throw new AnonymizationCheckError(
        `a anonimização do volume devolveu contagens diferentes: ${JSON.stringify(result)}.`,
      );
    if (elapsed >= VOLUME_LIMIT_MS)
      throw new AnonymizationCheckError(
        `a anonimização do volume levou ${elapsed} ms, a partir do limite de ${VOLUME_LIMIT_MS} ms (a referência é ${AUTHENTICATED_TIMEOUT_MS} ms).`,
      );
    if (elapsed >= AUTHENTICATED_TIMEOUT_MS)
      process.stdout.write(
        `  AVISO: a anonimização do volume levou ${elapsed} ms, acima da referência de ${AUTHENTICATED_TIMEOUT_MS} ms (máquina ocupada ou regressão: compare com uma execução sem carga).\n`,
      );
    pass(
      `anonymization volume: a person with ${PRIVACY_VOLUME.completed + PRIVACY_VOLUME.pending} activities, cited in ${PRIVACY_VOLUME.citations} others, among ${DEACTIVATION_VOLUME.contacts} contacts and ${DEACTIVATION_VOLUME.activities} activities, anonymized in ${elapsed} ms (reference ${AUTHENTICATED_TIMEOUT_MS} ms; fails from ${VOLUME_LIMIT_MS} ms)`,
    );
  } catch (error) {
    throw error instanceof AnonymizationCheckError
      ? error
      : new AnonymizationCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    // Fechar a conexão desfaz a transação que uma falha deixou aberta.
    await owner.close();
  }
}

// Item 1.16 (docs/arquitetura/1.16.md, seções 5.3 e 13.2): a conta dos itens no banco e as gravações simultâneas da
// mesma oportunidade. (1) dealItemParity: cada caso de src/lib/deal-item-cases.json (o mesmo arquivo que o Vitest
// confere na tela) é gravado por save_deal numa transação desfeita, como a dona da organização; o total de cada linha
// (a coluna gerada), o total único, a mensalidade e o valor da oportunidade batem com o esperado em centavos; e cada
// recusa do arquivo é recusada pela RPC. (2) dealItemsRace: duas sessões salvam os itens da mesma versão da mesma
// oportunidade; a segunda espera a trava da linha da primeira e, depois do commit, é recusada pela versão, sem gravar.
// Na mesma função: a lista lida antes de uma anonimização que começou antes dela (now() anterior) é recusada; um move_deal
// que começou antes da gravação dos itens não deixa conflito falso; e a gravação que liga um contato em anonimização
// espera a trava dele antes de tocar nos itens.
const centsOf = (value) => {
  const [integer, fraction = ''] = String(value).split('.');
  return Number(integer) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
};
const itemPayload = (item) => ({
  id: randomUUID(),
  name: 'Item de paridade',
  quantity: item.quantity,
  unit_price: item.unitPrice,
  billing: item.billing,
  ...(item.discount ? { discount_type: item.discount.type, discount_value: item.discount.value } : {}),
});

// A instância esvaziada, a dona e a colega (as contas antes da empresa: depois dela, o portão do item 1.1 só aceita
// convidados) e a empresa com o funil padrão.
async function provisionItemsOrganization(admin, owner, name) {
  await admin.client.query('truncate auth.users, public.organizations cascade');
  await admin.client.query(
    `insert into auth.users(id,email,email_confirmed_at) values
      ($1,'itens-dono@example.test',now()),($2,'itens-colega@example.test',now())`,
    [owner, ITEMS_USERS.colleague],
  );
  const {
    rows: [{ org }],
  } = await admin.client.query('select private.provision_organization($1,$2) as org', [owner, name]);
  const {
    rows: [{ pipeline, stage }],
  } = await admin.client.query(
    `select p.id as pipeline,(select s.id from public.pipeline_stages s where s.pipeline_id=p.id order by s."order" limit 1) as stage
      from public.pipelines p where p.org_id=$1 limit 1`,
    [org],
  );
  return { org, pipeline, stage };
}

async function dealItemParity(db, admin) {
  console.log('Executando a paridade dos itens com a tela (src/lib/deal-item-cases.json)');
  const { cases, refusals } = JSON.parse(readFileSync(path.join(ROOT, DEAL_ITEM_CASES), 'utf8'));
  const session = await db.openSession();
  try {
    const { pipeline, stage } = await provisionItemsOrganization(admin, ITEMS_USERS.owner, 'Empresa da paridade');
    const fields = (title) =>
      JSON.stringify({
        title,
        pipeline_id: pipeline,
        stage_id: stage,
        status: 'open',
        currency: 'BRL',
        owner_id: ITEMS_USERS.owner,
      });
    for (const testCase of cases) {
      await beginAs(session, claimsOf(ITEMS_USERS.owner));
      try {
        const items = testCase.items.map(itemPayload);
        const dealId = randomUUID();
        await session.client.query('select public.save_deal($1,null,$2::jsonb,$3::jsonb,$4)', [
          dealId,
          fields(testCase.name),
          JSON.stringify(items),
          testCase.months,
        ]);
        const { rows: lines } = await session.client.query(
          'select id,line_total::text as total from public.deal_items where deal_id=$1 order by position',
          [dealId],
        );
        const {
          rows: [deal],
        } = await session.client.query(
          'select one_time_value::text as one_time,monthly_value::text as monthly,value::text as value from public.deals where id=$1',
          [dealId],
        );
        const seen = {
          lines: lines.map((line) => centsOf(line.total)),
          oneTime: centsOf(deal.one_time),
          monthly: centsOf(deal.monthly),
          contract: centsOf(deal.value),
        };
        const expected = {
          lines: testCase.items.map((item) => item.lineCents),
          oneTime: testCase.oneTimeCents,
          monthly: testCase.monthlyCents,
          contract: testCase.contractCents,
        };
        if (JSON.stringify(seen) !== JSON.stringify(expected))
          throw new DealItemCheckError(
            `o caso "${testCase.name}" deu ${JSON.stringify(seen)} no banco; o esperado é ${JSON.stringify(expected)}.`,
          );
        pass(`item parity: ${testCase.name} (${testCase.contractCents} centavos), as on the screen`);
      } finally {
        await session.client.query('rollback');
      }
    }
    for (const refusal of refusals) {
      await beginAs(session, claimsOf(ITEMS_USERS.owner));
      const error = await failureOf(
        session.client.query('select public.save_deal($1,null,$2::jsonb,$3::jsonb,null)', [
          randomUUID(),
          fields(refusal.name),
          JSON.stringify([itemPayload(refusal.item)]),
        ]),
      );
      await session.client.query('rollback');
      if (!error || error.code !== 'P0001' || !String(error.message).startsWith('Item 1 (Item de paridade): '))
        throw new DealItemCheckError(
          `o caso "${refusal.name}" devia ser recusado pela RPC com a posição e o nome do item (resultado: ${error ? error.message : 'gravado'}).`,
        );
      pass(`item parity: ${refusal.name} is refused by the database, as on the screen`);
    }
  } catch (error) {
    throw error instanceof DealItemCheckError
      ? error
      : new DealItemCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await session.close();
  }
}

async function dealItemsRace(db, admin) {
  console.log('Executando a gravação dos itens da mesma oportunidade por duas sessões (save_deal)');
  const first = await db.openSession();
  const second = await db.openSession();
  try {
    const { org, pipeline, stage } = await provisionItemsOrganization(
      admin,
      ITEMS_USERS.owner,
      'Empresa da corrida dos itens',
    );
    await admin.client.query('update public.profiles set org_id=$1 where id=$2', [org, ITEMS_USERS.colleague]);
    await admin.client.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'member')", [
      ITEMS_USERS.colleague,
      org,
    ]);
    // A versão vai como texto, com os microssegundos, como a tela a manda.
    const {
      rows: [{ id, version }],
    } = await admin.client.query(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,value,owner_id) values($1,$2,$3,'Itens disputados',100,$4)
        returning id, updated_at::text as version`,
      [org, pipeline, stage, ITEMS_USERS.owner],
    );
    const save = (session, name) =>
      session.client.query('select public.save_deal($1,$2::timestamptz,null,$3::jsonb,null) as result', [
        id,
        version,
        JSON.stringify([{ id: randomUUID(), name, quantity: '1.000', unit_price: '10.00', billing: 'one_time' }]),
      ]);
    await beginAs(first, claimsOf(ITEMS_USERS.owner));
    await save(first, 'Item da dona');
    await beginAs(second, claimsOf(ITEMS_USERS.colleague));
    const pid = await pidOf(second);
    const secondResult = failureOf(save(second, 'Item da colega'));
    if (!(await waitsForLock(admin.client, pid)))
      throw new DealItemCheckError('a segunda gravação não esperou a trava da oportunidade que a primeira segura.');
    pass('items race: the second save_deal waits for the row lock of the first');
    await first.client.query('commit');
    const error = await secondResult;
    if (!error || !String(error.message).includes(DEAL_CHANGED))
      throw new DealItemCheckError(
        `a segunda gravação devia ser recusada com "${DEAL_CHANGED}" (resultado: ${error ? error.message : 'gravada'}).`,
      );
    pass('items race: after the first commit, the second is refused because the deal changed');
    await second.client.query('rollback');
    const {
      rows: [after],
    } = await admin.client.query(
      `select (select string_agg(name,', ') from public.deal_items where deal_id=$1) as items,
        (select value::text from public.deals where id=$1) as value`,
      [id],
    );
    if (after.items !== 'Item da dona' || after.value !== '10.00')
      throw new DealItemCheckError(
        `a disputa devia deixar só o item da primeira gravação (viu: ${JSON.stringify(after)}).`,
      );
    pass('items race: only the items of the first save are kept, with its value');
    // A anonimização aberta ANTES de a colega gravar (o now() dela é anterior à versão gravada): ela renomeia o item das
    // demais oportunidades e renova a versão da oportunidade, e a lista velha, com o nome da pessoa, é recusada pela
    // versão em vez de gravar o dado pessoal de novo. A guarda não depende da ordem dos updated_at.
    const itemOf = (itemId, name, quantity = '1.000') => ({
      id: itemId,
      name,
      quantity,
      unit_price: '10.00',
      billing: 'one_time',
    });
    const saveItems = async (session, version, items) => {
      const {
        rows: [{ result }],
      } = await session.client.query('select public.save_deal($1,$2::timestamptz,null,$3::jsonb,null) as result', [
        id,
        version,
        JSON.stringify(items),
      ]);
      return result;
    };
    const currentVersion = async () =>
      (await admin.client.query('select updated_at::text as version from public.deals where id=$1', [id])).rows[0]
        .version;
    const {
      rows: [bruna],
    } = await admin.client.query(
      `insert into public.contacts(org_id,first_name,last_name,email) values($1,'Bruna','Antiga','bruna.itens@example.test')
        returning id, updated_at::text as version`,
      [org],
    );
    const personalItem = randomUUID();
    await beginAs(first, claimsOf(ITEMS_USERS.owner));
    await first.client.query('select now()');
    await beginAs(second, claimsOf(ITEMS_USERS.colleague));
    const saved = await saveItems(second, await currentVersion(), [itemOf(personalItem, 'Consultoria Bruna Antiga')]);
    await second.client.query('commit');
    await first.client.query('select public.anonymize_contact($1,$2::timestamptz)', [bruna.id, bruna.version]);
    await first.client.query('commit');
    await beginAs(second, claimsOf(ITEMS_USERS.colleague));
    const stale = await failureOf(
      saveItems(second, saved.deal.updated_at, [itemOf(personalItem, 'Consultoria Bruna Antiga', '2.000')]),
    );
    await second.client.query('rollback');
    if (!stale || !String(stale.message).includes(DEAL_CHANGED))
      throw new DealItemCheckError(
        `a lista lida antes da anonimização devia ser recusada com "${DEAL_CHANGED}" (resultado: ${stale ? stale.message : 'gravada'}).`,
      );
    const {
      rows: [kept],
    } = await admin.client.query('select name from public.deal_items where id=$1', [personalItem]);
    if (/Bruna|Antiga/i.test(kept.name))
      throw new DealItemCheckError(`a lista velha gravou de novo o nome anonimizado (viu: ${kept.name}).`);
    pass(
      'items race: a list read before an anonymization that started earlier is refused, and the name stays redacted',
    );
    // Uma mudança da oportunidade que começou antes da gravação dos itens e esperou a trava (move_deal) deixa a versão
    // com um now() anterior ao dos itens: a gravação com a versão atual continua aceita (sem conflito falso).
    const {
      rows: [{ nextStage }],
    } = await admin.client.query(
      `select s.id as "nextStage" from public.pipeline_stages s where s.pipeline_id=$1 and s.id<>$2 order by s."order" limit 1`,
      [pipeline, stage],
    );
    await beginAs(first, claimsOf(ITEMS_USERS.owner));
    await first.client.query('select now()');
    await beginAs(second, claimsOf(ITEMS_USERS.colleague));
    await saveItems(second, await currentVersion(), [itemOf(personalItem, 'Consultoria')]);
    await second.client.query('commit');
    await first.client.query('select public.move_deal($1,$2)', [id, nextStage]);
    await first.client.query('commit');
    await beginAs(second, claimsOf(ITEMS_USERS.colleague));
    const late = await failureOf(
      saveItems(second, await currentVersion(), [itemOf(personalItem, 'Consultoria', '3.000')]),
    );
    if (late) {
      await second.client.query('rollback');
      throw new DealItemCheckError(
        `a gravação com a versão atual, depois de um move_deal mais antigo, devia ser aceita (resultado: ${late.message}).`,
      );
    }
    await second.client.query('commit');
    const {
      rows: [moved],
    } = await admin.client.query('select quantity::text as quantity from public.deal_items where id=$1', [
      personalItem,
    ]);
    if (moved.quantity !== '3.000')
      throw new DealItemCheckError(`a gravação depois do move_deal não ficou (viu: ${moved.quantity}).`);
    pass('items race: after a move_deal that started earlier, a save with the current version is accepted');
    // O contato novo é travado (FOR KEY SHARE) antes dos itens: com a anonimização dele aberta, a gravação que liga a
    // oportunidade a ele espera a trava sem ter tocado nos itens (a ordem que evita o impasse com anonymize_contact).
    const {
      rows: [fresh],
    } = await admin.client.query(
      "update public.deals set title='Itens disputados com contato' where id=$1 returning updated_at::text as version",
      [id],
    );
    const {
      rows: [person],
    } = await admin.client.query(
      `insert into public.contacts(org_id,first_name,last_name,email) values($1,'Carla','Disputada','carla.itens@example.test')
        returning id, updated_at::text as version`,
      [org],
    );
    await beginAs(first, claimsOf(ITEMS_USERS.owner));
    await first.client.query('select public.anonymize_contact($1,$2::timestamptz)', [person.id, person.version]);
    await beginAs(second, claimsOf(ITEMS_USERS.colleague));
    const linkingPid = await pidOf(second);
    const linking = failureOf(
      second.client.query('select public.save_deal($1,$2::timestamptz,$3::jsonb,$4::jsonb,null)', [
        id,
        fresh.version,
        JSON.stringify({ contact_id: person.id }),
        JSON.stringify([
          { id: randomUUID(), name: 'Item com contato', quantity: '1.000', unit_price: '5.00', billing: 'one_time' },
        ]),
      ]),
    );
    if (!(await waitsForLock(admin.client, linkingPid)))
      throw new DealItemCheckError('a gravação que liga o contato em anonimização não esperou a trava dele.');
    const {
      rows: [itemLocks],
    } = await admin.client.query(
      `select count(*)::int as n from pg_locks where pid=$1 and relation='public.deal_items'::regclass and mode='RowExclusiveLock'`,
      [linkingPid],
    );
    await first.client.query('commit');
    await linking;
    await second.client.query('rollback');
    if (itemLocks.n !== 0)
      throw new DealItemCheckError('a gravação gravou os itens antes de travar o contato novo (FOR KEY SHARE).');
    pass('items race: linking a contact under anonymization waits for its lock before touching the items');
  } catch (error) {
    throw error instanceof DealItemCheckError
      ? error
      : new DealItemCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    // Fechar a conexão desfaz a transação que uma falha deixou aberta.
    await second.close();
    await first.close();
  }
}

// Item 1.15 (docs/arquitetura/1.15.md): o seed de demonstração. (1) Os arquivos versionados batem com o gerador, e cada
// tabela e cada coluna de public está classificada em DEMO_SCHEMA: uma tabela ou coluna nova reprova até alguém decidir
// se o seed a preenche (o teste de defasagem). (2) Cada ramo de recusa, sem gravar nada: sem empresa, por uma sessão da
// API ou do service_role, com duas empresas, sem Dono ativo, com o funil padrão de uma etapa e com um único registro.
// (3) Numa instância vazia, como o editor SQL (papel postgres), grava as contagens do conjunto com as FKs, os gatilhos e a
// RLS de sempre: autor, base legal, "Não contatar", auditoria, histórico, itens pela save_deal, a anonimização, a
// automação disparada, as datas relativas, o lembrete do Dono e os gatilhos religados; uma segunda execução recusa. (4) A
// remoção recusa, com a mensagem de cada caso, quando um registro de uma pessoa aponta para a demonstração (contato,
// oportunidade, item, histórico de etapas no funil Parcerias, automação com filtro nele) e, sem isso, apaga só a
// demonstração e o que depende dela; o seed roda de novo depois. (5) Com outra empresa, a remoção recusa, e a outra
// empresa não lê nada da demonstração.
async function demoSeedChecks(db, admin) {
  console.log('Executando o seed de demonstração (supabase/seed-demo.sql e supabase/seed-demo-remove.sql)');
  const users = DEMO_USERS;
  const sql = admin.client;
  const failureOfFile = (file) => failureOf(db.runInFreshSession(path.join(ROOT, file)));
  const one = async (query, params = []) => (await sql.query(query, params)).rows[0];
  const check = (ok, message, seen) => {
    if (!ok) throw new DemoSeedCheckError(`${message} (viu: ${JSON.stringify(seen)})`);
    pass(message);
  };
  const countsOf = async (org) => {
    const counts = {};
    for (const table of DEMO_TABLES)
      counts[table] = (await one(`select count(*)::int as n from public.${table} where org_id=$1`, [org])).n;
    return counts;
  };
  const disabledTriggers = async () =>
    (
      await one(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D'`)
    ).n;
  try {
    // (1) Arquivos em dia e schema classificado.
    for (const { file, content } of buildDemoSeedFiles())
      check(
        readFileSync(path.join(ROOT, file), 'utf8') === content,
        `demo seed: ${file} matches scripts/lib/demo-seed.mjs`,
        'arquivo diferente do gerador: rode npm run seed:demo',
      );
    const { rows: tables } = await sql.query(
      `select c.relname as name,array_agg(a.attname::text order by a.attname) as columns from pg_class c
        join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
        where n.nspname='public' and c.relkind in ('r','p') group by c.relname order by c.relname`,
    );
    const drift = [];
    for (const { name, columns } of tables) {
      const declared = DEMO_SCHEMA[name];
      if (!declared) drift.push(`tabela ${name} sem classificação`);
      else if (!declared.skipped) {
        const known = new Set([...declared.written, ...declared.automatic]);
        for (const column of columns) if (!known.has(column)) drift.push(`coluna ${name}.${column} sem classificação`);
        for (const column of known)
          if (!columns.includes(column)) drift.push(`coluna ${name}.${column} não existe mais`);
      }
    }
    for (const name of Object.keys(DEMO_SCHEMA))
      if (!tables.some((row) => row.name === name)) drift.push(`tabela ${name} não existe mais`);
    check(
      drift.length === 0,
      'demo seed: every table and column of public is classified in DEMO_SCHEMA (written by the seed, automatic or skipped)',
      `${drift.join('; ')}. Decida em scripts/lib/demo-seed.mjs se o seed preenche e rode npm run seed:demo`,
    );

    // (2) Recusas sem gravar nada.
    await sql.query('truncate auth.users, public.organizations cascade');
    await sql.query(
      `insert into auth.users(id,email,email_confirmed_at)
        select id::uuid,'demo-'||right(id,3)||'@example.test',now() from unnest($1::text[]) id`,
      [Object.values(users)],
    );
    const withoutCompany = await failureOfFile(SEED_FILE);
    check(
      String(withoutCompany?.message).includes('Este CRM ainda não tem empresa') &&
        (await one('select count(*)::int as n from public.pipelines')).n === 0,
      'demo seed: without a company, the seed refuses and explains the order (first signup, then the seed)',
      withoutCompany?.message ?? 'gravou',
    );
    const { org } = await one("select private.provision_organization($1,'Empresa de aula') as org", [users.owner]);
    await sql.query('update public.profiles set org_id=$1 where id = any($2::uuid[])', [
      org,
      [users.colleague, users.admin],
    ]);
    await sql.query("insert into public.user_roles(user_id,org_id,role) values($1,$3,'member'),($2,$3,'admin')", [
      users.colleague,
      users.admin,
      org,
    ]);
    const api = await db.openSession();
    try {
      await beginAs(api, claimsOf(users.owner));
      const fromApi = await failureOf(runSqlFile(api.client, path.join(ROOT, SEED_FILE)));
      await api.client.query('rollback');
      check(
        String(fromApi?.message).includes('roda só no editor SQL'),
        'demo seed: a session of the API (authenticated, with the claims of the owner) is refused',
        fromApi?.message ?? 'gravou',
      );
    } finally {
      await api.close();
    }

    // Os outros ramos de recusa, cada um sozinho, sem gravar nada: o service_role sem claims, uma segunda empresa, o Dono
    // desativado, o funil padrão com uma etapa só e um único registro fora de contatos e oportunidades.
    const nothingWritten = async () =>
      (
        await one(
          `select (select count(*) from public.pipelines where org_id=$1)::int+(select count(*) from public.contacts)::int
            +(select count(*) from public.deals)::int as n`,
          [org],
        )
      ).n === 1;
    const refusedWith = async (text, message) => {
      const failure = await failureOfFile(SEED_FILE);
      check(String(failure?.message).includes(text) && (await nothingWritten()), message, failure?.message ?? 'gravou');
    };
    const service = await db.openSession();
    try {
      await service.client.query('begin');
      await service.client.query('set local role service_role');
      const fromService = await failureOf(runSqlFile(service.client, path.join(ROOT, SEED_FILE)));
      await service.client.query('rollback');
      check(
        String(fromService?.message).includes('roda só no editor SQL'),
        'demo seed: the service_role without claims is refused too',
        fromService?.message ?? 'gravou',
      );
    } finally {
      await service.close();
    }
    // A segunda empresa é da pessoa de fora, que volta a ficar sem empresa até o passo (5).
    const { org: extraOrg } = await one("select private.provision_organization($1,'Segunda empresa') as org", [
      users.outsider,
    ]);
    await refusedWith(
      'Este CRM tem mais de uma empresa',
      'demo seed: with two companies, the seed refuses instead of picking one',
    );
    // O papel do único Dono não sai pela tela: só ele sai sem os gatilhos. O resto sai com as FKs conferindo.
    await sql.query('set session_replication_role=replica');
    try {
      await sql.query('delete from public.user_roles where org_id=$1', [extraOrg]);
      await sql.query("update public.user_roles set deactivated_at=now() where user_id=$1 and role='owner'", [
        users.owner,
      ]);
    } finally {
      await sql.query('set session_replication_role=default');
    }
    await sql.query('update public.profiles set org_id=null where id=$1', [users.outsider]);
    for (const table of ['risk_rules', 'pipeline_stages', 'pipelines', 'audit_logs'])
      await sql.query(`delete from public.${table} where org_id=$1`, [extraOrg]);
    await sql.query('delete from public.organizations where id=$1', [extraOrg]);
    await refusedWith('Este CRM não tem um Dono ativo', 'demo seed: without an active owner, the seed refuses');
    await sql.query('set session_replication_role=replica');
    try {
      await sql.query('update public.user_roles set deactivated_at=null where user_id=$1', [users.owner]);
      await sql.query(
        `create temp table demo_saved_stages as select s.* from public.pipeline_stages s join public.pipelines p
          on p.id=s.pipeline_id where p.org_id=$1 and p.is_default
          and s.id<>(select s2.id from public.pipeline_stages s2 where s2.pipeline_id=p.id order by s2."order" limit 1)`,
        [org],
      );
      await sql.query('delete from public.pipeline_stages where id in (select id from demo_saved_stages)');
    } finally {
      await sql.query('set session_replication_role=default');
    }
    await refusedWith(
      'O funil padrão precisa de pelo menos duas etapas',
      'demo seed: with a default pipeline of one stage, the seed refuses',
    );
    await sql.query('set session_replication_role=replica');
    try {
      await sql.query('insert into public.pipeline_stages select * from demo_saved_stages');
      await sql.query('drop table demo_saved_stages');
    } finally {
      await sql.query('set session_replication_role=default');
    }
    for (const [table, insert, label] of [
      [
        'products',
        "insert into public.products(org_id,name,kind,unit,price,billing) values($1,'Item real','service','hora',10,'one_time')",
        '1 item(ns) do catálogo',
      ],
      [
        'email_templates',
        "insert into public.email_templates(org_id,name,subject,body) values($1,'Modelo real','Olá','Texto')",
        '1 modelo(s)',
      ],
    ]) {
      await sql.query(insert, [org]);
      await refusedWith(
        `Este CRM já tem dados (${label})`,
        `demo seed: a single row in ${table} is enough to refuse the seed`,
      );
      await sql.query(`delete from public.${table} where org_id=$1`, [org]);
    }

    // (3) A instância vazia, como o editor SQL.
    const started = performance.now();
    const seeded = await failureOfFile(SEED_FILE);
    if (seeded) throw new DemoSeedCheckError(`o seed falhou numa instância vazia: ${seeded.message}`);
    const elapsed = Math.round(performance.now() - started);
    const expected = demoExpectedCounts();
    const counts = await countsOf(org);
    const structure = await one(
      `select (select count(*) from public.pipelines where org_id=$1)::int as pipelines,
        (select count(*) from public.pipeline_stages where org_id=$1)::int as stages`,
      [org],
    );
    check(
      DEMO_TABLES.every((table) => counts[table] === expected[table]) &&
        structure.pipelines === 1 + expected.pipelines &&
        structure.stages === 4 + expected.pipeline_stages,
      `demo seed: runs on an empty instance in ${elapsed} ms with the counts of the dataset (${counts.contacts} contacts, ${counts.deals} deals, ${counts.activities} activities)`,
      { counts, structure, expected },
    );
    const state = await one(
      `select (select count(*) from pg_constraint where connamespace='public'::regnamespace and contype in ('f','c')
        and not convalidated)::int as unvalidated, coalesce(current_setting('request.jwt.claims',true),'') as claims`,
    );
    const disabled = await disabledTriggers();
    check(
      disabled === 0 && state.unvalidated === 0 && state.claims === '',
      'demo seed: every trigger is enabled again and every FK and CHECK stays validated',
      { disabled, ...state },
    );
    const triggers = await one(
      `select
        (select count(*) from public.contacts c where c.org_id=$1
          and (c.legal_basis_at is null or c.legal_basis_by is distinct from $2))::int as unstamped,
        (select count(*) from public.audit_logs l where l.org_id=$1 and l.entity_type='contacts' and l.action='create'
          and l.user_id=$2)::int as audited,
        (select count(*) from public.deals d where d.org_id=$1
          and not exists(select 1 from public.deal_stage_history h where h.deal_id=d.id))::int as without_history,
        (select count(*) from public.activities a where a.org_id=$1 and a.created_by is distinct from $2)::int as other_authors,
        (select count(*) from public.deals d where d.org_id=$1 and d.item_count>0
          and (d.item_count<>(select count(*) from public.deal_items i where i.deal_id=d.id)
          or d.value<>d.one_time_value+d.monthly_value*coalesce(d.contract_months,0)
          or d.one_time_value<>(select coalesce(sum(i.line_total),0) from public.deal_items i
            where i.deal_id=d.id and i.billing='one_time')))::int as wrong_totals,
        (select count(*) from public.deals d where d.org_id=$1 and d.item_count>0)::int as with_items`,
      [org, users.owner],
    );
    check(
      triggers.unstamped === 0 &&
        triggers.audited === expected.contacts &&
        triggers.without_history === 0 &&
        triggers.other_authors === 0 &&
        triggers.wrong_totals === 0 &&
        triggers.with_items === 7,
      'demo seed: the triggers stamp the legal basis, the author, the audit and the stage history, and save_deal computes the item totals',
      triggers,
    );
    const dates = await one(
      `select
        (select count(*) from public.contacts where org_id=$1 and created_at>now())::int as future_contacts,
        (select count(*) from public.contacts where org_id=$1 and created_at>now()-interval '1 day')::int as last_day,
        (select count(*) from public.contacts where org_id=$1 and created_at<now()-interval '30 days')::int as older,
        (select count(*) from public.deals where org_id=$1 and status<>'open'
          and (closed_at>now() or closed_at<created_at))::int as bad_closing,
        (select count(*) from public.deals where org_id=$1 and (status='open')<>(closed_at is null))::int as closed_mismatch,
        (select count(distinct owner_id) from public.deals where org_id=$1 and status='won')::int as winners,
        (select count(distinct date_trunc('month',closed_at)) from public.deals where org_id=$1 and status='won')::int as win_months,
        (select count(*) from public.deals where org_id=$1 and status='won' and monthly_value>0)::int as monthly_wins`,
      [org],
    );
    check(
      dates.future_contacts === 0 &&
        dates.last_day >= 4 &&
        dates.older >= 10 &&
        dates.bad_closing === 0 &&
        dates.closed_mismatch === 0 &&
        dates.winners >= 2 &&
        dates.win_months >= 2 &&
        dates.monthly_wins >= 2,
      'demo seed: dates are relative to the run (recent contacts, closed_at between creation and now), and wins come from several people and months, with monthly items',
      dates,
    );
    const people = await one(
      `select
        (select count(*) from public.contacts where org_id=$1 and phone is not null
          and phone !~ '^\\+55[0-9]{2}90000[0-9]{4}$')::int as unsafe_phones,
        (select count(*) from public.companies where org_id=$1 and phone !~ '^\\+55[0-9]{2}90000[0-9]{4}$')::int as unsafe_company_phones,
        (select count(*) from public.contacts where org_id=$1 and email is not null and email !~ '@example\\.test$')::int as real_emails,
        (select array_agg(distinct source order by source) from public.contacts where org_id=$1 and source is not null) as sources,
        (select count(distinct legal_basis) from public.contacts where org_id=$1)::int as bases,
        (select count(*) from public.contacts where org_id=$1 and legal_basis='consent' and legal_basis_note is not null)::int as consents,
        (select count(*) from public.contacts where org_id=$1 and job_title is not null)::int as with_title,
        (select count(*) from public.contacts c where c.org_id=$1 and c.do_not_contact and c.do_not_contact_reason is not null
          and c.do_not_contact_by=$2 and c.do_not_contact_at<now())::int as do_not_contact,
        (select count(*) from public.activities a join public.contacts c on c.id=a.contact_id where a.org_id=$1
          and c.do_not_contact and a.completed_at is null
          and a.type in ('call','whatsapp','email','meeting','visit'))::int as blocked_actions,
        (select count(*) from public.contacts c where c.org_id=$1 and c.anonymized_at is not null and c.anonymized_by=$2
          and c.first_name<>'Igor' and c.email is null)::int as anonymized`,
      [org, users.owner],
    );
    check(
      people.unsafe_phones === 0 &&
        people.unsafe_company_phones === 0 &&
        people.real_emails === 0 &&
        ['E-mail', 'Feira', 'Indicação', 'Site', 'Telefone', 'WhatsApp'].every((source) =>
          people.sources.includes(source),
        ) &&
        people.bases >= 3 &&
        people.consents >= 2 &&
        people.with_title >= 10 &&
        people.do_not_contact === 1 &&
        people.blocked_actions === 0 &&
        people.anonymized === 1,
      'demo seed: fictitious E.164 phones and example.test emails, sources in and out of the list, legal bases with consent, one "Não contatar" and one anonymized contact',
      people,
    );
    const work = await one(
      `select
        (select array_agg(distinct type order by type) from public.activities where org_id=$1) as types,
        (select array_agg(distinct outcome order by outcome) from public.activities where org_id=$1 and outcome is not null) as outcomes,
        (select count(*) from public.activities where org_id=$1 and user_id=$2 and completed_at is null and type<>'note'
          and due_date<now())::int as overdue,
        (select count(*) from public.activities where org_id=$1 and user_id=$2 and completed_at is null and type<>'note'
          and due_date>=now() and due_date<(((now() at time zone '${DEMO_TIME_ZONE}')::date+1)::timestamp
          at time zone '${DEMO_TIME_ZONE}'))::int as due_today,
        (select count(*) from public.automations where org_id=$1 and not is_active)::int as paused,
        (select count(distinct trigger_type) from public.automations where org_id=$1)::int as triggers,
        (select count(*) from public.automation_logs l join public.activities a on a.id=l.activity_id
          where l.org_id=$1 and l.status='success' and a.title='Enviar a proposta em até 2 dias')::int as fired,
        (select array_agg(distinct status order by status) from public.payments where org_id=$1) as payment_statuses,
        (select count(*) from public.payments where org_id=$1 and status='pending' and due_date<current_date)::int as overdue_payments,
        (select count(*) from public.email_templates where org_id=$1 and body like '%{{primeiro_nome}}%')::int as templates,
        (select count(*) from public.products p where p.org_id=$1 and p.archived_at is not null
          and exists(select 1 from public.deal_items i where i.product_id=p.id))::int as archived_in_use,
        (select array_agg(distinct kind||'/'||billing order by kind||'/'||billing) from public.products where org_id=$1) as catalog,
        (select count(*) from public.deal_items where org_id=$1 and product_id is null)::int as loose_items,
        (select count(*) from public.deal_items where org_id=$1 and discount_type is not null)::int as discounts`,
      [org, users.owner],
    );
    check(
      ['call', 'email', 'meeting', 'note', 'task', 'visit', 'whatsapp'].every((type) => work.types.includes(type)) &&
        ['answered', 'no_answer', 'voicemail'].every((outcome) => work.outcomes.includes(outcome)) &&
        work.overdue >= 1 &&
        work.due_today >= 1 &&
        work.paused === 1 &&
        work.triggers === 3 &&
        work.fired === 1 &&
        ['cancelled', 'paid', 'pending'].every((status) => work.payment_statuses.includes(status)) &&
        work.overdue_payments >= 1 &&
        work.templates >= 1 &&
        work.archived_in_use === 1 &&
        work.catalog.includes('product/monthly') &&
        work.catalog.includes('service/one_time') &&
        work.loose_items >= 1 &&
        work.discounts >= 2,
      'demo seed: every activity type and call outcome, an overdue and a due-today activity of the owner (menu reminder), automations with one fired, payments, templates and the catalog',
      work,
    );
    const team = await db.openSession();
    try {
      for (const [who, role] of [
        [users.colleague, 'member'],
        [users.admin, 'admin'],
      ]) {
        await beginAs(team, claimsOf(who));
        const { n } = (await team.client.query('select count(*)::int as n from public.contacts')).rows[0];
        await team.client.query('rollback');
        check(
          n === expected.contacts,
          `demo seed: the ${role} role of the company reads the demo contacts through RLS`,
          n,
        );
      }
    } finally {
      await team.close();
    }
    const again = await failureOfFile(SEED_FILE);
    const afterAgain = await countsOf(org);
    check(
      String(again?.message).includes('Este CRM já tem dados') &&
        DEMO_TABLES.every((table) => afterAgain[table] === counts[table]),
      'demo seed: a second run on an instance with data is refused and writes nothing',
      again?.message ?? 'gravou',
    );

    // Achado 1 da revisão do item 1.15: a trava "nunca roda pelo navegador" da remoção, como a do seed. Pela sessão da API
    // (com as claims do Dono), pelo service_role sem claims, como anon e como postgres com request.jwt.claims definida:
    // cada caso recusa com a mensagem e não apaga nada.
    const removalRefusedAs = async (setup, message) => {
      const session = await db.openSession();
      let failure;
      try {
        await setup(session);
        failure = await failureOf(runSqlFile(session.client, path.join(ROOT, REMOVE_FILE)));
        await session.client.query('rollback');
      } finally {
        await session.close();
      }
      const now = await countsOf(org);
      check(
        String(failure?.message).includes('A remoção da demonstração roda só no editor SQL') &&
          DEMO_TABLES.every((table) => now[table] === counts[table]),
        message,
        failure?.message ?? 'apagou',
      );
    };
    const withRole = (role) => async (session) => {
      await session.client.query('begin');
      await session.client.query(`set local role ${role}`);
    };
    await removalRefusedAs(
      (session) => beginAs(session, claimsOf(users.owner)),
      'demo seed removal: a session of the API (authenticated, with the claims of the owner) is refused and deletes nothing',
    );
    await removalRefusedAs(
      withRole('service_role'),
      'demo seed removal: the service_role without claims is refused and deletes nothing',
    );
    await removalRefusedAs(withRole('anon'), 'demo seed removal: the anon role is refused and deletes nothing');
    await removalRefusedAs(async (session) => {
      await session.client.query('begin');
      await session.client.query("select set_config('request.jwt.claims', $1, true)", [claimsOf(users.owner)]);
    }, 'demo seed removal: postgres with request.jwt.claims set (a session coming from the API) is refused and deletes nothing');

    // (4) A remoção.
    const { id: realContact } = await one(
      `insert into public.contacts(org_id,first_name,company_id) values($1,'Cliente de verdade',
        (select id from public.companies where org_id=$1 order by created_at limit 1)) returning id`,
      [org],
    );
    const { id: realDeal } = await one(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,value)
        select $1,p.id,s.id,'Negócio de verdade',100 from public.pipelines p join public.pipeline_stages s on s.pipeline_id=p.id
        where p.org_id=$1 and p.is_default order by s."order" limit 1 returning id`,
      [org],
    );
    await sql.query(
      `insert into public.activities(org_id,type,title,contact_id,completed_at)
        select $1,'note','Anotação da aula',id,now() from public.contacts where org_id=$1 and do_not_contact and anonymized_at is null`,
      [org],
    );
    // A oportunidade da pessoa dispara a automação "Primeira ligação do negócio novo": a tarefa é dela e fica.
    const blocked = await failureOfFile(REMOVE_FILE);
    const afterBlocked = await countsOf(org);
    check(
      String(blocked?.message).includes('1 contato(s) ligado(s) a uma empresa da demonstração') &&
        afterBlocked.contacts === counts.contacts + 1 &&
        afterBlocked.activities === counts.activities + 2,
      'demo seed removal: a record of a person that points to the demo refuses the removal, and nothing is deleted',
      blocked?.message ?? 'apagou',
    );
    await sql.query('update public.contacts set company_id=null where id=$1', [realContact]);
    // Os outros bloqueios, cada um sozinho: a oportunidade da pessoa ligada a um contato da demonstração, um item dela
    // com um item do catálogo da demonstração, uma oportunidade que passou pelo funil Parcerias (o histórico de etapas
    // aponta para as etapas sem ON DELETE) e uma automação com filtro nesse funil (seria pausada sem aviso).
    const blockedWith = async (text, message) => {
      const failure = await failureOfFile(REMOVE_FILE);
      const now = await countsOf(org);
      check(
        String(failure?.message).includes(text) &&
          String(failure?.message).includes('Nada foi apagado') &&
          now.contacts === counts.contacts + 1 &&
          now.products === counts.products,
        message,
        failure?.message ?? 'apagou',
      );
    };
    const { id: demoContact } = await one(
      `select id from public.contacts where org_id=$1 and id<>$2 and anonymized_at is null and not do_not_contact
        order by created_at limit 1`,
      [org, realContact],
    );
    await sql.query('update public.deals set contact_id=$2 where id=$1', [realDeal, demoContact]);
    await blockedWith(
      '1 oportunidade(s) ligada(s) a um contato, a uma empresa ou ao funil Parcerias da demonstração',
      'demo seed removal: a deal of a person linked to a demo contact refuses the removal',
    );
    await sql.query('update public.deals set contact_id=null where id=$1', [realDeal]);
    await sql.query('set session_replication_role=replica');
    try {
      await sql.query(
        `insert into public.deal_items(id,org_id,deal_id,product_id,position,name,quantity,unit_price,billing)
          select gen_random_uuid(),$1,$2,p.id,0,p.name,1,p.price,p.billing from public.products p
          where p.org_id=$1 and p.archived_at is null order by p.created_at limit 1`,
        [org, realDeal],
      );
    } finally {
      await sql.query('set session_replication_role=default');
    }
    await blockedWith(
      '1 item(ns) de oportunidade com um item do catálogo da demonstração',
      'demo seed removal: an item of a deal of a person with a demo catalog item refuses the removal',
    );
    await sql.query('set session_replication_role=replica');
    try {
      await sql.query('delete from public.deal_items where deal_id=$1', [realDeal]);
    } finally {
      await sql.query('set session_replication_role=default');
    }
    const partner = await one(
      `select p.id as pipeline,(select s.id from public.pipeline_stages s where s.pipeline_id=p.id order by s."order" limit 1)
        as stage from public.pipelines p where p.org_id=$1 and not p.is_default`,
      [org],
    );
    const home = await one('select pipeline_id as pipeline,stage_id as stage from public.deals where id=$1', [
      realDeal,
    ]);
    const { id: visitorDeal } = await one(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,value) values($1,$2,$3,'Negócio que passou por Parcerias',50)
        returning id`,
      [org, partner.pipeline, partner.stage],
    );
    await sql.query('update public.deals set pipeline_id=$2,stage_id=$3 where id=$1', [
      visitorDeal,
      home.pipeline,
      home.stage,
    ]);
    await blockedWith(
      '1 oportunidade(s) que já passaram pelo funil Parcerias da demonstração',
      'demo seed removal: a deal of a person whose stage history passed through the demo pipeline refuses the removal with a clear message, not a raw FK error',
    );
    await sql.query('delete from public.activities where deal_id=$1', [visitorDeal]);
    await sql.query('delete from public.deals where id=$1', [visitorDeal]);
    const { id: personAutomation } = await one(
      `insert into public.automations(org_id,name,trigger_type,pipeline_id,stage_id,is_active,task_title,due_days)
        values($1,'Da pessoa','deal_moved',$2,$3,true,'Ligar',1) returning id`,
      [org, partner.pipeline, partner.stage],
    );
    await blockedWith(
      '1 automação(ões) com filtro no funil Parcerias da demonstração',
      'demo seed removal: an automation of a person filtered on the demo pipeline refuses the removal instead of being paused',
    );
    await sql.query('delete from public.automations where id=$1', [personAutomation]);
    const removed = await failureOfFile(REMOVE_FILE);
    if (removed) throw new DemoSeedCheckError(`a remoção falhou: ${removed.message}`);
    const left = await countsOf(org);
    const leftover = await one(
      `select (select count(*) from public.pipelines where org_id=$1)::int as pipelines,
        (select string_agg(first_name,',') from public.contacts where org_id=$1) as contacts,
        (select string_agg(title,',') from public.deals where org_id=$1) as deals`,
      [org],
    );
    const disabledAfterRemoval = await disabledTriggers();
    check(
      left.contacts === 1 &&
        left.deals === 1 &&
        left.companies === 0 &&
        left.activities === 1 &&
        left.payments === 0 &&
        left.products === 0 &&
        left.deal_items === 0 &&
        left.automations === 0 &&
        left.email_templates === 0 &&
        left.privacy_actions === 1 &&
        leftover.pipelines === 1 &&
        leftover.contacts === 'Cliente de verdade' &&
        leftover.deals === 'Negócio de verdade' &&
        disabledAfterRemoval === 0,
      'demo seed removal: deletes only the demo and what depends on it (including the class note), and keeps the records of people (with the task of their deal)',
      { left, leftover, disabledAfterRemoval },
    );
    const nothing = await failureOfFile(REMOVE_FILE);
    check(
      String(nothing?.message).includes('não tem dados de demonstração'),
      'demo seed removal: a second removal says there is no demo data',
      nothing?.message ?? 'apagou',
    );
    const notEmpty = await failureOfFile(SEED_FILE);
    check(
      String(notEmpty?.message).includes('1 contato(s), 1 oportunidade(s)'),
      'demo seed: the records of people left after the removal still block a new seed',
      notEmpty?.message ?? 'gravou',
    );
    await sql.query('delete from public.activities where deal_id=$1', [realDeal]);
    await sql.query('delete from public.deals where id=$1', [realDeal]);
    await sql.query('delete from public.contacts where id=$1', [realContact]);
    // O histórico fica: o registro da primeira anonimização e os das três automações (a da demonstração e as das duas
    // oportunidades da pessoa, a que ficou e a que passou por Parcerias), sem o vínculo com as oportunidades excluídas.
    const HISTORY_KEPT = { privacy_actions: 1, automation_logs: 3 };
    const reseeded = await failureOfFile(SEED_FILE);
    if (reseeded) throw new DemoSeedCheckError(`o seed falhou depois da remoção: ${reseeded.message}`);
    let reseededCounts = await countsOf(org);
    check(
      DEMO_TABLES.every((table) => reseededCounts[table] === expected[table] + (HISTORY_KEPT[table] ?? 0)),
      'demo seed: after the removal, the seed runs again with the same counts (the history of the first run stays)',
      reseededCounts,
    );
    // A turma exclui pela tela só uma parte da demonstração (contatos, oportunidades, catálogo, atividades,
    // recebimentos e o funil Parcerias): a remoção ainda reconhece o resto (empresas, automações e modelos) e o apaga.
    await sql.query('delete from public.activities where org_id=$1', [org]);
    await sql.query('delete from public.payments where org_id=$1', [org]);
    await sql.query('delete from public.deals where org_id=$1', [org]);
    await sql.query('delete from public.contacts where org_id=$1', [org]);
    await sql.query('delete from public.products where org_id=$1', [org]);
    await sql.query('delete from public.pipelines where org_id=$1 and not is_default', [org]);
    const partial = await countsOf(org);
    const partialRemoval = await failureOfFile(REMOVE_FILE);
    const afterPartial = await countsOf(org);
    check(
      partial.companies === expected.companies &&
        partial.automations === expected.automations &&
        partial.email_templates === expected.email_templates &&
        partialRemoval === null &&
        afterPartial.companies === 0 &&
        afterPartial.automations === 0 &&
        afterPartial.email_templates === 0,
      'demo seed removal: with only the demo companies, automations and templates left, the removal still deletes them',
      { partial, afterPartial, message: partialRemoval?.message },
    );
    const reseededAgain = await failureOfFile(SEED_FILE);
    if (reseededAgain)
      throw new DemoSeedCheckError(`o seed falhou depois da remoção parcial: ${reseededAgain.message}`);
    reseededCounts = await countsOf(org);
    check(
      ['contacts', 'companies', 'deals', 'automations', 'email_templates'].every(
        (table) => reseededCounts[table] === expected[table],
      ),
      'demo seed: after a partial deletion and the removal, the seed runs again',
      reseededCounts,
    );
    // Achado 3 da revisão do item 1.15: a equipe exclui pela tela todos os registros e mantém o funil "Parcerias". O seed
    // recusa em pt-BR, manda rodar a remoção antes e não grava nada (antes, falhava com o erro cru do PostgreSQL).
    for (const table of [
      'activities',
      'payments',
      'deals',
      'contacts',
      'products',
      'companies',
      'automations',
      'email_templates',
    ])
      await sql.query(`delete from public.${table} where org_id=$1`, [org]);
    const funnels = async () =>
      await one(
        `select (select count(*) from public.pipelines where org_id=$1)::int as pipelines,
            (select count(*) from public.pipeline_stages where org_id=$1)::int as stages,
            (select count(*) from public.contacts where org_id=$1)::int as contacts`,
        [org],
      );
    const beforeLeftover = await funnels();
    const leftoverFunnel = await failureOfFile(SEED_FILE);
    const afterLeftover = await funnels();
    check(
      String(leftoverFunnel?.message).includes(
        'Sobrou o funil "Parcerias" de uma demonstração anterior (com 3 etapa(s))',
      ) &&
        String(leftoverFunnel?.message).includes('Rode supabase/seed-demo-remove.sql antes') &&
        JSON.stringify(afterLeftover) === JSON.stringify(beforeLeftover) &&
        afterLeftover.contacts === 0 &&
        afterLeftover.pipelines === 2,
      'demo seed: with every record deleted but the "Parcerias" funnel kept, the seed refuses in pt-BR and writes nothing',
      { message: leftoverFunnel?.message ?? 'gravou', beforeLeftover, afterLeftover },
    );
    const leftoverRemoval = await failureOfFile(REMOVE_FILE);
    const reseededThird = leftoverRemoval ?? (await failureOfFile(SEED_FILE));
    if (reseededThird)
      throw new DemoSeedCheckError(`a remoção do funil que sobrou ou o seed seguinte falhou: ${reseededThird.message}`);
    reseededCounts = await countsOf(org);
    check(
      reseededCounts.contacts === expected.contacts && (await funnels()).pipelines === 2,
      'demo seed: after removing the leftover funnel, the seed runs again',
      reseededCounts,
    );

    // (5) Outra empresa não lê nada da demonstração.
    await sql.query("select private.provision_organization($1,'Outra empresa')", [users.outsider]);
    const twoCompanies = await failureOfFile(REMOVE_FILE);
    check(
      String(twoCompanies?.message).includes('não tem exatamente uma empresa') &&
        (await countsOf(org)).contacts === reseededCounts.contacts,
      'demo seed removal: with two companies, the removal refuses and deletes nothing',
      twoCompanies?.message ?? 'apagou',
    );
    const outsider = await db.openSession();
    try {
      await beginAs(outsider, claimsOf(users.outsider));
      const { n } = (
        await outsider.client.query(
          `select (select count(*) from public.contacts)+(select count(*) from public.companies)
            +(select count(*) from public.deals)+(select count(*) from public.deal_items)
            +(select count(*) from public.activities)+(select count(*) from public.payments)
            +(select count(*) from public.products)+(select count(*) from public.email_templates)
            +(select count(*) from public.automations) as n`,
        )
      ).rows[0];
      await outsider.client.query('rollback');
      check(Number(n) === 0, 'demo seed: a person of another company reads none of the demo rows (RLS)', n);
    } finally {
      await outsider.close();
    }
  } catch (error) {
    throw error instanceof DemoSeedCheckError
      ? error
      : new DemoSeedCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Item 1.13 (docs/arquitetura/1.13.md, seção 16.2): o manifesto versionado, os objetos das linhas "Do 1.x" do roteiro e
// o check de drift (supabase/db-drift-check.sql) no banco recém-migrado e num banco alterado de propósito, numa
// transação desfeita no fim. Roda logo depois das migrações, antes dos arquivos de teste.
// ---------------------------------------------------------------------------------------------
// Objetos citados nas linhas "Do 1.1" a "Do 1.16" do item 1.13 no roteiro (AC-3): função pelo começo da assinatura, o
// resto pelo nome qualificado.
const ROADMAP_OBJECTS = [
  // Do 1.1 e o reforço.
  'function private.provision_organization(',
  'function private.instance_status(',
  'function private.signup_allowed(',
  'function private.create_invitation(',
  'function private.restore_owner(',
  'trigger auth.users.enforce_invite_only_signup',
  'table private.email_proofs',
  'function private.discard_unproven_password(',
  'function private.record_email_proof(',
  'function private.refuse_email_change_without_org(',
  'function private.email_proven(',
  'trigger auth.users.discard_unproven_password',
  'trigger auth.users.refuse_email_change_without_org',
  'trigger auth.mfa_amr_claims.record_email_proof',
  // Do 1.2.
  'function private.current_org(',
  'function private.role_change_allowed(',
  'function private.refuse_inactive_assignee(',
  'trigger public.deals.refuse_inactive_assignee',
  'trigger public.activities.refuse_inactive_assignee',
  'trigger public.contacts.refuse_inactive_assignee',
  'trigger public.companies.refuse_inactive_assignee',
  'function private.portfolio_counts(',
  'function private.check_portfolio_recipient(',
  'function private.move_member_portfolio(',
  'function public.member_portfolio(',
  'function public.deactivate_member(',
  'function public.transfer_portfolio(',
  'function public.reactivate_member(',
  'table public.portfolio_transfers',
  // Do 1.9.
  'function private.normalize_activity_outcome(',
  'function private.stamp_do_not_contact(',
  'trigger public.activities.normalize_activity_outcome',
  'trigger public.contacts.stamp_do_not_contact',
  'trigger public.companies.stamp_do_not_contact',
  'function public.complete_activity(',
  // Do 1.10.
  'function private.stamp_default_legal_basis(',
  'function private.stamp_legal_basis(',
  'function private.protect_anonymized_contact(',
  'function private.guard_anonymized_contact(',
  'function private.refuse_do_not_contact_action(',
  'trigger public.organizations.stamp_default_legal_basis',
  'trigger public.contacts.stamp_legal_basis',
  'trigger public.contacts.protect_anonymized_contact',
  'trigger public.activities.guard_anonymized_contact',
  'trigger public.deals.guard_anonymized_contact',
  'trigger public.payments.guard_anonymized_contact',
  'trigger public.activities.refuse_do_not_contact_action',
  'function private.privacy_term_regex(',
  'function private.privacy_phone_regex(',
  'function private.redact_personal_terms(',
  'function public.contact_privacy_summary(',
  'function public.anonymize_contact(',
  'function public.export_contact_data(',
  'table public.privacy_actions',
  // Do 1.11.
  'function private.fit_redacted_text(',
  'function private.anonymize_contact(',
  // Do 1.15.
  'function private.save_deal(',
  'function public.move_deal(',
  // Do 1.16.
  'table public.products',
  'table public.deal_items',
  'function public.save_deal(',
  'function private.protect_deal_totals(',
  'trigger public.deals.protect_deal_totals',
  'function private.contact_privacy_counts(',
  'function private.export_contact_data(',
];

async function driftCheckChecks(db) {
  console.log(`Executando o manifesto e o check de drift (${MANIFEST_FILE} e ${DRIFT_CHECK_FILE})`);
  const check = (ok, message, seen) => {
    if (!ok) throw new DriftCheckError(`${message}${seen === undefined ? '' : ` (viu: ${JSON.stringify(seen)})`}`);
    pass(message);
  };
  const manifest = JSON.parse(readFileSync(path.join(ROOT, MANIFEST_FILE), 'utf8'));
  const driftCheck = readFileSync(path.join(ROOT, DRIFT_CHECK_FILE), 'utf8');
  const session = await db.openSession();
  const sql = session.client;
  const runCheck = async () => (await sql.query(driftCheck)).rows;
  const describe = (rows) => rows.map((row) => `${row.situacao}/${row.tipo}/${row.objeto}`);
  try {
    // (1) O manifesto versionado bate com o banco recém-migrado (redundante com o manifest:check, mas aponta o objeto).
    const { rows } = await sql.query('select * from private.base_fingerprints()');
    const version = (await sql.query('show server_version_num')).rows[0].server_version_num;
    const fresh = buildManifest({
      rows,
      migrationFiles: readdirSync(path.join(ROOT, MIGRATIONS_DIR)),
      postgresMajor: Math.trunc(Number(version) / 10000),
      baseMigrations: readBaseMigrationNames(),
    });
    const keyOf = (object) => `${object.kind} ${object.object}`;
    const versioned = new Map(manifest.objects.map((object) => [keyOf(object), object.hash]));
    const freshKeys = new Set(fresh.objects.map(keyOf));
    const differing = fresh.objects.filter((object) => versioned.get(keyOf(object)) !== object.hash).map(keyOf);
    const missing = [...versioned.keys()].filter((entry) => !freshKeys.has(entry));
    check(
      !differing.length && !missing.length && fresh.lastMigration === manifest.lastMigration,
      'update protection: the versioned base manifest matches private.base_fingerprints() of the freshly migrated database',
      { differing: differing.slice(0, 5), missing: missing.slice(0, 5), hint: 'rode npm run manifest:build' },
    );
    check(
      reservedPrefixProblems(manifest).length === 0,
      'update protection: only the eight hooks use the custom_ prefix in the base',
      reservedPrefixProblems(manifest),
    );
    // (2) AC-3: os objetos das linhas "Do 1.x" do item 1.13.
    const absent = ROADMAP_OBJECTS.filter((entry) => {
      const [kind, name] = entry.split(' ');
      return !manifest.objects.some(
        (object) =>
          (object.kind === kind || (kind === 'function' && object.kind === 'hook')) &&
          (name.endsWith('(') ? object.object.startsWith(name) : object.object === name),
      );
    });
    check(
      !absent.length,
      `update protection: the manifest lists the ${ROADMAP_OBJECTS.length} objects of the roadmap "Do 1.x" lines`,
      absent,
    );

    // (3) AC-4 e AC-6: no banco recém-migrado. Só leitura e sem o histórico: o resumo e a linha que diz que ele não
    // existe. Com o histórico completo: só o resumo, com zero alterados, ausentes, ganchos e extras.
    await sql.query('begin read only');
    const withoutHistory = await runCheck();
    await sql.query('rollback');
    check(
      withoutHistory.length === 2 &&
        withoutHistory[0].situacao === 'resumo' &&
        withoutHistory[0].detalhe.includes('Alterados: 0. Ausentes: 0. Ganchos em uso: 0. Extras: 0.') &&
        withoutHistory[1].gravidade === 'informação' &&
        withoutHistory[1].detalhe.includes('não tem supabase_migrations.schema_migrations'),
      'update protection: on the fresh database the read-only drift check returns the summary and the missing-history note only',
      describe(withoutHistory),
    );
    await sql.query('begin');
    await sql.query('create schema supabase_migrations');
    await sql.query(
      'create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text)',
    );
    for (const migration of manifest.migrations)
      await sql.query('insert into supabase_migrations.schema_migrations(version,name) values($1,$2)', [
        migration.version,
        migration.name,
      ]);
    const withHistory = await runCheck();
    check(
      withHistory.length === 1 &&
        withHistory[0].detalhe.includes('Histórico com todas as migrações da base.') &&
        withHistory[0].detalhe.includes('Alterados: 0. Ausentes: 0. Ganchos em uso: 0. Extras: 0.'),
      'update protection: with the full migration history the drift check returns only the summary',
      describe(withHistory),
    );

    // (4) AC-5: um banco alterado de propósito, na mesma transação (desfeita no fim).
    const skipped = manifest.migrations[1];
    await sql.query('delete from supabase_migrations.schema_migrations where version=$1', [skipped.version]);
    await sql.query(
      "insert into supabase_migrations.schema_migrations(version,name) values('20260908164956','instagram_backend')",
    );
    const { definition } = (
      await sql.query("select pg_get_functiondef('private.touch_updated_at()'::regprocedure) as definition")
    ).rows[0];
    await sql.query(definition.replace('$function$', '$function$\n-- alterada à mão'));
    await sql.query(`
      alter function private.is_owner() security invoker;
      alter function private.role_change_allowed(text,text,text) reset search_path;
      grant execute on function private.signup_allowed(text) to anon;
      drop function private.fit_redacted_text(text,integer);
      alter table public.deals disable trigger validate_deal_change;
      alter policy tenant_read on public.products using (true);
      alter policy tenant_update on public.products to authenticated, anon;
      drop policy tenant_delete on public.products;
      drop trigger touch_updated_at on public.products;
      alter table public.payments disable row level security;
      alter table public.products alter column code set not null;
      drop index public.products_org_name;
      create index products_org_name on public.products(org_id, name desc);
      create or replace function private.custom_validate_contact(p_new public.contacts, p_old public.contacts) returns void
       language plpgsql security invoker set search_path='' as $$
      begin
       if p_new.email is null then raise exception 'Informe o e-mail do contato.'; end if;
      end $$;
      create function private.custom_validate_deal(p_new jsonb) returns void language sql as 'select null';
      grant execute on function private.custom_after_deal_saved(public.deals,public.deals) to anon;
      drop function private.custom_after_company_saved(public.companies,public.companies);
      create policy open_read on public.contacts for select to anon using (true);
      create table public.instagram_demo(id uuid primary key, org_id uuid not null, name text);
      alter table public.instagram_demo enable row level security;
      create policy instagram_demo_read on public.instagram_demo for select to authenticated using (true);
      alter table public.contacts add column custom_cnpj text;
      create function private.intake_demo_check() returns trigger language plpgsql as 'begin return new; end';
      create trigger intake_check_contact_fields before insert on public.contacts
       for each row execute function private.intake_demo_check();
      create table public.leads_abertos(id serial primary key, email text);
      create function public.vaza_tudo() returns setof public.contacts language sql security definer
       set search_path='' as 'select * from public.contacts';
      create view public.contatos_abertos as select id, first_name from public.contacts;
      -- Desde o item 1.8, o que postgres cria nasce sem permissão para a API: o acesso aberto vem de um grant explícito.
      grant select, insert on public.leads_abertos to anon;
      grant execute on function public.vaza_tudo() to anon;
      grant select on public.contatos_abertos to anon;
      create function public.custom_definer_fechada() returns integer language sql security definer
       set search_path='' as 'select 1';
      revoke execute on function public.custom_definer_fechada() from public, anon, authenticated;
      create table public.custom_fila(id uuid primary key);
      alter table public.custom_fila enable row level security;
      -- Item 1.8: um privilégio padrão reaberto (por último, para não valer para os objetos criados acima).
      alter default privileges for role postgres in schema public grant select on tables to anon;
    `);
    const altered = await runCheck();
    const key = (situacao, tipo, objeto) => `${situacao}|${tipo}|${objeto}`;
    const expected = [
      ['alterado', 'função', 'private.touch_updated_at()', 'Corpo diferente do da base.'],
      ['alterado', 'função', 'private.is_owner()', 'Segurança: definer → invoker'],
      ['alterado', 'função', 'private.role_change_allowed(text,text,text)', 'Configuração: search_path="" → (nenhum)'],
      ['alterado', 'função', 'private.signup_allowed(text)', 'Permissões: anon=X a mais'],
      ['alterado', 'gatilho', 'public.deals.validate_deal_change', 'Gatilho desligado.'],
      ['alterado', 'política', 'public.products.tenant_read', 'Expressão (USING ou WITH CHECK) diferente da da base.'],
      ['alterado', 'política', 'public.products.tenant_update', 'Papéis: authenticated → anon,authenticated'],
      ['alterado', 'tabela', 'public.payments', 'RLS: sim → não'],
      ['alterado', 'coluna', 'public.products.code', 'Obrigatória (not null): não → sim'],
      ['alterado', 'índice', 'public.products.products_org_name', 'Definição diferente da da base.'],
      ['ausente', 'função', 'private.fit_redacted_text(text,integer)', 'Não existe neste banco.'],
      ['ausente', 'política', 'public.products.tenant_delete', 'Não existe neste banco.'],
      ['ausente', 'gatilho', 'public.products.touch_updated_at', 'Não existe neste banco.'],
      ['ausente', 'migração', `${skipped.version}_${skipped.name}`, 'não está no histórico'],
      [
        'alterado',
        'função',
        'private.custom_after_deal_saved(public.deals,public.deals)',
        'Permissões: anon=X a mais. A base chama private.custom_after_deal_saved(public.deals,public.deals) com a assinatura e as permissões que ela criou e não conhece esta versão.',
      ],
      [
        'ausente',
        'função',
        'private.custom_after_company_saved(public.companies,public.companies)',
        'Sem este gancho, toda gravação em public.companies falha.',
      ],
      ['gancho', 'função', 'private.custom_validate_contact(public.contacts,public.contacts)', 'Em uso: corpo próprio'],
      ['gancho', 'função', 'private.custom_validate_deal(jsonb)', 'a base não chama esta função'],
      ['extra', 'tabela', 'public.instagram_demo', 'Com 3 colunas, 1 restrição, 1 política.'],
      ['extra', 'coluna', 'public.contacts.custom_cnpj', 'Personalização desta instância.'],
      ['extra', 'gatilho', 'public.contacts.intake_check_contact_fields', 'Confira depois de cada atualização'],
      ['extra', 'função', 'private.intake_demo_check()', 'Fora da base.'],
      [
        'extra',
        'política',
        'public.contacts.open_read',
        'Política permissiva numa tabela da base (comando select, papéis anon)',
        'atenção',
      ],
      ['extra', 'migração', '20260908164956_instagram_backend', 'Migração desta instância'],
      // Item 1.8: o privilégio padrão reaberto, com o comando que fecha.
      [
        'alterado',
        'privilégio padrão',
        'postgres/public/tables',
        'Permissões: anon=r a mais. Objetos novos (tabelas e views) criados por postgres em public nascem com permissões para a API',
      ],
      [
        'alterado',
        'privilégio padrão',
        'postgres/public/tables',
        'alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated, service_role',
      ],
      // Extras em public que a API alcança sem login (grant explícito para anon): atenção.
      ['extra', 'tabela', 'public.leads_abertos', 'Sem RLS e com permissões para anon ou authenticated', 'atenção'],
      ['extra', 'função', 'public.vaza_tudo()', 'SECURITY DEFINER e executável por anon', 'atenção'],
      ['extra', 'view', 'public.contatos_abertos', 'View sem security_invoker', 'atenção'],
      // A função definer sem EXECUTE para a API e a tabela com RLS sem políticas: só informação.
      ['extra', 'função', 'public.custom_definer_fechada()', 'Personalização desta instância.'],
      ['extra', 'tabela', 'public.custom_fila', 'RLS ligada e nenhuma política'],
    ];
    const informative = (situacao, fragment) => situacao === 'extra' || fragment.startsWith('Em uso');
    const seen = new Map(altered.slice(1).map((row) => [key(row.situacao, row.tipo, row.objeto), row]));
    for (const [situacao, tipo, objeto, fragment, gravidade] of expected) {
      const row = seen.get(key(situacao, tipo, objeto));
      check(
        Boolean(row) &&
          row.detalhe.includes(fragment) &&
          row.gravidade === (gravidade ?? (informative(situacao, fragment) ? 'informação' : 'atenção')),
        `update protection: the drift check reports ${situacao} for ${tipo} ${objeto}`,
        row ?? describe(altered),
      );
    }
    const unexpected = [...seen.keys()].filter(
      (found) => !expected.some(([situacao, tipo, objeto]) => key(situacao, tipo, objeto) === found),
    );
    check(
      unexpected.length === 0 && altered[0].situacao === 'resumo',
      'update protection: the drift check reports exactly the deliberate changes (children of an extra table summarized in its row)',
      unexpected,
    );
    const exposing = [
      'public.contacts.open_read',
      'public.leads_abertos',
      'public.vaza_tudo()',
      'public.contatos_abertos',
    ];
    check(
      altered.every(
        (row) => row.situacao !== 'extra' || row.gravidade === 'informação' || exposing.includes(row.objeto),
      ),
      'update protection: no extra row has the attention severity, except the ones that open data through the API',
    );
    check(
      altered[0].detalhe.includes('Falta 1 migração da base') &&
        altered[0].detalhe.includes('Alterados: 12. Ausentes: 4. Ganchos em uso: 1.') &&
        altered[0].detalhe.includes('Extras: 11. Extras com atenção (abrem dados pela API): 4.'),
      'update protection: the summary counts the changes and the missing base migration',
      altered[0].detalhe,
    );
    await sql.query('rollback');
  } catch (error) {
    await sql.query('rollback').catch(() => undefined);
    throw error instanceof DriftCheckError
      ? error
      : new DriftCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Item 1.5 (docs/arquitetura/1.5.md, seção 16.2): os SQL de apoio da restauração de um backup, sem pg_dump, num banco
// recém-migrado à parte (o banco principal recebe os dados de supabase/tests/upgrade antes das migrações e não fica
// vazio). (1) supabase/backup/restore-prepare.sql passa no banco recém-migrado: nenhuma migração grava linha num projeto
// novo (a regra de RESTORE_SEEDED_TABLES); numa transação desfeita, uma linha em public, uma em private.email_proofs e
// uma conta reprovam, cada uma com o nome, e uma sessão com request.jwt.claims também. (2) supabase/backup/
// restore-check.sql passa numa instância coerente (com a chave composta de empresa nula, MATCH SIMPLE) e reprova uma
// chave estrangeira órfã carregada com session_replication_role = replica, um gatilho desligado em public.contacts e em
// auth.users e uma tabela de public sem RLS.
// ---------------------------------------------------------------------------------------------
const RESTORE_DATABASE = 'crm_restauracao';
const RESTORE_USERS = Object.freeze({
  owner: '00000000-0000-0000-0000-000000000501',
  admin: '00000000-0000-0000-0000-000000000502',
  member: '00000000-0000-0000-0000-000000000503',
  viewer: '00000000-0000-0000-0000-000000000504',
  outsider: '00000000-0000-0000-0000-000000000505',
});

async function restoreSupportChecks(db) {
  console.log(
    `Executando os SQL de apoio da restauração (${PREPARE_FILE} e ${CHECK_FILE}) no banco ${RESTORE_DATABASE}`,
  );
  const check = (ok, message, seen) => {
    if (!ok) throw new RestoreCheckError(`${message}${seen === undefined ? '' : ` (viu: ${JSON.stringify(seen)})`}`);
    pass(message);
  };
  await db.createDatabase(RESTORE_DATABASE);
  await db.applySchema({ database: RESTORE_DATABASE, baseOnly: true, quiet: true });
  const session = await db.openSession({ database: RESTORE_DATABASE, onNotice: () => undefined });
  const sql = session.client;
  const prepare = path.join(ROOT, PREPARE_FILE);
  const restoreCheck = path.join(ROOT, CHECK_FILE);
  // A falha (ou null) de um arquivo depois de `setup`, numa transação desfeita no fim.
  const failureAfter = async (file, setup) => {
    await sql.query('begin');
    try {
      await setup?.();
      return await failureOf(runSqlFile(sql, file));
    } finally {
      await sql.query('rollback');
    }
  };
  try {
    // (1) O projeto vazio.
    const fresh = await failureAfter(prepare);
    check(
      fresh === null && RESTORE_SEEDED_TABLES.length === 0,
      'restore: a freshly migrated database passes the empty-project check (no migration writes rows in a new project)',
      fresh?.message,
    );
    for (const [setup, fragment, message] of [
      [
        () => sql.query("insert into public.organizations(name) values('Empresa que já existia')"),
        'public.organizations',
        'restore: a row in a table of public refuses the restore, naming the table',
      ],
      [
        async () => {
          await sql.query('set local session_replication_role = replica');
          await sql.query(
            "insert into private.email_proofs(user_id,email) values(gen_random_uuid(),'prova@example.test')",
          );
        },
        'private.email_proofs',
        'restore: a row in a table of private refuses the restore, naming the table',
      ],
      [
        async () => {
          await sql.query('set local session_replication_role = replica');
          await sql.query("insert into auth.users(id,email) values(gen_random_uuid(),'conta@example.test')");
        },
        'auth.users',
        'restore: an account in auth.users refuses the restore (restore before the first access)',
      ],
    ]) {
      const failure = await failureAfter(prepare, setup);
      check(
        String(failure?.message).includes('Este projeto não está vazio') && String(failure?.message).includes(fragment),
        message,
        failure?.message ?? 'passou',
      );
    }
    const fromApi = await failureAfter(prepare, () =>
      sql.query("select set_config('request.jwt.claims', $1, true)", [claimsOf(RESTORE_USERS.owner)]),
    );
    check(
      String(fromApi?.message).includes('nunca pela API'),
      'restore: a session with request.jwt.claims (coming from the API) is refused',
      fromApi?.message ?? 'passou',
    );

    // (2) As conferências depois da carga.
    const coherent = await failureAfter(restoreCheck, async () => {
      const org = await provisionTeam(sql, {
        team: [
          { id: RESTORE_USERS.owner, email: 'dono-restauracao@example.test', role: 'owner' },
          { id: RESTORE_USERS.member, email: 'colaborador-restauracao@example.test', role: 'member' },
        ],
      });
      await sql.query("insert into public.contacts(org_id,first_name,company_id) values($1,'Sem empresa',null)", [org]);
    });
    check(
      coherent === null,
      'restore: the post-load check passes on a coherent instance (a composite key with a null column points to nothing, MATCH SIMPLE)',
      coherent?.message,
    );
    for (const [setup, fragment, message] of [
      [
        async () => {
          await sql.query('set local session_replication_role = replica');
          await sql.query(
            "insert into private.email_proofs(user_id,email) values(gen_random_uuid(),'orfa@example.test')",
          );
          await sql.query('set local session_replication_role = origin');
        },
        'linha(s) de private.email_proofs sem o registro de auth.users',
        'restore: an orphan row loaded with session_replication_role = replica fails the foreign key check',
      ],
      [
        () => sql.query('alter table public.contacts disable trigger zz_custom_validate'),
        'gatilho desligado: public.contacts.zz_custom_validate',
        'restore: a disabled trigger in public fails the check',
      ],
      [
        () => sql.query('alter table auth.users disable trigger enforce_invite_only_signup'),
        'gatilho desligado: auth.users.enforce_invite_only_signup',
        'restore: a disabled trigger of the CRM in auth.users fails the check',
      ],
      [
        () => sql.query('alter table public.payments disable row level security'),
        'tabela sem RLS: public.payments',
        'restore: a table of public without RLS fails the check',
      ],
    ]) {
      const failure = await failureAfter(restoreCheck, setup);
      check(
        String(failure?.message).includes('nada foi gravado') && String(failure?.message).includes(fragment),
        message,
        failure?.message ?? 'passou',
      );
    }
  } catch (error) {
    throw error instanceof RestoreCheckError
      ? error
      : new RestoreCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await session.close();
  }
}

// Revisão do item 1.5, rodada 1 (docs/arquitetura/1.5.md, seção 21): o ensaio de restauração inteiro, com o código do
// `npm run backup:restore`, sobre um dump do pg_dump simulado (scripts/lib/pg-dump-simulator.mjs), para a restauração
// rodar a cada push e em qualquer máquina: com --apply (conteúdo, senhas, RLS, gatilhos, estrutura e drift iguais aos da
// origem), sem --apply (o destino termina vazio) e as recusas (projeto com dados, migração faltando, sha256, comandos
// fora da lista, inclusive INSERT com subconsulta, ON CONFLICT e INSERT ... SELECT, e um dump parcial, que a
// conferência das chaves estrangeiras desfaz). O ensaio com o pg_dump real é o `npm run test:restore` (job restauracao).
async function restoreRehearsalChecks(db) {
  console.log('Executando o ensaio de restauração com o pg_dump simulado (o real roda no npm run test:restore)');
  setPassReporter(pass);
  try {
    await rehearse(db, simulatedPgDump, { simulated: true });
  } catch (error) {
    throw error instanceof RehearsalError || error instanceof RestoreError
      ? new RestoreCheckError(`ensaio com o pg_dump simulado: ${error.message}`)
      : error;
  } finally {
    setPassReporter(null);
  }
}

// Achado 1 da revisão do item 1.13: os exemplos SQL de docs/PROTECAO-ATUALIZACAO.md rodam de verdade, aplicados como uma
// migração _custom_ no banco recém-migrado da restauração, numa transação desfeita no fim. O Exemplo 1 recusa a
// oportunidade acima de R$ 10.000 sem empresa com a mensagem do guia e aceita trocar o responsável de uma antiga; o
// Exemplo 2 cria uma única tarefa "Primeiro contato com o cliente" para o responsável (sem laço); custom_contratos aceita
// a gravação de um colaborador, recusa a de um leitor e a de outra organização e só deixa donos e administradores
// excluírem.
async function customizationGuideChecks(db) {
  console.log(`Executando os exemplos SQL de ${GUIDE_FILE} como uma migração _custom_`);
  const check = (ok, message, seen) => {
    if (!ok) throw new GuideCheckError(`${message}${seen === undefined ? '' : ` (viu: ${JSON.stringify(seen)})`}`);
    pass(message);
  };
  const examples = customizationGuideExamples(readFileSync(path.join(ROOT, GUIDE_FILE), 'utf8'));
  const session = await db.openSession({ database: RESTORE_DATABASE, onNotice: () => undefined });
  const sql = session.client;
  const users = RESTORE_USERS;
  const one = async (query, params = []) => (await sql.query(query, params)).rows[0];
  // Um pedido da API dentro da transação: papel authenticated e as claims, desfeitos no fim.
  const asUser = async (userId, work) => {
    await sql.query('set local role authenticated');
    await sql.query("select set_config('request.jwt.claims', $1, true)", [claimsOf(userId)]);
    try {
      return await work();
    } finally {
      await sql.query('reset role');
      await sql.query("select set_config('request.jwt.claims', '', true)");
    }
  };
  // O erro de um comando (null se passou), num savepoint para a transação seguir.
  const errorOf = async (query, params = []) => {
    await sql.query('savepoint guide_example');
    try {
      await sql.query(query, params);
      await sql.query('release savepoint guide_example');
      return null;
    } catch (error) {
      await sql.query('rollback to savepoint guide_example');
      return String(error?.message ?? error);
    }
  };
  try {
    check(
      examples.length >= 3,
      `customization guide: the guide has the SQL examples that cite custom_ (${examples.length})`,
    );
    await sql.query('begin');
    await sql.query("insert into auth.users(id,email,email_confirmed_at) values($1,'fora-guia@example.test',now())", [
      users.outsider,
    ]);
    const org = await provisionTeam(sql, {
      team: [
        { id: users.owner, email: 'dono-guia@example.test', role: 'owner' },
        { id: users.admin, email: 'admin-guia@example.test', role: 'admin' },
        { id: users.member, email: 'colaborador-guia@example.test', role: 'member' },
        { id: users.viewer, email: 'leitor-guia@example.test', role: 'viewer' },
      ],
      company: 'Empresa do guia',
    });
    const { other } = await one("select private.provision_organization($1,'Outra empresa do guia') as other", [
      users.outsider,
    ]);
    for (const [index, example] of examples.entries()) {
      const failure = await errorOf(example);
      check(
        failure === null,
        `customization guide: SQL example ${index + 1} of the guide runs as a _custom_ migration`,
        failure,
      );
    }
    const { pipeline, stage } = await one(
      `select p.id as pipeline,s.id as stage from public.pipelines p join public.pipeline_stages s on s.pipeline_id=p.id
        where p.org_id=$1 and p.is_default order by s."order" limit 1`,
      [org],
    );
    const insertDeal = `insert into public.deals(org_id,pipeline_id,stage_id,title,value,owner_id) values($1,$2,$3,$4,$5,$6)
      returning id`;

    // Exemplo 1.
    const big = await asUser(users.member, () =>
      errorOf(insertDeal, [org, pipeline, stage, 'Guia: grande', 20000, users.member]),
    );
    check(
      String(big).includes('Oportunidades acima de R$ 10.000 precisam de uma empresa'),
      'customization guide: example 1 refuses a deal above R$ 10.000 without a company, with the message of the guide',
      big ?? 'gravou',
    );
    await sql.query('alter table public.deals disable trigger zz_custom_validate');
    const { id: oldDeal } = await one(insertDeal, [
      org,
      pipeline,
      stage,
      'Guia: anterior à regra',
      20000,
      users.member,
    ]);
    await sql.query('alter table public.deals enable trigger zz_custom_validate');
    const handOver = await asUser(users.member, () =>
      errorOf('update public.deals set owner_id=$2 where id=$1', [oldDeal, users.admin]),
    );
    const raise = await asUser(users.admin, () =>
      errorOf('update public.deals set value=30000 where id=$1', [oldDeal]),
    );
    check(
      handOver === null && String(raise).includes('precisam de uma empresa'),
      'customization guide: example 1 lets an old deal above the limit change owner, and refuses changing its value',
      { handOver, raise },
    );

    // Exemplo 2.
    const { id: newDeal } = await asUser(
      users.member,
      async () => (await sql.query(insertDeal, [org, pipeline, stage, 'Guia: pequena', 500, users.member])).rows[0],
    );
    const tasks = await one(
      `select count(*)::int as n,count(*) filter (where user_id=$2 and type='task' and completed_at is null)::int as mine
        from public.activities where deal_id=$1 and title='Primeiro contato com o cliente'`,
      [newDeal, users.member],
    );
    check(
      tasks.n === 1 && tasks.mine === 1,
      'customization guide: example 2 creates one "Primeiro contato com o cliente" task for the owner of a new deal, without a loop',
      tasks,
    );

    // A tabela custom_contratos.
    const insertContract = 'insert into public.custom_contratos(org_id,deal_id,numero) values($1,$2,$3)';
    const byMember = await asUser(users.member, () => errorOf(insertContract, [org, newDeal, 'C-001']));
    const byViewer = await asUser(users.viewer, () => errorOf(insertContract, [org, newDeal, 'C-002']));
    const otherOrg = await asUser(users.member, () => errorOf(insertContract, [other, newDeal, 'C-003']));
    check(
      byMember === null &&
        String(byViewer).includes('row-level security') &&
        String(otherOrg).includes('row-level security'),
      'customization guide: custom_contratos takes a collaborator write and refuses a viewer and another organization',
      { byMember, byViewer, otherOrg },
    );
    const deletedByMember = await asUser(
      users.member,
      async () => (await sql.query("delete from public.custom_contratos where numero='C-001'")).rowCount,
    );
    const deletedByAdmin = await asUser(
      users.admin,
      async () => (await sql.query("delete from public.custom_contratos where numero='C-001'")).rowCount,
    );
    check(
      deletedByMember === 0 && deletedByAdmin === 1,
      'customization guide: only owners and administrators delete from custom_contratos',
      { deletedByMember, deletedByAdmin },
    );
  } catch (error) {
    throw error instanceof GuideCheckError
      ? error
      : new GuideCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await sql.query('rollback').catch(() => undefined);
    await session.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Item 1.8 (docs/arquitetura/1.8.md, seções 6.5 e 16.2): os privilégios padrão revogados. (1) AC-10: dois bancos à parte,
// criados com outros privilégios padrão logo depois do bootstrap (o do banco principal reproduz os antigos do Supabase),
// terminam, depois de todas as migrações da base, com a impressão digital igual ao manifesto e a conferência de drift
// só com o resumo e a linha do histórico ausente: a migração 20261019120000_default_privileges.sql deixa iguais os
// projetos antigos, os novos do Supabase e um sem nenhum privilégio padrão. (2) AC-12: num banco parado antes dela, com
// private.base_fingerprints() alterada à mão, a migração para na guarda do 1.13, sem aplicar nada.
// ---------------------------------------------------------------------------------------------
const DEFAULT_PRIVILEGES_MIGRATION = '20261019120000_default_privileges.sql';
const DEFAULT_PRIVILEGE_VARIANTS = Object.freeze([
  {
    database: 'crm_padrao_novo',
    label: 'with the new Supabase default privileges (DML revoked in public)',
    sql: `alter default privileges in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
      alter default privileges in schema public revoke usage, select on sequences from anon, authenticated, service_role;
      alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;`,
  },
  {
    database: 'crm_sem_padrao',
    label: 'without default privileges for the API roles',
    sql: `alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
      alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
      alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;`,
  },
]);

async function defaultPrivilegeConvergenceChecks(db) {
  console.log('Executando a convergência dos privilégios padrão e a guarda da migração do item 1.8');
  const started = Date.now();
  const check = (ok, message, seen) => {
    if (!ok) throw new DriftCheckError(`${message}${seen === undefined ? '' : ` (viu: ${JSON.stringify(seen)})`}`);
    pass(message);
  };
  const manifest = JSON.parse(readFileSync(path.join(ROOT, MANIFEST_FILE), 'utf8'));
  const driftCheck = readFileSync(path.join(ROOT, DRIFT_CHECK_FILE), 'utf8');
  const keyOf = (object) => `${object.kind} ${object.object}`;
  const versioned = new Map(manifest.objects.map((object) => [keyOf(object), object.hash]));
  for (const variant of DEFAULT_PRIVILEGE_VARIANTS) {
    await db.createDatabase(variant.database);
    await db.applySchema({
      database: variant.database,
      baseOnly: true,
      quiet: true,
      afterBootstrap: (client) => client.query(variant.sql),
    });
    const session = await db.openSession({ database: variant.database, onNotice: () => undefined });
    try {
      const { rows } = await session.client.query('select * from private.base_fingerprints()');
      const version = (await session.client.query('show server_version_num')).rows[0].server_version_num;
      const fresh = buildManifest({
        rows,
        migrationFiles: readdirSync(path.join(ROOT, MIGRATIONS_DIR)),
        postgresMajor: Math.trunc(Number(version) / 10000),
        baseMigrations: readBaseMigrationNames(),
      });
      const freshKeys = new Set(fresh.objects.map(keyOf));
      const differing = fresh.objects.filter((object) => versioned.get(keyOf(object)) !== object.hash).map(keyOf);
      const missing = [...versioned.keys()].filter((entry) => !freshKeys.has(entry));
      check(
        !differing.length && !missing.length,
        `default privileges: a database created ${variant.label} ends with the fingerprint of the manifest`,
        { differing: differing.slice(0, 5), missing: missing.slice(0, 5) },
      );
      await session.client.query('begin read only');
      const drift = (await session.client.query(driftCheck)).rows;
      await session.client.query('rollback');
      check(
        drift.length === 2 &&
          drift[0].detalhe.includes('Alterados: 0. Ausentes: 0. Ganchos em uso: 0. Extras: 0.') &&
          drift[1].detalhe.includes('não tem supabase_migrations.schema_migrations'),
        `default privileges: on the database created ${variant.label} the drift check returns the summary and the missing-history note only`,
        drift.map((row) => `${row.situacao}/${row.tipo}/${row.objeto}`),
      );
    } finally {
      await session.close();
    }
  }

  // A guarda: o banco parado antes da migração, com base_fingerprints alterada à mão.
  await db.createDatabase('crm_guarda');
  await db.applySchema({
    database: 'crm_guarda',
    baseOnly: true,
    quiet: true,
    only: (name) => name < DEFAULT_PRIVILEGES_MIGRATION,
  });
  const session = await db.openSession({ database: 'crm_guarda', onNotice: () => undefined });
  try {
    const sql = session.client;
    const { definition } = (
      await sql.query("select pg_get_functiondef('private.base_fingerprints()'::regprocedure) as definition")
    ).rows[0];
    await sql.query(definition.replace('$function$', '$function$\n-- alterada à mão'));
    const failure = await failureOf(runSqlFile(sql, path.join(ROOT, MIGRATIONS_DIR, DEFAULT_PRIVILEGES_MIGRATION)));
    const { reopened } = (
      await sql.query(
        "select count(*)::int as reopened from pg_default_acl where defaclnamespace='public'::regnamespace and defaclacl::text like '%anon=%'",
      )
    ).rows[0];
    check(
      String(failure?.message).includes('esta função foi alterada nesta instância') &&
        String(failure?.message).includes('private.base_fingerprints()') &&
        reopened > 0,
      'default privileges: with private.base_fingerprints() changed by hand, the migration stops at the guard of item 1.13 and applies nothing',
      { failure: failure?.message ?? 'passou', reopened },
    );
  } finally {
    await session.close();
  }
  console.log(`  Convergência e guarda em ${Date.now() - started} ms`);
}

// Item 1.8 (docs/arquitetura/1.8.md, seção 5.4): o exemplo "Contratos" de docs/PERSONALIZAR. As duas migrações de
// docs/PERSONALIZAR/exemplos/supabase/migrations, aplicadas como migrações _custom_ no banco recém-migrado da restauração,
// numa transação desfeita no fim: o check do CNPJ e o índice único; o colaborador grava o CNPJ e o contrato da própria
// organização; o papel de leitura lê e não grava; só donos e administradores excluem; outra organização não lê e não liga
// um contrato a uma oportunidade alheia (FK composta); a conta desativada não lê; anon e a service_role (sem o grant
// comentado na migração) recebem 42501.
const PERSONALIZATION_DIR = 'docs/PERSONALIZAR/exemplos/supabase/migrations';
const PERSONALIZATION_DEACTIVATED = '00000000-0000-0000-0000-000000000506';

async function personalizationExampleChecks(db) {
  console.log(`Executando o exemplo de docs/PERSONALIZAR (${PERSONALIZATION_DIR}) como migrações _custom_`);
  const check = (ok, message, seen) => {
    if (!ok) throw new GuideCheckError(`${message}${seen === undefined ? '' : ` (viu: ${JSON.stringify(seen)})`}`);
    pass(message);
  };
  const migrations = readdirSync(path.join(ROOT, PERSONALIZATION_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const session = await db.openSession({ database: RESTORE_DATABASE, onNotice: () => undefined });
  const sql = session.client;
  const users = RESTORE_USERS;
  const one = async (query, params = []) => (await sql.query(query, params)).rows[0];
  // Um pedido da API dentro da transação: o papel e, com conta, as claims, desfeitos no fim.
  const asRole = async (role, userId, work) => {
    await sql.query(`set local role ${role}`);
    if (userId) await sql.query("select set_config('request.jwt.claims', $1, true)", [claimsOf(userId)]);
    try {
      return await work();
    } finally {
      await sql.query('reset role');
      await sql.query("select set_config('request.jwt.claims', '', true)");
    }
  };
  const asUser = (userId, work) => asRole('authenticated', userId, work);
  // O erro de um comando ({ code, message }, ou null se passou), num savepoint para a transação seguir.
  const errorOf = async (query, params = []) => {
    await sql.query('savepoint personalization_example');
    try {
      await sql.query(query, params);
      await sql.query('release savepoint personalization_example');
      return null;
    } catch (error) {
      await sql.query('rollback to savepoint personalization_example');
      return { code: error?.code, message: String(error?.message ?? error) };
    }
  };
  const count = async (query, params = []) => Number((await one(query, params)).n);
  try {
    check(
      migrations.length === 2 && migrations.every((name) => /^\d{14}_custom_/.test(name)),
      'personalization example: the two migrations of the example are named <date and time>_custom_<name>.sql',
      migrations,
    );
    await sql.query('begin');
    await sql.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'fora-exemplo@example.test',now()),($2,'desativada-exemplo@example.test',now())",
      [users.outsider, PERSONALIZATION_DEACTIVATED],
    );
    const org = await provisionTeam(sql, {
      team: [
        { id: users.owner, email: 'dono-exemplo@example.test', role: 'owner' },
        { id: users.admin, email: 'admin-exemplo@example.test', role: 'admin' },
        { id: users.member, email: 'colaborador-exemplo@example.test', role: 'member' },
        { id: users.viewer, email: 'leitor-exemplo@example.test', role: 'viewer' },
      ],
      company: 'Empresa do exemplo',
    });
    await sql.query('update public.profiles set org_id=$2 where id=$1', [PERSONALIZATION_DEACTIVATED, org]);
    await sql.query("insert into public.user_roles(user_id,org_id,role,deactivated_at) values($1,$2,'member',now())", [
      PERSONALIZATION_DEACTIVATED,
      org,
    ]);
    const { other } = await one("select private.provision_organization($1,'Outra empresa do exemplo') as other", [
      users.outsider,
    ]);
    for (const migration of migrations) {
      const failure = await failureOf(runSqlFile(sql, path.join(ROOT, PERSONALIZATION_DIR, migration)));
      check(
        failure === null,
        `personalization example: ${migration} runs on a freshly migrated database`,
        failure?.message,
      );
    }
    const { pipeline, stage } = await one(
      `select p.id as pipeline,s.id as stage from public.pipelines p join public.pipeline_stages s on s.pipeline_id=p.id
        where p.org_id=$1 and p.is_default order by s."order" limit 1`,
      [org],
    );
    const { id: deal } = await one(
      `insert into public.deals(org_id,pipeline_id,stage_id,title,value,owner_id) values($1,$2,$3,'Exemplo: implantação',5000,$4)
        returning id`,
      [org, pipeline, stage, users.member],
    );
    const { id: company } = await one(
      "insert into public.companies(org_id,name) values($1,'Cliente do exemplo') returning id",
      [org],
    );
    const { id: secondCompany } = await one(
      "insert into public.companies(org_id,name) values($1,'Outro cliente do exemplo') returning id",
      [org],
    );

    // CAMPO: companies.custom_cnpj.
    const setCnpj = 'update public.companies set custom_cnpj=$2 where id=$1';
    const valid = await asUser(users.member, () => errorOf(setCnpj, [company, '12345678000190']));
    const formatted = await asUser(users.member, () => errorOf(setCnpj, [secondCompany, '12.345.678/0001-90']));
    const repeated = await asUser(users.member, () => errorOf(setCnpj, [secondCompany, '12345678000190']));
    const byViewer = await asUser(
      users.viewer,
      async () => (await sql.query(setCnpj, [secondCompany, '98765432000110'])).rowCount,
    );
    check(
      valid === null &&
        formatted?.code === '23514' &&
        formatted.message.includes('custom_companies_cnpj_digits') &&
        repeated?.code === '23505' &&
        byViewer === 0,
      'personalization example: a collaborator saves the 14 digits of the CNPJ, the check refuses another format, the unique index a repeated one, and a viewer changes nothing',
      { valid, formatted, repeated, byViewer },
    );

    // ENTIDADE: public.custom_contratos.
    const insertContract = 'insert into public.custom_contratos(org_id,deal_id,numero,assinado_em) values($1,$2,$3,$4)';
    const byMember = await asUser(users.member, () => errorOf(insertContract, [org, deal, 'C-001', '2026-11-01']));
    const viewerWrite = await asUser(users.viewer, () => errorOf(insertContract, [org, deal, 'C-002', null]));
    const viewerRead = await asUser(users.viewer, () => count('select count(*) as n from public.custom_contratos'));
    check(
      byMember === null && viewerWrite?.code === '42501' && viewerRead === 1,
      'personalization example: a collaborator records a contract of the own organization, and a viewer reads it and cannot write',
      { byMember, viewerWrite, viewerRead },
    );
    const outsiderRead = await asUser(users.outsider, () => count('select count(*) as n from public.custom_contratos'));
    const foreignDeal = await asUser(users.outsider, () => errorOf(insertContract, [other, deal, 'C-003', null]));
    const foreignOrg = await asUser(users.outsider, () => errorOf(insertContract, [org, deal, 'C-004', null]));
    check(
      outsiderRead === 0 &&
        foreignDeal?.code === '23503' &&
        foreignDeal.message.includes('custom_contratos_deal_id_org_id_fkey') &&
        foreignOrg?.code === '42501',
      'personalization example: another organization reads nothing, cannot link a contract to a deal of this one (composite FK) nor write in it (RLS)',
      { outsiderRead, foreignDeal, foreignOrg },
    );
    const deactivatedRead = await asUser(PERSONALIZATION_DEACTIVATED, () =>
      count('select count(*) as n from public.custom_contratos'),
    );
    const anonRead = await asRole('anon', null, () => errorOf('select * from public.custom_contratos'));
    const serviceRead = await asRole('service_role', null, () => errorOf('select * from public.custom_contratos'));
    check(
      deactivatedRead === 0 && anonRead?.code === '42501' && serviceRead?.code === '42501',
      'personalization example: a deactivated account reads nothing, and anon and the service_role (without the commented grant) get 42501',
      { deactivatedRead, anonRead, serviceRead },
    );
    const deletedByMember = await asUser(
      users.member,
      async () => (await sql.query("delete from public.custom_contratos where numero='C-001'")).rowCount,
    );
    const deletedByAdmin = await asUser(
      users.admin,
      async () => (await sql.query("delete from public.custom_contratos where numero='C-001'")).rowCount,
    );
    const touch = await count(
      "select count(*) as n from pg_trigger where tgrelid='public.custom_contratos'::regclass and tgname='custom_contratos_touch'",
    );
    check(
      deletedByMember === 0 && deletedByAdmin === 1 && touch === 1,
      'personalization example: only owners and administrators delete contracts, and updated_at has its trigger',
      { deletedByMember, deletedByAdmin, touch },
    );
  } catch (error) {
    throw error instanceof GuideCheckError
      ? error
      : new GuideCheckError(`erro do PostgreSQL: ${error?.message ?? error}`);
  } finally {
    await sql.query('rollback').catch(() => undefined);
    await session.close();
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
    await completeActivityRace(db, admin);
    await anonymizationRace(db, admin);
    await dealItemParity(db, admin);
    await dealItemsRace(db, admin);
    await demoSeedChecks(db, admin);
    await deactivationSeenFromOtherSessions(db, admin);
    await anonymizationVolume(db, admin);
  } finally {
    await admin.close();
  }
}

// No repositório da base (CRM_BASE_REPOSITORY=true), uma migração _custom_ é recusada antes de subir o banco (achado 3 da
// revisão do item 1.13): ela ficaria fora do test:db, do manifesto e da guarda.
refuseCustomMigrationsInBase(readdirSync(path.join(ROOT, MIGRATIONS_DIR)));

await runWithEmbeddedDb({
  tempPrefix: TEMP_PREFIXES.testDb,
  applicationName: 'crm-test-db',
  async run(db) {
    await db.applySchema({
      baseOnly: true,
      async beforeMigration(migration) {
        const seed = path.join(ROOT, UPGRADE_DIR, migration);
        if (!existsSync(seed)) return;
        console.log(`  ${UPGRADE_DIR}/${migration} (dados no formato anterior)`);
        await db.runInFreshSession(seed);
      },
    });
    countingChecks = true;
    await driftCheckChecks(db);
    await restoreSupportChecks(db);
    await restoreRehearsalChecks(db);
    await customizationGuideChecks(db);
    await personalizationExampleChecks(db);
    await defaultPrivilegeConvergenceChecks(db);
    console.log(`Executando ${TEST_FILE}`);
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
    error instanceof RaceCheckError ||
    error instanceof ConfirmationCheckError ||
    error instanceof PrivilegeCheckError ||
    error instanceof DeactivationCheckError ||
    error instanceof CompletionCheckError ||
    error instanceof AnonymizationCheckError ||
    error instanceof DealItemCheckError ||
    error instanceof DemoSeedCheckError ||
    error instanceof DriftCheckError ||
    error instanceof RestoreCheckError ||
    error instanceof GuideCheckError
      ? [
          `${
            error instanceof RaceCheckError
              ? 'Falha na corrida entre dois primeiros cadastros'
              : error instanceof PrivilegeCheckError
                ? 'Falha no gatilho da prova sem o privilégio TRIGGER'
                : error instanceof DeactivationCheckError
                  ? 'Falha na desativação vista de outra sessão'
                  : error instanceof CompletionCheckError
                    ? 'Falha na conclusão da mesma atividade por duas sessões'
                    : error instanceof AnonymizationCheckError
                      ? 'Falha na anonimização vista de outras sessões'
                      : error instanceof DealItemCheckError
                        ? 'Falha na conta ou na gravação disputada dos itens da oportunidade'
                        : error instanceof DemoSeedCheckError
                          ? 'Falha no seed de demonstração'
                          : error instanceof DriftCheckError
                            ? 'Falha no manifesto da base ou no check de drift'
                            : error instanceof RestoreCheckError
                              ? 'Falha nos SQL de apoio ou no ensaio da restauração do backup'
                              : error instanceof GuideCheckError
                                ? 'Falha nos exemplos SQL do guia de personalização'
                                : 'Falha na confirmação do e-mail vista de outra sessão'
          }: ${error.message}`,
          `  Verificações aprovadas antes da falha: ${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`,
        ]
      : undefined,
  successMessage: () => `\n${passCount} verificações PostgreSQL passaram. Cluster temporário removido.`,
});
