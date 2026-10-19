#!/usr/bin/env node
// Aplica a cadeia completa de migrações e roda as verificações de RLS num PostgreSQL 17 descartável.
// Funciona em Windows, macOS e Linux sem PostgreSQL instalado: o cluster temporário (porta livre em
// 127.0.0.1, diretório apagado ao final, inclusive em falha ou Ctrl+C) vem de `scripts/lib/embedded-db.mjs`.
// Nunca aponte estes arquivos para um banco remoto.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEMO_SCHEMA,
  DEMO_TIME_ZONE,
  REMOVE_FILE,
  SEED_FILE,
  buildDemoSeedFiles,
  demoExpectedCounts,
} from './lib/demo-seed.mjs';
import { ROOT, SqlFileError, TEMP_PREFIXES, runSqlFile, runWithEmbeddedDb } from './lib/embedded-db.mjs';

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

// As claims que o PostgREST manda numa sessão aberta com senha (sub, role, session_id e amr).
const claimsOf = (userId) =>
  JSON.stringify({
    sub: userId,
    role: 'authenticated',
    session_id: randomUUID(),
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  });

// Abre uma transação como um pedido do PostgREST: papel authenticated e as claims do token, só nesta transação.
async function beginAs(session, claims) {
  await session.client.query('begin');
  await session.client.query('set local role authenticated');
  await session.client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
}

const pidOf = async (session) => (await session.client.query('select pg_backend_pid() as pid')).rows[0].pid;
const failureOf = (promise) =>
  promise.then(
    () => null,
    (error) => error,
  );

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
    error instanceof RaceCheckError ||
    error instanceof ConfirmationCheckError ||
    error instanceof PrivilegeCheckError ||
    error instanceof DeactivationCheckError ||
    error instanceof CompletionCheckError ||
    error instanceof AnonymizationCheckError ||
    error instanceof DealItemCheckError ||
    error instanceof DemoSeedCheckError
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
                          : 'Falha na confirmação do e-mail vista de outra sessão'
          }: ${error.message}`,
          `  Verificações aprovadas antes da falha: ${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`,
        ]
      : undefined,
  successMessage: () => `\n${passCount} verificações PostgreSQL passaram. Cluster temporário removido.`,
});
