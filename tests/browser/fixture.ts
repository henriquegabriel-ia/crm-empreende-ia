import type { Page, Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { generateVolumeData, type VOLUME_COUNTS } from '../../scripts/lib/volume-data.mjs';

export const IDS = {
  org: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  otherOrg: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  owner: '11111111-1111-4111-8111-111111111111',
  viewer: '22222222-2222-4222-8222-222222222222',
  contact: '33333333-3333-4333-8333-333333333333',
  otherContact: '33333333-3333-4333-8333-333333333334',
  company: '44444444-4444-4444-8444-444444444444',
  pipeline: '55555555-5555-4555-8555-555555555555',
  stage: '66666666-6666-4666-8666-666666666666',
  stage2: '66666666-6666-4666-8666-666666666667',
  deal: '77777777-7777-4777-8777-777777777777',
  activity: '88888888-8888-4888-8888-888888888888',
  meeting: '88888888-8888-4888-8888-888888888889',
  // Equipe do item 1.2 (withTeam): o colaborador que sai, a colaboradora que recebe a carteira e a administradora.
  leaving: '99999999-9999-4999-8999-999999999991',
  recipient: '99999999-9999-4999-8999-999999999992',
  admin: '99999999-9999-4999-8999-999999999993',
} as const;
export type FixtureRow = Record<string, unknown> & { id: string };
/** Resposta do Auth (status e corpo no formato do Supabase Auth), fixa ou calculada a partir do corpo do pedido. */
export type AuthReply = { status: number; body: unknown } | ((body: unknown) => { status: number; body: unknown });
/**
 * Rotas do Auth que um teste pode trocar: cadastro, link por e-mail, login com senha, recuperação de senha, a conta
 * (GET e a troca de senha por PUT), a saída (POST /logout?scope=…) e a conferência do link ou do código do e-mail
 * (POST /verify, com token_hash ou com e-mail e código).
 */
export type AuthRoute = 'signup' | 'otp' | 'token' | 'recover' | 'user' | 'logout' | 'verify';
export interface FixtureState {
  tables: Record<string, FixtureRow[]>;
  requests: { method: string; table: string; params: string; body: unknown }[];
  /** Pedidos ao Auth (/auth/v1/<rota>), separados dos pedidos ao banco. */
  authRequests: { method: string; route: string; params: string; body: unknown }[];
  /** Respostas trocadas do Auth; sem a rota, a fixture responde com a sessão (ou o usuário, em /user). */
  authReplies: Map<AuthRoute, AuthReply>;
  /** O que public.instance_status devolve (item 1.1). Padrão: a instância já tem empresa. */
  instance: { hasOrganization: boolean };
  /**
   * A conta da sessão tem a prova do e-mail gravada na confirmação por link (reforço do item 1.1). Padrão: verdadeiro.
   * Sem ela, create_workspace e accept_invitation só passam numa sessão aberta pelo link (amr otp no token).
   */
  emailProof: boolean;
  failReads: Set<string>;
  failWrites: Set<string>;
  /** Tabelas (ou a RPC move_deal) cuja próxima gravação é feita, mas sem a resposta chegar ao navegador. */
  loseNextWriteResponse: Set<string>;
  userId: string;
  /** Token da sessão da fixture, preenchido por installCrmFixture: serve para voltar de um link do Auth com sessão. */
  accessToken?: string;
  /**
   * Token da mesma conta aberto por um link enviado ao e-mail (amr otp), para voltar de um link de cadastro, de
   * confirmação ou de acesso com a sessão que ele abre, qualquer que seja o método da sessão inicial.
   */
  linkAccessToken?: string;
  /** Segura a resposta da tabela ou RPC até a promessa resolver (ex.: ver a atualização otimista do kanban). */
  holds?: Map<string, Promise<unknown>>;
  /**
   * Guarda o resultado filtrado e ordenado de cada leitura, para as páginas seguintes só fatiarem. Só para a medição
   * de desempenho com volume, em que nada é gravado: com escritas, a leitura seguinte veria dados antigos.
   */
  memoizeReads?: boolean;
  /** Encerra o servidor HTTP da fixture, quando ela é servida por `httpPort`. */
  stopServer?: () => Promise<void>;
  /**
   * Item 1.2: oportunidade que um colega atribui à pessoa logo antes da próxima desativação dela, como numa corrida.
   * Sem destinatário, a desativação recusa com as contagens novas, como deactivate_member.
   */
  assignBeforeNextDeactivation?: FixtureRow;
  /** Pedidos às RPCs da Equipe (item 1.2), com o corpo, para os testes conferirem o que a tela mandou. */
  teamCalls?: { rpc: string; body: Record<string, unknown> }[];
}
const dayAt = (offset: number, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
/**
 * Mesmas regras do gatilho private.validate_deal_change (item 0.6 do roteiro): ganha = 100, perdida = 0,
 * reabrir = NULL (herda a etapa); closed_at preenchido ao encerrar quando não informado, mantido nos
 * movimentos de etapa e anulado ao reabrir.
 */
function applyDealRules(deal: FixtureRow, previous?: FixtureRow) {
  const now = new Date().toISOString();
  if (deal.status === 'won') deal.probability = 100;
  else if (deal.status === 'lost') deal.probability = 0;
  else if (previous && previous.status !== 'open') deal.probability = null;
  if (deal.status !== 'lost') deal.lost_reason = null;
  if (deal.status === 'open') deal.closed_at = null;
  else if (!previous) deal.closed_at = deal.closed_at ?? now;
  else if (previous.status !== deal.status)
    deal.closed_at = deal.closed_at && deal.closed_at !== previous.closed_at ? deal.closed_at : now;
}
export type FixtureRole = 'owner' | 'admin' | 'viewer' | 'member';
export function createFixture(role: FixtureRole = 'owner'): FixtureState {
  const now = new Date().toISOString(),
    old = dayAt(-10),
    userId = role !== 'viewer' ? IDS.owner : IDS.viewer;
  const base = { org_id: IDS.org, created_at: old, updated_at: old };
  return {
    userId,
    requests: [],
    authRequests: [],
    authReplies: new Map(),
    instance: { hasOrganization: true },
    emailProof: true,
    failReads: new Set(),
    failWrites: new Set(),
    loseNextWriteResponse: new Set(),
    tables: {
      organizations: [
        {
          id: IDS.org,
          name: 'Organização de Teste A',
          industry: 'other',
          metadata: {},
          created_at: old,
          updated_at: old,
        },
        { id: IDS.otherOrg, name: 'Organização de Teste B', created_at: old, updated_at: old },
      ],
      profiles: [
        { id: IDS.owner, ...base, name: 'Pessoa de Teste', email: 'owner@example.test', avatar_url: null },
        { id: IDS.viewer, ...base, name: 'Leitor de Teste', email: 'viewer@example.test', avatar_url: null },
      ],
      user_roles: [
        {
          id: randomUUID(),
          org_id: IDS.org,
          user_id: IDS.owner,
          role: role === 'member' || role === 'admin' ? role : 'owner',
        },
        { id: randomUUID(), org_id: IDS.org, user_id: IDS.viewer, role: 'viewer' },
      ].map((row) => ({ ...row, deactivated_at: null })),
      // Passagens de carteira (item 1.2): só donos e administradores leem; só as RPCs gravam.
      portfolio_transfers: [],
      contacts: [
        {
          id: IDS.contact,
          ...base,
          first_name: 'Contato',
          last_name: 'Alfa',
          email: 'alfa@example.test',
          phone: '11900000000',
          company_id: IDS.company,
          owner_id: IDS.owner,
          status: 'lead',
          job_title: null,
          source: null,
          notes: null,
        },
        {
          id: IDS.otherContact,
          org_id: IDS.otherOrg,
          first_name: 'Contato',
          last_name: 'de outra organização',
          email: 'outra@example.test',
          created_at: old,
          updated_at: old,
          status: 'lead',
          owner_id: null,
        },
      ],
      companies: [
        {
          id: IDS.company,
          ...base,
          name: 'Empresa Exemplo',
          domain: 'example.test',
          industry: 'Serviços',
          size: null,
          revenue: null,
          website: 'https://example.test',
          linkedin_url: null,
          owner_id: IDS.owner,
          phone: '1130000000',
        },
      ],
      // Funis e etapas têm updated_at desde 20261011120000_configuration_updated_at.sql (item 0.8). Como no banco,
      // todo PATCH renova updated_at, e o filtro updated_at=eq.<versão lida> devolve zero linhas para uma versão antiga.
      pipelines: [{ id: IDS.pipeline, ...base, name: 'Comercial', currency: 'BRL', is_default: true }],
      pipeline_stages: [
        {
          id: IDS.stage,
          ...base,
          pipeline_id: IDS.pipeline,
          name: 'Entrada',
          order: 0,
          win_probability: 10,
          color: null,
        },
        {
          id: IDS.stage2,
          ...base,
          pipeline_id: IDS.pipeline,
          name: 'Proposta',
          order: 1,
          win_probability: 50,
          color: null,
        },
      ],
      deals: [
        {
          id: IDS.deal,
          ...base,
          pipeline_id: IDS.pipeline,
          stage_id: IDS.stage,
          title: 'Projeto Exemplo',
          value: 2400,
          currency: 'BRL',
          contact_id: IDS.contact,
          company_id: IDS.company,
          owner_id: IDS.owner,
          close_date: null,
          // NULL = herda a probabilidade da etapa (10% em "Entrada").
          probability: null,
          status: 'open',
          lost_reason: null,
          closed_at: null,
          stage_entered_at: old,
        },
      ],
      activities: [
        {
          id: IDS.activity,
          ...base,
          title: 'Retorno de teste',
          type: 'task',
          body: 'Contexto fictício para validação.',
          due_date: dayAt(-1),
          end_date: null,
          completed_at: null,
          contact_id: IDS.contact,
          company_id: IDS.company,
          deal_id: IDS.deal,
          user_id: IDS.owner,
          created_by: IDS.owner,
        },
        {
          id: IDS.meeting,
          ...base,
          title: 'Reunião de teste',
          type: 'meeting',
          body: null,
          due_date: dayAt(0, 14),
          end_date: dayAt(0, 15),
          completed_at: null,
          contact_id: IDS.contact,
          company_id: IDS.company,
          deal_id: IDS.deal,
          user_id: IDS.owner,
          created_by: IDS.owner,
        },
      ],
      risk_rules: ['overdue', 'no_owner', 'no_next_action', 'stale_deal'].map((type, i) => ({
        id: randomUUID(),
        org_id: IDS.org,
        type,
        name: ['Atividades vencidas', 'Sem responsável', 'Sem próxima ação', 'Oportunidades paradas'][i],
        enabled: true,
        threshold_days: 7,
        priority: i === 0 ? 1 : 2,
        // Desde 20261011120000_configuration_updated_at.sql (item 0.8): versão usada pela guarda de concorrência.
        updated_at: old,
      })),
      deal_stage_history: [
        {
          id: randomUUID(),
          org_id: IDS.org,
          deal_id: IDS.deal,
          from_stage_id: null,
          to_stage_id: IDS.stage,
          from_status: null,
          to_status: 'open',
          changed_by: IDS.owner,
          created_at: old,
        },
      ],
      payments: [
        {
          id: randomUUID(),
          ...base,
          deal_id: IDS.deal,
          contact_id: IDS.contact,
          description: 'Recebimento de teste',
          amount: 1200,
          currency: 'BRL',
          due_date: now.slice(0, 10),
          paid_at: null,
          status: 'pending',
          payment_method: null,
          notes: null,
        },
      ],
      automations: [
        {
          id: randomUUID(),
          ...base,
          name: 'Retorno após criação',
          trigger_type: 'deal_created',
          is_active: false,
          task_title: 'Retornar ao contato',
          due_days: 2,
          pipeline_id: null,
          stage_id: null,
          created_by: IDS.owner,
        },
      ],
      // Colunas de 20261011110000_deletions_automation_scope.sql: automation_name (snapshot) e error_detail,
      // que só administradores leem, pela RPC automation_log_errors.
      automation_logs: [],
      audit_logs: [],
      integration_configs: ['csv', 'calendar'].map((provider) => ({
        id: randomUUID(),
        org_id: IDS.org,
        provider,
        enabled: true,
        last_checked_at: now,
        created_at: old,
        updated_at: old,
      })),
      email_templates: [
        { id: randomUUID(), ...base, name: 'Modelo de exemplo', subject: 'Assunto de teste', body: 'Texto de teste.' },
      ],
      invitations: [],
    },
  };
}
function filters(row: FixtureRow, params: URLSearchParams) {
  for (const [key, expression] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const value = row[key];
    if (expression.startsWith('eq.') && String(value) !== expression.slice(3)) return false;
    if (expression === 'is.null' && value != null) return false;
    if (expression === 'not.is.null' && value == null) return false;
    if (expression.startsWith('neq.') && String(value) === expression.slice(4)) return false;
    if (
      expression.startsWith('in.(') &&
      !expression
        .slice(4, -1)
        .split(',')
        .map((v) => v.replace(/^"|"$/g, ''))
        .includes(String(value))
    )
      return false;
    if (expression.startsWith('gte.') && String(value) < expression.slice(4)) return false;
    if (expression.startsWith('lte.') && String(value) > expression.slice(4)) return false;
  }
  return true;
}
export async function installCrmFixture(
  page: Page,
  options: {
    role?: FixtureRole;
    theme?: 'light' | 'dark';
    state?: FixtureState;
    /** false começa sem sessão: o login pela tela recebe a sessão da fixture (rota /auth/v1/token). */
    signedIn?: boolean;
    /** O que instance_status devolve (item 1.1); sem a opção, a instância já tem empresa. */
    instance?: { hasOrganization: boolean };
    /** A conta da sessão ainda sem organização: perfil sem org_id e sem papel, como depois de um cadastro. */
    withoutOrganization?: boolean;
    /**
     * Como a sessão inicial foi aberta (o amr do token): 'password' (padrão) ou 'otp', o link enviado ao e-mail. Só na
     * sessão aberta pelo link a tela pede "Crie sua senha" (reforço do item 1.1).
     */
    authMethod?: 'password' | 'otp';
    /** A conta tem a prova do e-mail (padrão: verdadeiro); sem ela, o aceite e a criação da empresa pedem o link. */
    emailProof?: boolean;
    /** E-mail da conta da sessão e do perfil dela (padrão: owner@example.test, ou viewer@example.test no papel Leitor). */
    email?: string;
    /**
     * Sem a opção, as requisições ao backend (127.0.0.1:54329) são interceptadas no navegador (page.route). Com uma
     * porta, a mesma fixture é servida por um servidor HTTP local nela, como um backend de verdade e sem o custo da
     * interceptação; o build precisa apontar VITE_SUPABASE_URL para essa porta. Usado pela medição de desempenho.
     * Encerre com `state.stopServer()`.
     */
    httpPort?: number;
  } = {},
) {
  const state = options.state ?? createFixture(options.role);
  const role = options.role ?? 'owner';
  if (options.instance) state.instance = { ...options.instance };
  if (options.emailProof !== undefined) state.emailProof = options.emailProof;
  if (options.withoutOrganization) {
    const profile = state.tables.profiles.find((row) => row.id === state.userId);
    if (profile) profile.org_id = null;
    state.tables.user_roles = state.tables.user_roles.filter((row) => row.user_id !== state.userId);
  }
  if (options.email) {
    const profile = state.tables.profiles.find((row) => row.id === state.userId);
    if (profile) profile.email = options.email;
  }
  const user = {
    id: state.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: options.email ?? (role !== 'viewer' ? 'owner@example.test' : 'viewer@example.test'),
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: dayAt(-30),
    identities: [],
  };
  // Mesmas regras de supabase/migrations/20261012100000_single_company_admission.sql (item 1.1) e de
  // 20261012110000_admission_email_proof.sql (reforço: a prova do e-mail vem por último), com as mensagens do banco
  // (P0001), sobre as tabelas da fixture. `linkSession` diz se o token do pedido foi aberto pelo link do e-mail.
  const refuse = (message: string, details: string | null = null) => ({
    status: 400,
    body: { code: 'P0001', message, details, hint: null },
  });
  const profileOf = (id: string) => state.tables.profiles.find((row) => row.id === id);
  const roleRowOf = (id: string) => state.tables.user_roles.find((row) => row.user_id === id);
  // Papel ativo (item 1.2): o desativado conta como sem papel, como em private.current_org().
  const activeRoleOf = (id: string) => {
    const row = roleRowOf(id);
    return row && !row.deactivated_at ? (row.role as string) : undefined;
  };
  const deactivatedSession = () => Boolean(roleRowOf(state.userId)?.deactivated_at);
  const proven = (linkSession: boolean) => state.emailProof || linkSession;
  const admission: Record<
    string,
    (args: Record<string, unknown>, linkSession: boolean) => { status: number; body: unknown }
  > = {
    create_workspace(args, linkSession) {
      const profile = profileOf(state.userId)!;
      if (profile.org_id) return refuse('Sua conta já pertence a uma organização.');
      if (state.instance.hasOrganization)
        return refuse('Este CRM já tem uma empresa. Para entrar, peça um convite a quem administra.');
      if (!proven(linkSession))
        return refuse('Para criar a empresa, confirme que o e-mail é seu: entre pelo link enviado a ele.');
      const name = String(args.p_name ?? '').trim();
      if (name.length < 2 || name.length > 160) return refuse('Use um nome de empresa com 2 a 160 caracteres.');
      profile.org_id = IDS.org;
      state.tables.user_roles.push({ id: randomUUID(), org_id: IDS.org, user_id: state.userId, role: 'owner' });
      state.instance.hasOrganization = true;
      return { status: 200, body: IDS.org };
    },
    accept_invitation(args, linkSession) {
      const profile = profileOf(state.userId)!;
      if (profile.org_id) return refuse('Sua conta já pertence a uma organização.');
      const invitation = state.tables.invitations.find((row) => row.id === args.p_invitation_id);
      if (!invitation)
        return refuse(
          'Convite não encontrado. Ele pode ter sido revogado ou trocado por um novo; peça o link atualizado a quem administra.',
        );
      if (String(invitation.email).trim().toLowerCase() !== user.email)
        return refuse('Este convite é para outro e-mail. Entre com a conta do e-mail convidado.');
      if (invitation.accepted_at) return refuse('Este convite já foi usado.');
      if (Date.parse(String(invitation.expires_at)) <= Date.now())
        return refuse('Este convite expirou. Peça um novo a quem administra.');
      if (!proven(linkSession))
        return refuse('Para aceitar o convite, confirme que o e-mail é seu: entre pelo link enviado a ele.');
      profile.org_id = invitation.org_id;
      state.tables.user_roles.push({
        id: randomUUID(),
        org_id: invitation.org_id,
        user_id: state.userId,
        role: invitation.role,
      });
      invitation.accepted_at = new Date().toISOString();
      return { status: 200, body: invitation.org_id };
    },
    create_invitation(args) {
      const actor = activeRoleOf(state.userId);
      const orgId = profileOf(state.userId)?.org_id;
      if (!orgId || (actor !== 'owner' && actor !== 'admin'))
        return refuse('Somente donos e administradores podem convidar pessoas.');
      const invitedRole = String(args.p_role ?? '');
      if (!['owner', 'admin', 'member', 'viewer'].includes(invitedRole)) return refuse('Papel inválido.');
      if (invitedRole === 'owner' && actor !== 'owner') return refuse('Somente um dono pode convidar outro dono.');
      const email = String(args.p_email ?? '')
        .trim()
        .toLowerCase();
      if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return refuse('Informe um e-mail válido.');
      const member = state.tables.user_roles.find(
        (row) =>
          row.org_id === orgId &&
          state.tables.profiles.some(
            (profile) => profile.id === row.user_id && String(profile.email).toLowerCase() === email,
          ),
      );
      if (member && !member.deactivated_at) return refuse('Esta pessoa já faz parte da equipe.');
      // Item 1.2: quem foi desativado volta por "Reativar", e o convite de dono, que o administrador não vê, fica com
      // os donos.
      if (member) return refuse('Esta pessoa está desativada. Para devolver o acesso, use “Reativar” em “Equipe”.');
      const pending = state.tables.invitations.filter(
        (row) => row.org_id === orgId && String(row.email).trim().toLowerCase() === email && !row.accepted_at,
      );
      if (
        actor !== 'owner' &&
        pending.some((row) => row.role === 'owner' && Date.parse(String(row.expires_at)) > Date.now())
      )
        return refuse(
          'Já existe um convite de dono válido para este e-mail. Só um dono pode copiar o link ou revogar esse convite.',
        );
      if (pending.some((row) => Date.parse(String(row.expires_at)) > Date.now()))
        return refuse(
          'Já existe um convite válido para este e-mail. Copie o link na lista de convites ou revogue-o antes de criar outro.',
        );
      // O expirado sai e dá lugar a um novo, com outro ID.
      state.tables.invitations = state.tables.invitations.filter((row) => !pending.includes(row));
      const id = randomUUID();
      state.tables.invitations.push({
        id,
        org_id: orgId,
        email,
        role: invitedRole,
        invited_by: state.userId,
        accepted_at: null,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        created_at: new Date().toISOString(),
      });
      return { status: 200, body: id };
    },
  };
  // RPCs da Equipe do item 1.2, com as mesmas regras e mensagens de supabase/migrations/20261013100000_member_deactivation.sql
  // sobre as tabelas da fixture: quem concede qual papel, último dono ativo, destinatário que edita, a passagem da
  // carteira (oportunidades em aberto e atividades pendentes sempre; contatos e empresas com p_transfer_accounts), os
  // convites pendentes revogados e o registro em portfolio_transfers.
  const roleChangeAllowed = (actor?: string, from?: string | null, to?: string | null) =>
    actor === 'owner' || (actor === 'admin' && from !== 'owner' && to !== 'owner');
  const inOrg = (row: FixtureRow) => row.org_id === IDS.org;
  const portfolio = (userId: string) => ({
    deals: state.tables.deals.filter((row) => inOrg(row) && row.owner_id === userId && row.status === 'open'),
    activities: state.tables.activities.filter(
      (row) => inOrg(row) && row.user_id === userId && !row.completed_at && row.type !== 'note',
    ),
    contacts: state.tables.contacts.filter((row) => inOrg(row) && row.owner_id === userId),
    companies: state.tables.companies.filter((row) => inOrg(row) && row.owner_id === userId),
    invitations: state.tables.invitations.filter((row) => row.invited_by === userId && !row.accepted_at),
  });
  const counted = (rows: ReturnType<typeof portfolio>) => ({
    deals: rows.deals.length,
    activities: rows.activities.length,
    contacts: rows.contacts.length,
    companies: rows.companies.length,
    invitations: rows.invitations.length,
  });
  const plural = (count: number, singular: string, many: string) => `${count} ${count === 1 ? singular : many}`;
  const joinPt = (items: string[]) =>
    items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : (items[0] ?? '');
  const recipientRefusal = (userId: string, recipient: unknown) => {
    if (!recipient) return null;
    if (recipient === userId) return refuse('Escolha outra pessoa para receber a carteira.');
    if (!['owner', 'admin', 'member'].includes(activeRoleOf(String(recipient)) ?? ''))
      return refuse(
        'Quem recebe a carteira precisa estar ativo na equipe e poder editar (dono, administrador ou colaborador).',
      );
    return null;
  };
  const moveMemberPortfolio = (userId: string, recipient: unknown, accounts: boolean, deactivation: boolean) => {
    const rows = portfolio(userId);
    const counts = counted(rows);
    if (!recipient && (counts.deals + counts.activities > 0 || (accounts && counts.contacts + counts.companies > 0))) {
      const person = profileOf(userId);
      const listed = [
        counts.deals ? plural(counts.deals, 'oportunidade em aberto', 'oportunidades em aberto') : '',
        counts.activities ? plural(counts.activities, 'atividade pendente', 'atividades pendentes') : '',
        accounts && counts.contacts ? plural(counts.contacts, 'contato', 'contatos') : '',
        accounts && counts.companies ? plural(counts.companies, 'empresa', 'empresas') : '',
      ].filter(Boolean);
      return {
        refusal: refuse(
          `${String(person?.name || person?.email || 'Esta pessoa')} tem ${joinPt(listed)}. Escolha quem recebe a carteira.`,
          JSON.stringify(counts),
        ),
      };
    }
    const now = new Date().toISOString();
    const moved = { deals: 0, activities: 0, contacts: 0, companies: 0 };
    if (recipient) {
      for (const row of rows.deals) Object.assign(row, { owner_id: recipient, updated_at: now });
      for (const row of rows.activities) Object.assign(row, { user_id: recipient, updated_at: now });
      moved.deals = rows.deals.length;
      moved.activities = rows.activities.length;
      if (accounts) {
        for (const row of [...rows.contacts, ...rows.companies])
          Object.assign(row, { owner_id: recipient, updated_at: now });
        moved.contacts = rows.contacts.length;
        moved.companies = rows.companies.length;
      }
    }
    state.tables.invitations = state.tables.invitations.filter((row) => !rows.invitations.includes(row));
    const result = { ...moved, invitations: rows.invitations.length };
    state.tables.portfolio_transfers.push({
      id: randomUUID(),
      org_id: IDS.org,
      from_user_id: userId,
      to_user_id: moved.deals + moved.activities + moved.contacts + moved.companies ? recipient : null,
      performed_by: state.userId,
      deactivation,
      accounts_transferred: accounts,
      ...result,
      created_at: now,
    });
    return { result };
  };
  const team: Record<string, (args: Record<string, unknown>) => { status: number; body: unknown }> = {
    member_portfolio(args) {
      if (!['owner', 'admin'].includes(activeRoleOf(state.userId) ?? ''))
        return refuse('Somente donos e administradores veem a carteira de outra pessoa.');
      const userId = String(args.p_user_id);
      if (profileOf(userId)?.org_id !== IDS.org) return refuse('Pessoa indisponível nesta organização.');
      return { status: 200, body: [counted(portfolio(userId))] };
    },
    deactivate_member(args) {
      const actor = activeRoleOf(state.userId);
      if (!actor || !['owner', 'admin'].includes(actor))
        return refuse('Somente donos e administradores podem desativar pessoas.');
      const userId = String(args.p_user_id);
      if (userId === state.userId)
        return refuse('Você não pode desativar o seu próprio acesso. Peça a outro dono ou administrador.');
      const target = roleRowOf(userId);
      if (!target || target.org_id !== IDS.org) return refuse('Pessoa indisponível nesta organização.');
      if (target.deactivated_at) return refuse('Esta pessoa já está desativada.');
      const role = String(target.role);
      if (!roleChangeAllowed(actor, role, role)) return refuse('Somente um dono pode desativar outro dono.');
      if (
        role === 'owner' &&
        state.tables.user_roles.filter((row) => row.role === 'owner' && !row.deactivated_at).length <= 1
      )
        return refuse('Mantenha pelo menos um dono ativo na organização.');
      const refusal = recipientRefusal(userId, args.p_recipient_id);
      if (refusal) return refusal;
      if (state.assignBeforeNextDeactivation) {
        state.tables.deals.push({ ...state.assignBeforeNextDeactivation, owner_id: userId });
        delete state.assignBeforeNextDeactivation;
      }
      const moved = moveMemberPortfolio(userId, args.p_recipient_id, Boolean(args.p_transfer_accounts), true);
      if (moved.refusal) return moved.refusal;
      target.deactivated_at = new Date().toISOString();
      return { status: 200, body: [moved.result] };
    },
    transfer_portfolio(args) {
      const actor = activeRoleOf(state.userId);
      if (!actor || !['owner', 'admin'].includes(actor))
        return refuse('Somente donos e administradores podem passar a carteira de outra pessoa.');
      const userId = String(args.p_user_id);
      const target = roleRowOf(userId);
      if (profileOf(userId)?.org_id !== IDS.org) return refuse('Pessoa indisponível nesta organização.');
      if (target && !target.deactivated_at)
        return refuse('Esta pessoa está ativa. Para passar a carteira dela, use “Desativar”.');
      const accounts = Boolean(args.p_transfer_accounts);
      const counts = counted(portfolio(userId));
      if (counts.deals + counts.activities + (accounts ? counts.contacts + counts.companies : 0) === 0)
        return refuse('Esta pessoa não tem mais carteira para passar.');
      const refusal = recipientRefusal(userId, args.p_recipient_id);
      if (refusal) return refusal;
      const moved = moveMemberPortfolio(userId, args.p_recipient_id, accounts, false);
      return moved.refusal ?? { status: 200, body: [moved.result] };
    },
    reactivate_member(args) {
      const actor = activeRoleOf(state.userId);
      if (!actor || !['owner', 'admin'].includes(actor))
        return refuse('Somente donos e administradores podem reativar pessoas.');
      const role = String(args.p_role ?? '');
      if (!['owner', 'admin', 'member', 'viewer'].includes(role)) return refuse('Papel inválido.');
      const target = roleRowOf(String(args.p_user_id));
      if (!target || target.org_id !== IDS.org) return refuse('Pessoa indisponível nesta organização.');
      if (!target.deactivated_at) return refuse('Esta pessoa já está ativa.');
      if (!roleChangeAllowed(actor, String(target.role), role))
        return refuse('Somente um dono pode reativar um dono ou dar o papel de Dono.');
      Object.assign(target, { role, deactivated_at: null });
      return { status: 200, body: null };
    },
    set_member_role(args) {
      const actor = activeRoleOf(state.userId);
      if (!actor || !['owner', 'admin'].includes(actor))
        return refuse('Somente donos e administradores podem alterar papéis.');
      const role = String(args.p_role ?? '');
      if (!['owner', 'admin', 'member', 'viewer'].includes(role)) return refuse('Papel inválido.');
      const userId = String(args.p_user_id);
      const target = roleRowOf(userId);
      if (!target || target.org_id !== IDS.org) return refuse('Pessoa indisponível nesta organização.');
      if (target.deactivated_at) return refuse('Esta pessoa está desativada. Use “Reativar” para devolver o acesso.');
      if (!roleChangeAllowed(actor, String(target.role), role))
        return refuse('Somente um dono pode alterar este papel.');
      if (
        target.role === 'owner' &&
        role !== 'owner' &&
        state.tables.user_roles.filter((row) => row.role === 'owner' && !row.deactivated_at).length <= 1
      )
        return refuse('Mantenha pelo menos um dono ativo na organização.');
      target.role = role;
      state.tables.invitations = state.tables.invitations.filter(
        (row) => row.invited_by !== userId || row.accepted_at || roleChangeAllowed(role, null, String(row.role)),
      );
      return { status: 200, body: null };
    },
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 86400;
  // O amr diz como a sessão foi aberta, como no token do Supabase Auth: 'otp' é o link enviado ao e-mail.
  const tokenFor = (method: 'password' | 'otp') =>
    `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: state.userId, role: 'authenticated', aud: 'authenticated', exp, amr: [{ method, timestamp: exp - 86400 }] })}.test-signature`;
  const token = tokenFor(options.authMethod ?? 'password');
  state.accessToken = token;
  state.linkAccessToken = tokenFor('otp');
  const linkSessionOf = (authorization: string | undefined) => {
    const payload = authorization?.replace(/^Bearer /i, '').split('.')[1];
    if (!payload) return false;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { amr?: { method?: string }[] };
      return Array.isArray(claims.amr) && claims.amr.some((entry) => entry?.method === 'otp');
    } catch {
      return false;
    }
  };
  const session = {
    access_token: token,
    refresh_token: 'test-refresh-token',
    expires_in: 86400,
    expires_at: exp,
    token_type: 'bearer',
    user,
  };
  await page.addInitScript(
    ({ session, theme }) => {
      if (session) localStorage.setItem('empreende-crm-auth', JSON.stringify(session));
      localStorage.setItem('empreende-ia-theme', theme);
    },
    { session: options.signedIn === false ? null : session, theme: options.theme ?? 'dark' },
  );
  async function respond(route: Route, body: unknown, status = 200, total?: number) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS,HEAD',
        // Como no Supabase: o navegador só entrega a contagem (count: exact) se Content-Range for exposto.
        'access-control-expose-headers': 'content-range',
        ...(total !== undefined ? { 'content-range': total ? `0-${total - 1}/${total}` : '*/0' } : {}),
      },
      body: route.request().method() === 'HEAD' ? '' : JSON.stringify(body),
    });
  }
  const readCache = new Map<string, FixtureRow[]>();
  const handle = async (route: Route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    if (method === 'OPTIONS') return respond(route, {});
    if (url.pathname.startsWith('/auth/v1/')) {
      const authRoute = url.pathname.slice('/auth/v1/'.length);
      let authBody: unknown = null;
      try {
        authBody = request.postDataJSON();
      } catch {
        /* GET has no JSON */
      }
      state.authRequests.push({ method, route: authRoute, params: url.search, body: authBody });
      const reply = state.authReplies.get(authRoute as AuthRoute);
      if (reply) {
        const { status, body: replyBody } = typeof reply === 'function' ? reply(authBody) : reply;
        return respond(route, replyBody, status);
      }
      // O link por e-mail (cadastro, acesso e prova do e-mail) só responde que o enviou, como o Auth.
      if (authRoute === 'otp') return respond(route, {});
      // O link ou o código do e-mail, conferido depois do toque da pessoa: a sessão aberta por ele (amr otp).
      if (authRoute === 'verify') return respond(route, { ...session, access_token: state.linkAccessToken });
      return respond(route, authRoute === 'user' ? user : session);
    }
    const table = url.pathname.split('/').at(-1)!;
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      /* GET has no JSON */
    }
    state.requests.push({ method, table, params: url.search, body });
    const hold = state.holds?.get(table);
    if (hold) await hold;
    if (
      (state.failReads.has(table) && ['GET', 'HEAD'].includes(method)) ||
      (state.failWrites.has(table) && !['GET', 'HEAD'].includes(method))
    )
      return respond(route, { code: 'PGRST000', message: 'Falha intencional de teste' }, 503);
    if (url.pathname.includes('/rpc/')) {
      const args = body as Record<string, string>;
      if (table === 'search_crm') {
        const q = args.p_query.toLocaleLowerCase();
        const results = [
          ...state.tables.contacts
            .filter((c) => c.org_id === IDS.org)
            .map((c) => ({
              entity: 'contact',
              id: c.id,
              title: `${c.first_name} ${c.last_name ?? ''}`.trim(),
              subtitle: c.email ?? 'Contato',
              path: `/contacts?contact=${c.id}`,
            })),
          ...state.tables.deals
            .filter((d) => d.org_id === IDS.org)
            .map((d) => ({
              entity: 'deal',
              id: d.id,
              title: d.title,
              subtitle: 'Oportunidade',
              path: `/pipeline?deal=${d.id}`,
            })),
        ].filter((item) => String(item.title).toLocaleLowerCase().includes(q));
        return respond(route, results);
      }
      if (table === 'move_deal') {
        const deal = state.tables.deals.find((d) => d.id === args.p_deal_id)!;
        const previous = { ...deal };
        Object.assign(deal, {
          stage_id: args.p_stage_id,
          status: args.p_status ?? deal.status,
          lost_reason: args.p_lost_reason ?? null,
          updated_at: new Date().toISOString(),
          stage_entered_at: new Date().toISOString(),
        });
        applyDealRules(deal, previous);
        state.tables.deal_stage_history.push({
          id: randomUUID(),
          org_id: IDS.org,
          deal_id: deal.id,
          from_stage_id: previous.stage_id,
          to_stage_id: deal.stage_id,
          from_status: previous.status,
          to_status: deal.status,
          changed_by: state.userId,
          created_at: new Date().toISOString(),
        });
        // A movimentação já foi gravada; só a confirmação se perde.
        if (state.loseNextWriteResponse.delete('move_deal')) return route.abort('failed');
        return respond(route, deal);
      }
      if (table === 'delete_deal') {
        // Mesmas regras de public.delete_deal (item 0.7 do roteiro).
        if (role !== 'owner')
          return respond(
            route,
            { code: '42501', message: 'Somente administradores podem excluir oportunidades.' },
            403,
          );
        const dealId = String(args.p_deal_id);
        const deal = state.tables.deals.find((d) => d.id === dealId && d.org_id === IDS.org);
        if (!deal) return respond(route, { code: 'P0001', message: 'Oportunidade indisponível ou sem acesso.' }, 400);
        const linked = (name: string) => state.tables[name].filter((row) => row.deal_id === dealId);
        const counts = {
          activities: linked('activities').length,
          payments: linked('payments').length,
          automation_logs: linked('automation_logs').length,
        };
        if (
          !(body as { p_confirm?: boolean }).p_confirm &&
          counts.activities + counts.payments + counts.automation_logs
        )
          return respond(
            route,
            {
              code: 'P0001',
              message: 'Esta oportunidade tem vínculos. Confirme a exclusão para manter esses registros sem o vínculo.',
              details: JSON.stringify(counts),
              hint: null,
            },
            400,
          );
        for (const name of ['activities', 'payments', 'automation_logs'])
          linked(name).forEach((row) => (row.deal_id = null));
        state.tables.deals = state.tables.deals.filter((d) => d !== deal);
        state.tables.deal_stage_history = state.tables.deal_stage_history.filter((h) => h.deal_id !== dealId);
        return respond(route, counts);
      }
      if (table === 'automation_log_errors') {
        if (role !== 'owner')
          return respond(
            route,
            { code: '42501', message: 'Somente administradores veem o detalhe técnico das falhas.' },
            403,
          );
        return respond(
          route,
          state.tables.automation_logs
            .filter((log) => log.automation_id === args.p_automation_id && log.error_detail)
            .map((log) => ({ id: log.id, error_detail: log.error_detail })),
        );
      }
      if (table === 'instance_status') {
        // Lida também sem sessão (anon), como a RPC do banco.
        const row = { has_organization: state.instance.hasOrganization };
        const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
        return respond(route, single ? row : [row]);
      }
      if (team[table]) {
        (state.teamCalls ??= []).push({ rpc: table, body: (body ?? {}) as Record<string, unknown> });
        const { status, body: reply } = team[table]((body ?? {}) as Record<string, unknown>);
        return respond(route, reply, status);
      }
      if (admission[table]) {
        const { status, body: reply } = admission[table](
          (body ?? {}) as Record<string, unknown>,
          // allHeaders: o Playwright pode deixar cabeçalhos de credencial fora de headers().
          linkSessionOf((await (request.allHeaders?.() ?? request.headers())).authorization),
        );
        return respond(route, reply, status);
      }
      return respond(route, { code: 'PGRST202', message: 'RPC não implementada pela fixture: ' + table }, 404);
    }
    // Conta desativada (item 1.2): private.current_org() é nula, e a RLS deixa ler só o próprio perfil e o próprio papel,
    // sem gravar nada.
    if (deactivatedSession()) {
      if (['GET', 'HEAD'].includes(method)) {
        const own =
          table === 'profiles'
            ? state.tables.profiles.filter((row) => row.id === state.userId)
            : table === 'user_roles'
              ? state.tables.user_roles.filter((row) => row.user_id === state.userId)
              : [];
        const rows = own.filter((row) => filters(row, url.searchParams));
        const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
        if (single && rows.length !== 1)
          return respond(
            route,
            { code: 'PGRST116', message: 'Expected exactly one row', details: null, hint: null },
            406,
          );
        return respond(route, single ? rows[0] : rows, 200, rows.length);
      }
      return respond(route, { code: '42501', message: 'new row violates row-level security policy' }, 403);
    }
    const tableRows = state.tables[table] ?? [];
    const readKey = `${table}?${[...url.searchParams].filter(([key]) => !['offset', 'limit'].includes(key)).join('&')}`;
    const memoized = state.memoizeReads && method === 'GET' ? readCache.get(readKey) : undefined;
    let selected = memoized ?? tableRows.filter((row) => filters(row, url.searchParams));
    // Políticas invitations_manager_read e invitations_manager_delete (item 1.1): só donos e administradores leem e
    // revogam convites, e o convite de dono, só um dono.
    if (table === 'invitations') {
      const actor = activeRoleOf(state.userId) ?? '';
      selected = ['owner', 'admin'].includes(actor)
        ? selected.filter((row) => row.role !== 'owner' || actor === 'owner')
        : [];
    }
    // Política portfolio_transfers_manager_read (item 1.2): só donos e administradores.
    if (table === 'portfolio_transfers' && !['owner', 'admin'].includes(activeRoleOf(state.userId) ?? ''))
      selected = [];
    if (method === 'GET' || method === 'HEAD') {
      // Como o GRANT por coluna: error_detail não entra no SELECT de ninguém, nem por '*'.
      const columns = url.searchParams.get('select') ?? '*';
      if (table === 'automation_logs' && (columns === '*' || columns.split(',').includes('error_detail')))
        return respond(route, { code: '42501', message: 'permission denied for table automation_logs' }, 403);
      const order = url.searchParams.get('order');
      if (order && !memoized)
        selected.sort((a, b) => {
          for (const item of order.split(',')) {
            const [field, direction] = item.split('.');
            const result =
              typeof a[field] === 'number'
                ? Number(a[field]) - Number(b[field])
                : String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
            if (result) return direction === 'desc' ? -result : result;
          }
          return 0;
        });
      if (state.memoizeReads && method === 'GET') readCache.set(readKey, selected);
      const total = selected.length,
        offset = Number(url.searchParams.get('offset') ?? 0),
        limit = Number(url.searchParams.get('limit') ?? 1000);
      selected = selected.slice(offset, offset + limit);
      const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
      if (single && selected.length !== 1)
        return respond(
          route,
          {
            code: 'PGRST116',
            message: 'Expected exactly one row',
            details: `The result contains ${selected.length} rows`,
            hint: null,
          },
          406,
        );
      return respond(route, single ? selected[0] : selected, 200, total);
    }
    if (role === 'viewer') return respond(route, { code: '42501', message: 'Somente leitura no teste' }, 403);
    if (role === 'member' && method === 'DELETE')
      return respond(route, { code: '42501', message: 'Exclusão exige administrador' }, 403);
    const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
    if (single && ['PATCH', 'DELETE'].includes(method) && selected.length !== 1)
      return respond(
        route,
        {
          code: 'PGRST116',
          message: 'Expected exactly one row',
          details: `The result contains ${selected.length} rows`,
          hint: null,
        },
        406,
      );
    if (method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body];
      const created = incoming.map((fields: Record<string, unknown>) => ({
        id: randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(table === 'contacts'
          ? {
              first_name: null,
              last_name: null,
              email: null,
              phone: null,
              company_id: null,
              owner_id: null,
              status: 'lead',
            }
          : {}),
        ...(table === 'activities'
          ? {
              body: null,
              type: 'task',
              user_id: null,
              contact_id: null,
              company_id: null,
              deal_id: null,
              due_date: null,
              end_date: null,
              completed_at: null,
              created_by: state.userId,
            }
          : {}),
        ...(table === 'deals'
          ? {
              stage_entered_at: new Date().toISOString(),
              status: 'open',
              value: 0,
              probability: null,
              closed_at: null,
              currency: 'BRL',
            }
          : {}),
        ...fields,
      })) as FixtureRow[];
      if (table === 'deals') created.forEach((row) => applyDealRules(row));
      const conflictKeys = (url.searchParams.get('on_conflict') ?? 'id').split(',');
      const ignore = request.headers().prefer?.includes('resolution=ignore-duplicates');
      const merge = request.headers().prefer?.includes('resolution=merge-duplicates');
      const nextRows = tableRows.map((row) => ({ ...row }));
      selected = [];
      for (const row of created) {
        const existing = nextRows.find((item) => conflictKeys.every((key) => item[key] === row[key]));
        if (existing && ignore) continue;
        if (existing && merge) {
          Object.assign(existing, row, { id: existing.id });
          selected.push(existing);
          continue;
        }
        if (
          existing ||
          (table === 'contacts' &&
            row.email &&
            nextRows.some(
              (item) =>
                item.org_id === row.org_id &&
                String(item.email ?? '')
                  .trim()
                  .toLowerCase() === String(row.email).trim().toLowerCase(),
            ))
        )
          return respond(route, { code: '23505', message: 'Duplicate identity' }, 409);
        nextRows.push(row);
        selected.push(row);
      }
      state.tables[table] = nextRows;
      if (table === 'deals')
        for (const d of created)
          state.tables.deal_stage_history.push({
            id: randomUUID(),
            org_id: IDS.org,
            deal_id: d.id,
            from_stage_id: null,
            to_stage_id: d.stage_id,
            from_status: null,
            to_status: d.status,
            changed_by: state.userId,
            created_at: new Date().toISOString(),
          });
    }
    if (method === 'PATCH')
      selected.forEach((row) => {
        const previous = { ...row };
        Object.assign(row, body, { updated_at: new Date().toISOString() });
        if (table === 'deals') applyDealRules(row, previous);
      });
    if (method === 'DELETE') {
      state.tables[table] = tableRows.filter((row) => !selected.includes(row));
      // ON DELETE SET NULL (coluna) de automation_logs: o log fica, sem o vínculo excluído.
      const logLink = ({ activities: 'activity_id', automations: 'automation_id' } as Record<string, string>)[table];
      if (logLink)
        for (const log of state.tables.automation_logs)
          if (selected.some((row) => row.id === log[logLink])) log[logLink] = null;
    }
    if (single && selected.length !== 1)
      return respond(
        route,
        {
          code: 'PGRST116',
          message: 'Expected exactly one row',
          details: `The result contains ${selected.length} rows`,
          hint: null,
        },
        406,
      );
    // The write is already committed to the fixture; only its acknowledgement is lost.
    if (state.loseNextWriteResponse.delete(table)) return route.abort('failed');
    return respond(route, single ? selected[0] : selected);
  };
  if (options.httpPort) state.stopServer = await serveOverHttp(handle, options.httpPort);
  else await page.route('http://127.0.0.1:54329/**', handle);
  return state;
}

/**
 * Serve a fixture por HTTP em 127.0.0.1:<port>, adaptando cada requisição à interface de Route que o tratador usa
 * (request, fulfill e abort). O navegador faz requisições reais, com preflight de CORS, e não passa pela interceptação
 * do Playwright.
 */
async function serveOverHttp(handle: (route: Route) => Promise<unknown>, port: number) {
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const route = {
        request: () => ({
          url: () => `http://127.0.0.1:${port}${incoming.url}`,
          method: () => incoming.method ?? 'GET',
          headers: () => incoming.headers as Record<string, string>,
          postDataJSON: () => (text ? JSON.parse(text) : null),
        }),
        fulfill: async ({
          status = 200,
          contentType = 'application/json',
          headers = {},
          body = '',
        }: {
          status?: number;
          contentType?: string;
          headers?: Record<string, string>;
          body?: string;
        }) => {
          // Authorization não é coberto pelo curinga de Access-Control-Allow-Headers: devolve os cabeçalhos pedidos.
          const requested = incoming.headers['access-control-request-headers'];
          outgoing.writeHead(status, {
            ...headers,
            ...(requested ? { 'access-control-allow-headers': requested } : {}),
            'content-type': contentType,
          });
          outgoing.end(body);
        },
        abort: async () => void outgoing.destroy(),
      };
      handle(route as unknown as Route).catch(() => outgoing.destroy());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
}

/**
 * Acrescenta à fixture o volume sintético de scripts/lib/volume-data.mjs (item 0.10): 1 mil empresas, 5 mil contatos,
 * 2 mil oportunidades e 15 mil atividades da organização de teste, com o dono e o leitor como responsáveis e as etapas
 * do funil "Comercial". Mesma semente e mesmo instante, mesmas linhas.
 */
export function withVolume(state: FixtureState, options: { now?: Date; counts?: Partial<typeof VOLUME_COUNTS> } = {}) {
  const volume = generateVolumeData({
    orgId: IDS.org,
    ownerIds: [IDS.owner, IDS.viewer],
    stages: [IDS.stage, IDS.stage2].map((id) => ({ id, pipeline_id: IDS.pipeline })),
    now: options.now ?? new Date(),
    counts: options.counts,
  });
  for (const table of ['companies', 'contacts', 'deals', 'activities'] as const)
    state.tables[table].push(...(volume[table] as unknown as FixtureRow[]));
  return volume;
}

/**
 * Equipe do item 1.2 sobre a fixture: o colaborador Fulano Vendedor, que vai sair, com uma oportunidade em aberto e uma
 * ganha, uma tarefa pendente, um contato e uma empresa; a colaboradora Bruna Recebedora; e a administradora Carla, com
 * um convite pendente. Sem `withTeam`, a fixture fica como antes do item (dono e leitor).
 */
export function withTeam(state: FixtureState) {
  const old = dayAt(-10);
  const base = { org_id: IDS.org, created_at: old, updated_at: old };
  state.tables.profiles.push(
    { id: IDS.leaving, ...base, name: 'Fulano Vendedor', email: 'fulano@example.test', avatar_url: null },
    { id: IDS.recipient, ...base, name: 'Bruna Recebedora', email: 'bruna@example.test', avatar_url: null },
    { id: IDS.admin, ...base, name: 'Carla Administradora', email: 'carla@example.test', avatar_url: null },
  );
  state.tables.user_roles.push(
    { id: randomUUID(), org_id: IDS.org, user_id: IDS.leaving, role: 'member', deactivated_at: null },
    { id: randomUUID(), org_id: IDS.org, user_id: IDS.recipient, role: 'member', deactivated_at: null },
    { id: randomUUID(), org_id: IDS.org, user_id: IDS.admin, role: 'admin', deactivated_at: null },
  );
  const deal = state.tables.deals.find((row) => row.id === IDS.deal)!;
  state.tables.deals.push(
    {
      ...deal,
      id: randomUUID(),
      title: 'Contrato do Fulano',
      owner_id: IDS.leaving,
      contact_id: null,
      company_id: null,
    },
    {
      ...deal,
      id: randomUUID(),
      title: 'Venda ganha pelo Fulano',
      owner_id: IDS.leaving,
      contact_id: null,
      company_id: null,
      status: 'won',
      probability: 100,
      closed_at: dayAt(-2),
    },
  );
  const task = state.tables.activities.find((row) => row.id === IDS.activity)!;
  state.tables.activities.push({
    ...task,
    id: randomUUID(),
    title: 'Ligar para o cliente do Fulano',
    user_id: IDS.leaving,
    created_by: IDS.leaving,
    contact_id: null,
    company_id: null,
    deal_id: null,
    due_date: dayAt(2),
  });
  state.tables.contacts.push({
    id: randomUUID(),
    ...base,
    first_name: 'Cliente',
    last_name: 'do Fulano',
    email: 'cliente-fulano@example.test',
    phone: null,
    company_id: null,
    owner_id: IDS.leaving,
    status: 'lead',
    job_title: null,
    source: null,
    notes: null,
  });
  state.tables.companies.push({
    id: randomUUID(),
    ...base,
    name: 'Empresa do Fulano',
    domain: null,
    industry: null,
    size: null,
    revenue: null,
    website: null,
    linkedin_url: null,
    owner_id: IDS.leaving,
    phone: null,
  });
  state.tables.invitations.push({
    id: randomUUID(),
    org_id: IDS.org,
    email: 'convidado-pela-carla@example.test',
    role: 'member',
    invited_by: IDS.admin,
    accepted_at: null,
    expires_at: dayAt(5),
    created_at: dayAt(-1),
  });
  return state;
}
