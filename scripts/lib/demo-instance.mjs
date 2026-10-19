// Auxiliares do cluster descartável para montar uma instância com equipe (o test:db e o ensaio de restauração do item
// 1.5, `npm run test:restore`): as claims que o PostgREST manda, a transação "como um pedido da API" e a empresa com o
// Dono e a equipe, cadastrados como o portão do item 1.1 exige (as contas antes da empresa). Nunca aponte para um banco
// remoto.
import { randomUUID } from 'node:crypto';

// As claims que o PostgREST manda numa sessão aberta com senha (sub, role, session_id e amr).
export const claimsOf = (userId) =>
  JSON.stringify({
    sub: userId,
    role: 'authenticated',
    session_id: randomUUID(),
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  });

// Abre uma transação como um pedido do PostgREST: papel authenticated e as claims do token, só nesta transação.
export async function beginAs(session, claims) {
  await session.client.query('begin');
  await session.client.query('set local role authenticated');
  await session.client.query("select set_config('request.jwt.claims', $1, true)", [claims]);
}

// O erro de uma promessa, ou `null` se ela deu certo.
export const failureOf = (promise) =>
  promise.then(
    () => null,
    (error) => error,
  );

/**
 * A empresa de uma instância vazia, como o editor SQL (papel postgres): as contas em auth.users antes da empresa (o
 * cadastro sem convite só passa enquanto não há empresa), a empresa e o Dono por private.provision_organization e os
 * outros papéis da equipe. `team` é uma lista de `{ id, email, role, name?, password?, deactivated? }`, com o Dono
 * primeiro (`role: 'owner'`). Devolve o id da empresa.
 */
export async function provisionTeam(client, { team, company = 'Empresa de ensaio' }) {
  const [owner] = team;
  if (owner?.role !== 'owner') throw new Error('provisionTeam: o primeiro da equipe precisa ser o Dono');
  for (const person of team)
    await client.query(
      'insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,$2,now(),$3)',
      [person.id, person.email, person.password ?? null],
    );
  const { org } = (await client.query('select private.provision_organization($1,$2) as org', [owner.id, company]))
    .rows[0];
  for (const person of team) {
    if (person.name) await client.query('update public.profiles set name=$2 where id=$1', [person.id, person.name]);
    if (person === owner) continue;
    await client.query('update public.profiles set org_id=$2 where id=$1', [person.id, org]);
    await client.query('insert into public.user_roles(user_id,org_id,role) values($1,$2,$3)', [
      person.id,
      org,
      person.role,
    ]);
    if (person.deactivated)
      await client.query('update public.user_roles set deactivated_at=now() where user_id=$1', [person.id]);
  }
  return org;
}
