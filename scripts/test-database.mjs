#!/usr/bin/env node
// Aplica a cadeia completa de migrações e roda as verificações de RLS num PostgreSQL 17 descartável.
// Funciona em Windows, macOS e Linux sem PostgreSQL instalado: o cluster temporário (porta livre em
// 127.0.0.1, diretório apagado ao final, inclusive em falha ou Ctrl+C) vem de `scripts/lib/embedded-db.mjs`.
// Nunca aponte estes arquivos para um banco remoto.
import { randomUUID } from 'node:crypto';
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

let passCount = 0;
let lastPass = null;
let countingChecks = false;

class RaceCheckError extends Error {}
class ConfirmationCheckError extends Error {}
class PrivilegeCheckError extends Error {}
class DeactivationCheckError extends Error {}
class CompletionCheckError extends Error {}

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
    await deactivationSeenFromOtherSessions(db, admin);
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
    error instanceof CompletionCheckError
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
                    : 'Falha na confirmação do e-mail vista de outra sessão'
          }: ${error.message}`,
          `  Verificações aprovadas antes da falha: ${passCount}${lastPass ? ` (última: ${lastPass})` : ''}`,
        ]
      : undefined,
  successMessage: () => `\n${passCount} verificações PostgreSQL passaram. Cluster temporário removido.`,
});
