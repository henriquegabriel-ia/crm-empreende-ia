import type { Page, Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { IMPORT_FIXTURE_EXISTING } from '../../scripts/lib/import-fixture.mjs';
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
  /** Pedidos a complete_activity (item 1.9), com o corpo. */
  completeCalls?: Record<string, unknown>[];
  /** Pedidos às RPCs de privacidade (item 1.10), com o corpo. */
  privacyCalls?: { rpc: string; body: Record<string, unknown> }[];
  /**
   * Item 1.10: um colega muda o contato logo antes da próxima anonimização dele, como numa corrida entre o resumo e a
   * confirmação (a versão lida no resumo deixa de valer).
   */
  touchBeforeNextAnonymization?: string;
  /**
   * Item 1.11: colunas que o banco ainda não tem (a migração do 1.9 ou do 1.10 não aplicada). Uma leitura que as pede ou
   * uma gravação que as envia recebe 42703, como o PostgreSQL.
   */
  missingColumns?: Set<string>;
  /**
   * Item 1.11: chamada antes de cada gravação (POST) numa tabela, com o número do pedido nela (a partir de 1) e as
   * linhas. Serve às corridas da importação: um e-mail cadastrado por um colega, uma pessoa desativada ou a resposta
   * perdida antes de um lote.
   */
  beforeWrite?: (table: string, call: number, rows: FixtureRow[], state: FixtureState) => void;
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
/**
 * Padrões das colunas que o banco preenche (item 1.9): o resultado da ligação e a marca "Não contatar". Item 1.10: a
 * base legal (com o registro, a data e o autor), a anonimização e o padrão da base legal da empresa. As linhas da
 * fixture e as criadas pelos testes passam por aqui, como as colunas com padrão de uma tabela.
 */
const COLUMN_DEFAULTS: Record<string, Record<string, unknown>> = {
  activities: { outcome: null },
  contacts: {
    do_not_contact: false,
    do_not_contact_at: null,
    do_not_contact_by: null,
    do_not_contact_reason: null,
    legal_basis: 'not_informed',
    legal_basis_note: null,
    legal_basis_at: null,
    legal_basis_by: null,
    anonymized_at: null,
    anonymized_by: null,
  },
  companies: { do_not_contact: false, do_not_contact_at: null, do_not_contact_by: null, do_not_contact_reason: null },
  organizations: { default_legal_basis: 'not_informed', default_legal_basis_at: null, default_legal_basis_by: null },
};
const withColumnDefaults = (table: string, row: FixtureRow): FixtureRow => ({ ...COLUMN_DEFAULTS[table], ...row });
export function createFixture(role: FixtureRole = 'owner'): FixtureState {
  const state = createFixtureTables(role);
  for (const table of Object.keys(COLUMN_DEFAULTS))
    state.tables[table] = state.tables[table].map((row) => withColumnDefaults(table, row));
  return state;
}
function createFixtureTables(role: FixtureRole): FixtureState {
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
      // Registro das exportações e anonimizações (item 1.10): só donos e administradores leem; só as RPCs gravam.
      privacy_actions: [],
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
    // Datas comparadas como instantes (item 1.12: os lembretes pedem due_date=lt.<fim do dia>); nulo nunca passa, como
    // no PostgreSQL.
    if (expression.startsWith('lt.') && !(value != null && Date.parse(String(value)) < Date.parse(expression.slice(3))))
      return false;
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
  // Item 1.9 (supabase/migrations/20261013110000_channel_interactions.sql) sobre as tabelas da fixture: os tipos de
  // atividade do CHECK, o resultado só na ligação concluída (normalize_activity_outcome), a marca "Não contatar"
  // carimbada pelo banco e tirada só por donos e administradores (stamp_do_not_contact) e a RPC complete_activity, com
  // a guarda de versão, a próxima ação na mesma "transação" e a repetição pelo id da próxima ação.
  const ACTIVITY_TYPES = ['task', 'meeting', 'call', 'email', 'note', 'whatsapp', 'visit'];
  const OUTCOMES = ['answered', 'no_answer', 'voicemail'];
  const ACTIVITY_CHANGED =
    'Esta atividade mudou ou não está mais disponível. Revise os dados atuais antes de tentar novamente.';
  const checkViolation = (constraint: string, table: string) => ({
    status: 400,
    body: {
      code: '23514',
      message: `new row for relation "${table}" violates check constraint "${constraint}"`,
      details: null,
      hint: null,
    },
  });
  const channelRules = (table: string, row: FixtureRow, previous?: FixtureRow) => {
    if (table === 'activities') {
      if (!ACTIVITY_TYPES.includes(String(row.type))) return checkViolation('activities_type_check', table);
      if (row.type !== 'call' || !row.completed_at) row.outcome = null;
      if (row.outcome != null && !OUTCOMES.includes(String(row.outcome)))
        return checkViolation('activities_outcome_valid', table);
    }
    if (table === 'contacts' || table === 'companies') {
      if (!previous || Boolean(row.do_not_contact) !== Boolean(previous.do_not_contact)) {
        if (row.do_not_contact) {
          const reason = String(row.do_not_contact_reason ?? '').trim();
          Object.assign(row, {
            do_not_contact: true,
            do_not_contact_at: new Date().toISOString(),
            do_not_contact_by: state.userId,
            do_not_contact_reason: reason || null,
          });
        } else {
          if (previous && !['owner', 'admin'].includes(activeRoleOf(state.userId) ?? ''))
            return refuse('Só donos e administradores permitem o contato de novo.');
          Object.assign(row, {
            do_not_contact: false,
            do_not_contact_at: null,
            do_not_contact_by: null,
            do_not_contact_reason: null,
          });
        }
      } else
        Object.assign(row, {
          do_not_contact_at: previous.do_not_contact_at ?? null,
          do_not_contact_by: previous.do_not_contact_by ?? null,
          do_not_contact_reason: previous.do_not_contact_reason ?? null,
        });
      if (String(row.do_not_contact_reason ?? '').length > 500)
        return checkViolation(`${table}_do_not_contact_reason_length`, table);
    }
    return null;
  };
  const completeActivity = (args: Record<string, unknown>) => {
    (state.completeCalls ??= []).push(args);
    if (!['owner', 'admin', 'member'].includes(activeRoleOf(state.userId) ?? ''))
      return refuse('Você não tem permissão para alterar atividades.');
    const next = (args.p_next ?? null) as Record<string, unknown> | null;
    const nextId = next && typeof next.id === 'string' && next.id ? next.id : null;
    const activities = state.tables.activities;
    if (nextId) {
      const existing = activities.find((row) => row.id === nextId);
      if (existing) {
        const done = activities.find((row) => row.id === args.p_activity_id);
        if (done?.completed_at) return { status: 200, body: { completed: done, next: existing, replayed: true } };
        return refuse('Esta próxima ação já existe. Atualize a página.');
      }
    }
    const done = activities.find((row) => row.id === args.p_activity_id && row.org_id === IDS.org);
    if (!done || done.updated_at !== args.p_version || done.completed_at || done.type === 'note')
      return refuse(ACTIVITY_CHANGED);
    const outcome = (args.p_outcome ?? null) as string | null;
    if (outcome !== null && (done.type !== 'call' || !OUTCOMES.includes(outcome)))
      return refuse('O resultado só vale para ligações: atendeu, não atendeu ou caixa postal.');
    let nextRow: FixtureRow | null = null;
    if (next) {
      const type = String(next.type || 'task');
      if (type === 'note') return refuse('A próxima ação não pode ser uma nota.');
      if (!String(next.title ?? '').trim()) return refuse('Informe o que precisa acontecer na próxima ação.');
      if (!next.due_date) return refuse('Informe o prazo da próxima ação.');
      const pick = (key: string) => (key in next ? ((next[key] as string | null) ?? null) : done[key]);
      const userId = pick('user_id');
      const assignee = userId ? roleRowOf(String(userId)) : undefined;
      if (userId && (!assignee || assignee.deactivated_at))
        return refuse('A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.');
      const now = new Date().toISOString();
      nextRow = withColumnDefaults('activities', {
        id: nextId ?? randomUUID(),
        org_id: done.org_id,
        type,
        title: String(next.title).trim(),
        body: String(next.body ?? '').trim() || null,
        due_date: next.due_date,
        end_date: next.end_date ?? null,
        completed_at: null,
        user_id: userId,
        contact_id: pick('contact_id'),
        company_id: pick('company_id'),
        deal_id: pick('deal_id'),
        created_by: state.userId,
        created_at: now,
        updated_at: now,
      });
    }
    // A próxima ação passa pelos gatilhos do item 1.10 (contato anonimizado e "Não contatar"), como no banco.
    if (nextRow) {
      const refusal = privacyRules('activities', nextRow);
      if (refusal) return refusal;
    }
    const note = String(args.p_note ?? '').trim();
    const body = String(done.body ?? '').trim();
    Object.assign(done, {
      completed_at: new Date().toISOString(),
      outcome: done.type === 'call' ? outcome : null,
      body: note ? [body, note].filter(Boolean).join('\n\n') : done.body,
      updated_at: new Date().toISOString(),
    });
    if (nextRow) activities.push(nextRow);
    return { status: 200, body: { completed: done, next: nextRow } };
  };
  // Item 1.10 (supabase/migrations/20261013120000_contact_privacy.sql) sobre as tabelas da fixture: a base legal
  // carimbada pelo banco (stamp_legal_basis, com o padrão da empresa na inserção), o padrão carimbado
  // (stamp_default_legal_basis), o consentimento que exige o registro, o contato anonimizado congelado
  // (protect_anonymized_contact e guard_anonymized_contact) e a recusa de ações de contato planejadas para quem tem
  // "Não contatar" (refuse_do_not_contact_action), com as mesmas mensagens (P0001).
  const PLANNED_CONTACT_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'visit'];
  const ANONYMIZED_REFUSAL =
    'Este contato foi anonimizado e não recebe novos registros. Para um novo relacionamento com a pessoa, cadastre um novo contato.';
  const contactOf = (id: unknown) =>
    id ? state.tables.contacts.find((row) => row.id === id && row.org_id === IDS.org) : undefined;
  const companyOf = (id: unknown) =>
    id ? state.tables.companies.find((row) => row.id === id && row.org_id === IDS.org) : undefined;
  const privacyRules = (table: string, row: FixtureRow, previous?: FixtureRow) => {
    const now = new Date().toISOString();
    if (table === 'organizations') {
      if (
        !['not_informed', 'contract', 'legitimate_interest', 'legal_obligation', 'exercise_of_rights'].includes(
          String(row.default_legal_basis ?? 'not_informed'),
        )
      )
        return checkViolation('organizations_default_legal_basis_valid', table);
      if (previous && row.default_legal_basis !== previous.default_legal_basis)
        Object.assign(row, { default_legal_basis_at: now, default_legal_basis_by: state.userId });
      else if (previous)
        Object.assign(row, {
          default_legal_basis_at: previous.default_legal_basis_at ?? null,
          default_legal_basis_by: previous.default_legal_basis_by ?? null,
        });
    }
    if (table === 'contacts') {
      if (!previous) {
        Object.assign(row, { anonymized_at: null, anonymized_by: null });
        if (!row.legal_basis || row.legal_basis === 'not_informed')
          row.legal_basis =
            state.tables.organizations.find((org) => org.id === row.org_id)?.default_legal_basis ?? 'not_informed';
        row.legal_basis_note = String(row.legal_basis_note ?? '').trim() || null;
        Object.assign(row, { legal_basis_at: now, legal_basis_by: state.userId });
      } else {
        if (previous.anonymized_at) {
          const personal = [
            'first_name',
            'last_name',
            'email',
            'phone',
            'job_title',
            'notes',
            'source',
            'company_id',
            'do_not_contact',
            'legal_basis',
            'legal_basis_note',
            'anonymized_at',
            'anonymized_by',
          ];
          if (personal.some((key) => (row[key] ?? null) !== (previous[key] ?? null)))
            return refuse(
              'Este contato foi anonimizado e não recebe mais dados pessoais. Para um novo relacionamento com a pessoa, cadastre um novo contato.',
            );
        } else Object.assign(row, { anonymized_at: null, anonymized_by: null });
        const note = String(row.legal_basis_note ?? '').trim() || null;
        if (row.legal_basis !== previous.legal_basis || note !== (previous.legal_basis_note ?? null))
          Object.assign(row, { legal_basis_note: note, legal_basis_at: now, legal_basis_by: state.userId });
        else
          Object.assign(row, {
            legal_basis_note: previous.legal_basis_note ?? null,
            legal_basis_at: previous.legal_basis_at ?? null,
            legal_basis_by: previous.legal_basis_by ?? null,
          });
      }
      if (row.legal_basis === 'consent' && !row.legal_basis_note && !row.anonymized_at)
        return checkViolation('contacts_legal_basis_consent_note', table);
    }
    if (['activities', 'deals', 'payments'].includes(table)) {
      if (
        row.contact_id &&
        (!previous || row.contact_id !== previous.contact_id) &&
        contactOf(row.contact_id)?.anonymized_at
      )
        return refuse(ANONYMIZED_REFUSAL);
      if (
        table === 'activities' &&
        previous?.contact_id &&
        row.contact_id === previous.contact_id &&
        contactOf(previous.contact_id)?.anonymized_at &&
        ['title', 'body', 'type', 'outcome', 'due_date', 'end_date', 'completed_at'].some(
          (key) => (row[key] ?? null) !== (previous[key] ?? null),
        )
      )
        return refuse('Esta atividade é de um contato anonimizado e não pode ser editada nem reaberta.');
    }
    if (table === 'activities' && !row.completed_at && PLANNED_CONTACT_TYPES.includes(String(row.type))) {
      const sameAction =
        previous &&
        !previous.completed_at &&
        row.type === previous.type &&
        (row.contact_id ?? null) === (previous.contact_id ?? null) &&
        (row.company_id ?? null) === (previous.company_id ?? null);
      if (!sameAction) {
        if (row.contact_id) {
          if (contactOf(row.contact_id)?.do_not_contact)
            return refuse(
              'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre como concluído o que já aconteceu, ou use uma tarefa para o trabalho interno.',
            );
        } else if (
          row.company_id &&
          ['call', 'whatsapp'].includes(String(row.type)) &&
          companyOf(row.company_id)?.do_not_contact
        )
          return refuse(
            'Esta empresa está marcada como “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Use o contato de uma pessoa liberada, ou uma tarefa.',
          );
      }
    }
    return null;
  };
  // As RPCs de privacidade, com os mesmos predicados da migração: os registros da pessoa (as atividades com ela, as
  // oportunidades dela e os recebimentos dela e dessas oportunidades), as atividades dessas oportunidades com outros
  // contatos e o resto da organização com o nome completo, o e-mail ou o telefone. A troca de termos é simplificada:
  // os termos escapados, sem diferenciar maiúsculas, com fronteira de palavra (o banco também ignora os acentos).
  const PARTICLES = new Set(['das', 'dos', 'del', 'der', 'van', 'von']);
  const termRegex = (terms: string[]) => {
    const unique = [...new Set(terms.map((term) => term.trim().replace(/\s+/g, ' ')).filter(Boolean))].sort(
      (a, b) => b.length - a.length,
    );
    if (!unique.length) return null;
    const body = unique.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|');
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'giu');
  };
  const contactTerms = (contact: FixtureRow) => {
    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
    const strong = [
      ...(fullName.split(/\s+/).length >= 2 ? [fullName] : []),
      ...(contact.email ? [String(contact.email)] : []),
      ...(contact.phone ? [String(contact.phone)] : []),
    ];
    const words = fullName.split(/\s+/).filter((word) => word.length >= 3 && !PARTICLES.has(word.toLowerCase()));
    return {
      all: termRegex([...strong, String(contact.first_name ?? ''), String(contact.last_name ?? ''), ...words]),
      strong: termRegex(strong),
    };
  };
  const matches = (regex: RegExp | null, ...texts: unknown[]) =>
    !!regex && texts.some((text) => typeof text === 'string' && new RegExp(regex.source, regex.flags).test(text));
  const redact = (regex: RegExp | null, text: unknown) =>
    regex && typeof text === 'string' ? text.replace(new RegExp(regex.source, regex.flags), '[anonimizado]') : text;
  const TYPE_TITLES: Record<string, string> = {
    call: 'Ligação',
    whatsapp: 'WhatsApp',
    email: 'E-mail',
    meeting: 'Reunião',
    visit: 'Visita',
    note: 'Nota',
  };
  const anonymizationPlan = (contact: FixtureRow) => {
    const { all, strong } = contactTerms(contact);
    const inOrg = (row: FixtureRow) => row.org_id === IDS.org;
    const deals = state.tables.deals.filter((row) => inOrg(row) && row.contact_id === contact.id);
    const dealIds = new Set(deals.map((row) => row.id));
    const own = state.tables.activities.filter((row) => inOrg(row) && row.contact_id === contact.id);
    const deleted = own.filter((row) => !row.completed_at && row.type !== 'note');
    const scrubbed = own.filter((row) => !deleted.includes(row));
    const payments = state.tables.payments.filter(
      (row) => inOrg(row) && (row.contact_id === contact.id || dealIds.has(String(row.deal_id))),
    );
    const dealActivities = state.tables.activities.filter(
      (row) =>
        inOrg(row) &&
        row.contact_id !== contact.id &&
        dealIds.has(String(row.deal_id)) &&
        matches(all, row.title, row.body),
    );
    const rest = [
      ...state.tables.activities
        .filter(
          (row) =>
            inOrg(row) &&
            row.contact_id !== contact.id &&
            !dealIds.has(String(row.deal_id)) &&
            matches(strong, row.title, row.body),
        )
        .map((row) => ({ table: 'activities', row })),
      ...state.tables.deals
        .filter((row) => inOrg(row) && !dealIds.has(row.id) && matches(strong, row.title, row.lost_reason))
        .map((row) => ({ table: 'deals', row })),
      ...state.tables.payments
        .filter(
          (row) =>
            inOrg(row) &&
            row.contact_id !== contact.id &&
            !dealIds.has(String(row.deal_id)) &&
            matches(strong, row.description),
        )
        .map((row) => ({ table: 'payments', row })),
      ...state.tables.contacts
        .filter(
          (row) =>
            inOrg(row) &&
            row.id !== contact.id &&
            matches(strong, row.notes, row.source, row.job_title, row.legal_basis_note, row.do_not_contact_reason),
        )
        .map((row) => ({ table: 'contacts', row })),
      ...state.tables.companies
        .filter((row) => inOrg(row) && matches(strong, row.do_not_contact_reason))
        .map((row) => ({ table: 'companies', row })),
    ];
    const counts = {
      activities_scrubbed: scrubbed.length,
      activities_deleted: deleted.length,
      deals: deals.length,
      open_deals: deals.filter((row) => row.status === 'open').length,
      payments: payments.length,
      pending_payments: payments.filter((row) => row.status === 'pending').length,
      other_records: dealActivities.length + rest.length,
    };
    return { all, strong, deals, deleted, scrubbed, payments, dealActivities, rest, counts };
  };
  const managerRole = () => ['owner', 'admin'].includes(activeRoleOf(state.userId) ?? '');
  const privacy: Record<string, (args: Record<string, unknown>) => { status: number; body: unknown }> = {
    contact_privacy_summary(args) {
      if (!managerRole()) return refuse('Somente donos e administradores anonimizam contatos.');
      const contact = contactOf(args.p_contact_id);
      if (!contact) return refuse('Este contato não está mais disponível. Atualize a página.');
      const zero = Object.fromEntries(
        [
          'activities_scrubbed',
          'activities_deleted',
          'deals',
          'open_deals',
          'payments',
          'pending_payments',
          'other_records',
        ].map((key) => [key, 0]),
      );
      return {
        status: 200,
        body: {
          version: contact.updated_at,
          anonymized_at: contact.anonymized_at ?? null,
          ...(contact.anonymized_at ? zero : anonymizationPlan(contact).counts),
        },
      };
    },
    anonymize_contact(args) {
      if (!managerRole()) return refuse('Somente donos e administradores anonimizam contatos.');
      const contact = contactOf(args.p_contact_id);
      if (!contact) return refuse('Este contato não está mais disponível. Atualize a página.');
      if (state.touchBeforeNextAnonymization === contact.id) {
        contact.updated_at = new Date().toISOString();
        delete state.touchBeforeNextAnonymization;
      }
      if (contact.anonymized_at) return refuse('Este contato já foi anonimizado.');
      if (contact.updated_at !== args.p_version)
        return refuse('Este contato mudou desde o resumo. Confira o resumo atualizado e confirme de novo.');
      const now = new Date().toISOString();
      const plan = anonymizationPlan(contact);
      state.tables.activities = state.tables.activities.filter((row) => !plan.deleted.includes(row));
      for (const row of plan.scrubbed)
        Object.assign(row, {
          title: `${TYPE_TITLES[String(row.type)] ?? 'Tarefa'} (contato anonimizado)`,
          body: null,
          updated_at: now,
        });
      for (const row of plan.deals)
        Object.assign(row, {
          title: redact(plan.all, row.title),
          lost_reason: redact(plan.all, row.lost_reason),
          contact_id: null,
          updated_at: now,
        });
      for (const row of plan.payments)
        Object.assign(row, {
          description: redact(plan.all, row.description),
          contact_id: row.contact_id === contact.id ? null : row.contact_id,
          updated_at: now,
        });
      for (const row of plan.dealActivities)
        Object.assign(row, { title: redact(plan.all, row.title), body: redact(plan.all, row.body), updated_at: now });
      for (const { table, row } of plan.rest) {
        // Os campos de até 500 caracteres ficam no limite, como no banco.
        const limited = (text: unknown) => {
          const value = redact(plan.strong, text);
          return typeof value === 'string' ? value.slice(0, 500) : value;
        };
        const fields =
          table === 'activities'
            ? { title: redact(plan.strong, row.title), body: redact(plan.strong, row.body) }
            : table === 'deals'
              ? { title: redact(plan.strong, row.title), lost_reason: redact(plan.strong, row.lost_reason) }
              : table === 'payments'
                ? { description: redact(plan.strong, row.description) }
                : table === 'companies'
                  ? { do_not_contact_reason: limited(row.do_not_contact_reason) }
                  : {
                      notes: redact(plan.strong, row.notes),
                      source: redact(plan.strong, row.source),
                      job_title: redact(plan.strong, row.job_title),
                      legal_basis_note: limited(row.legal_basis_note),
                      do_not_contact_reason: limited(row.do_not_contact_reason),
                    };
        Object.assign(row, fields, { updated_at: now });
      }
      Object.assign(contact, {
        first_name: 'Contato anonimizado',
        last_name: null,
        email: null,
        phone: null,
        job_title: null,
        notes: null,
        source: redact(plan.all, contact.source),
        company_id: null,
        do_not_contact: true,
        do_not_contact_at: contact.do_not_contact ? contact.do_not_contact_at : now,
        do_not_contact_by: contact.do_not_contact ? contact.do_not_contact_by : state.userId,
        do_not_contact_reason: null,
        legal_basis_note: null,
        anonymized_at: now,
        anonymized_by: state.userId,
        updated_at: now,
      });
      state.tables.privacy_actions.push({
        id: randomUUID(),
        org_id: IDS.org,
        contact_id: contact.id,
        action: 'anonymize',
        performed_by: state.userId,
        summary: plan.counts,
        created_at: now,
      });
      return { status: 200, body: plan.counts };
    },
    export_contact_data(args) {
      if (!managerRole()) return refuse('Somente donos e administradores exportam os dados de um contato.');
      const contact = contactOf(args.p_contact_id);
      if (!contact) return refuse('Este contato não está mais disponível. Atualize a página.');
      const inOrg = (row: FixtureRow) => row.org_id === IDS.org;
      const deals = state.tables.deals.filter((row) => inOrg(row) && row.contact_id === contact.id);
      const dealIds = new Set(deals.map((row) => row.id));
      const pick = (row: FixtureRow, keys: string[]) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
      // Nos registros das oportunidades dela ligados a outro contato, os termos dele (todos, como na anonimização dele)
      // saem do texto; um contato já anonimizado não tem mais termos a trocar.
      const otherTerms = (row: FixtureRow) => {
        const other = row.contact_id && row.contact_id !== contact.id ? contactOf(row.contact_id) : null;
        return other && !other.anonymized_at ? contactTerms(other).all : null;
      };
      // As atividades com a pessoa e as das oportunidades dela, com o vínculo (sem o outro contato).
      const activities = state.tables.activities
        .filter((row) => inOrg(row) && (row.contact_id === contact.id || dealIds.has(String(row.deal_id))))
        .map((row) => ({
          ...pick(row, ['id', 'type', 'due_date', 'end_date', 'completed_at', 'outcome', 'created_at', 'deal_id']),
          title: redact(otherTerms(row), row.title),
          body: redact(otherTerms(row), row.body ?? null),
          relation: row.contact_id === contact.id ? 'person' : row.contact_id ? 'other_contact' : 'no_contact',
        }));
      const dealRows = deals.map((row) => ({
        ...pick(row, [
          'id',
          'title',
          'value',
          'currency',
          'status',
          'close_date',
          'closed_at',
          'lost_reason',
          'created_at',
        ]),
        pipeline: state.tables.pipelines.find((item) => item.id === row.pipeline_id)?.name ?? null,
        stage: state.tables.pipeline_stages.find((item) => item.id === row.stage_id)?.name ?? null,
      }));
      const payments = state.tables.payments
        .filter((row) => inOrg(row) && (row.contact_id === contact.id || dealIds.has(String(row.deal_id))))
        .map((row) => ({
          ...pick(row, ['id', 'amount', 'currency', 'status', 'due_date', 'paid_at', 'deal_id', 'created_at']),
          description: redact(otherTerms(row), row.description),
        }));
      const now = new Date().toISOString();
      state.tables.privacy_actions.push({
        id: randomUUID(),
        org_id: IDS.org,
        contact_id: contact.id,
        action: 'export',
        performed_by: state.userId,
        summary: { activities: activities.length, deals: dealRows.length, payments: payments.length },
        created_at: now,
      });
      const company = companyOf(contact.company_id);
      return {
        status: 200,
        body: {
          format: 1,
          generated_at: now,
          organization: { name: state.tables.organizations.find((org) => org.id === IDS.org)?.name ?? null },
          contact: pick(contact, [
            'id',
            'first_name',
            'last_name',
            'email',
            'phone',
            'job_title',
            'source',
            'notes',
            'status',
            'created_at',
            'updated_at',
            'legal_basis',
            'legal_basis_note',
            'legal_basis_at',
            'do_not_contact',
            'do_not_contact_at',
            'do_not_contact_reason',
            'anonymized_at',
          ]),
          company: company ? { id: company.id, name: company.name } : null,
          activities,
          deals: dealRows,
          payments,
        },
      };
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
    // Item 1.11: o banco sem a migração do 1.9 ou do 1.10 recusa a coluna que não tem, na leitura e na gravação.
    if (state.missingColumns?.size && !url.pathname.includes('/rpc/')) {
      const columns = [
        ...(url.searchParams.get('select') ?? '').split(','),
        ...(url.searchParams.get('columns') ?? '').replace(/"/g, '').split(','),
        ...(['POST', 'PATCH'].includes(method) ? (Array.isArray(body) ? body : [body ?? {}]).flatMap(Object.keys) : []),
      ];
      const missing = columns.find((column) => state.missingColumns!.has(column.trim()));
      if (missing)
        return respond(
          route,
          { code: '42703', message: `column ${table}.${missing.trim()} does not exist`, details: null, hint: null },
          400,
        );
    }
    if (method === 'POST' && state.beforeWrite && !url.pathname.includes('/rpc/')) {
      const calls = state.requests.filter((item) => item.table === table && item.method === 'POST').length;
      state.beforeWrite(table, calls, (Array.isArray(body) ? body : [body]) as FixtureRow[], state);
    }
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
              subtitle: c.email ?? c.phone ?? 'Contato',
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
      if (table === 'complete_activity') {
        const { status, body: reply } = completeActivity((body ?? {}) as Record<string, unknown>);
        // A conclusão já foi gravada; só a resposta se perde (a repetição devolve o par gravado).
        if (status === 200 && state.loseNextWriteResponse.delete('complete_activity')) return route.abort('failed');
        return respond(route, reply, status);
      }
      if (privacy[table]) {
        (state.privacyCalls ??= []).push({ rpc: table, body: (body ?? {}) as Record<string, unknown> });
        const { status, body: reply } = privacy[table]((body ?? {}) as Record<string, unknown>);
        return respond(route, reply, status);
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
    // Política privacy_actions_manager_read (item 1.10): só donos e administradores leem; ninguém grava pela API.
    if (table === 'privacy_actions') {
      if (!['GET', 'HEAD'].includes(method))
        return respond(route, { code: '42501', message: 'permission denied for table privacy_actions' }, 403);
      if (!['owner', 'admin'].includes(activeRoleOf(state.userId) ?? '')) selected = [];
      // O contato e quem fez, pelas FKs compostas (contact:contacts!…, author:profiles!…), como o PostgREST embute.
      if ((url.searchParams.get('select') ?? '').includes('contact:'))
        selected = selected.map((row) => {
          const contact = contactOf(row.contact_id);
          const author = state.tables.profiles.find((profile) => profile.id === row.performed_by);
          return {
            ...row,
            contact: contact
              ? Object.fromEntries(
                  ['id', 'first_name', 'last_name', 'email', 'phone', 'anonymized_at'].map((key) => [
                    key,
                    contact[key] ?? null,
                  ]),
                )
              : null,
            author: author ? { id: author.id, name: author.name, email: author.email } : null,
          };
        });
    }
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
      if (COLUMN_DEFAULTS[table])
        for (const [position, row] of created.entries()) {
          created[position] = withColumnDefaults(table, row);
          const refusal = channelRules(table, created[position]);
          if (refusal) return respond(route, refusal.body, refusal.status);
        }
      for (const row of created) {
        const refusal = privacyRules(table, row);
        if (refusal) return respond(route, refusal.body, refusal.status);
      }
      // Item 1.2 (refuse_inactive_assignee), emulado desde o 1.11 para contatos e empresas novos: o responsável precisa
      // estar ativo, e a recusa derruba a instrução inteira (o lote da importação), com a mensagem do banco.
      if (['contacts', 'companies'].includes(table))
        for (const row of created)
          if (row.owner_id && !activeRoleOf(String(row.owner_id)))
            return respond(
              route,
              refuse('A pessoa escolhida como responsável foi desativada. Escolha outra pessoa em “Responsável”.').body,
              400,
            );
      // A FK composta (company_id, org_id) dos contatos (revisão do item 1.11, achado 6): a empresa excluída por um
      // colega depois da prévia derruba o lote da importação com 23503, como no banco.
      if (table === 'contacts')
        for (const row of created)
          if (row.company_id && !state.tables.companies.some((company) => company.id === row.company_id))
            return respond(
              route,
              {
                code: '23503',
                message:
                  'insert or update on table "contacts" violates foreign key constraint "contacts_company_id_org_id_fkey"',
                details: null,
                hint: null,
              },
              409,
            );
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
    if (method === 'PATCH') {
      // As regras do banco valem antes de gravar: uma recusa não muda nenhuma linha.
      const updates = selected.map((row) => ({ row, next: { ...row, ...(body as Record<string, unknown>) } }));
      for (const { row, next } of updates) {
        const refusal = channelRules(table, next, row) ?? privacyRules(table, next, row);
        if (refusal) return respond(route, refusal.body, refusal.status);
      }
      for (const { row, next } of updates) {
        const previous = { ...row };
        Object.assign(row, next, { updated_at: new Date().toISOString() });
        if (table === 'deals') applyDealRules(row, previous);
      }
    }
    if (method === 'DELETE') {
      state.tables[table] = tableRows.filter((row) => !selected.includes(row));
      // ON DELETE SET NULL (coluna) de automation_logs: o log fica, sem o vínculo excluído.
      const logLink = ({ activities: 'activity_id', automations: 'automation_id' } as Record<string, string>)[table];
      if (logLink)
        for (const log of state.tables.automation_logs)
          if (selected.some((row) => row.id === log[logLink])) log[logLink] = null;
      // Item 1.10: excluir um contato deixa o registro de privacidade, sem o vínculo.
      if (table === 'contacts')
        for (const action of state.tables.privacy_actions)
          if (selected.some((row) => row.id === action.contact_id)) action.contact_id = null;
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

/**
 * Importação de planilha (item 1.11) sobre a fixture: a equipe de `withTeam`, com o Fulano Vendedor desativado, e os
 * contatos da fixture de importação (scripts/lib/import-fixture.mjs) com telefones gravados nos formatos antigos.
 */
export function withContactImport(state: FixtureState) {
  withTeam(state);
  const fulano = state.tables.user_roles.find((row) => row.user_id === IDS.leaving)!;
  fulano.deactivated_at = dayAt(-1);
  const old = dayAt(-20);
  for (const contact of IMPORT_FIXTURE_EXISTING)
    state.tables.contacts.push(
      withColumnDefaults('contacts', {
        id: randomUUID(),
        org_id: IDS.org,
        ...contact,
        company_id: null,
        owner_id: IDS.owner,
        status: 'lead',
        job_title: null,
        source: null,
        notes: null,
        created_at: old,
        updated_at: old,
      }),
    );
  return state;
}

/** Registros dos canais (item 1.9), acrescentados por `withChannels`. */
export const CHANNEL_IDS = {
  company: 'cccccccc-0000-4000-8000-000000000001',
  ana: 'cccccccc-0000-4000-8000-000000000002',
  bruno: 'cccccccc-0000-4000-8000-000000000003',
  carla: 'cccccccc-0000-4000-8000-000000000004',
  diego: 'cccccccc-0000-4000-8000-000000000005',
  deal: 'cccccccc-0000-4000-8000-000000000006',
  call: 'cccccccc-0000-4000-8000-000000000007',
  firstTemplate: 'cccccccc-0000-4000-8000-000000000008',
  unknownTemplate: 'cccccccc-0000-4000-8000-000000000009',
  // Achado 3 da revisão do item 1.9: um número de outro país em E.164.
  gina: 'cccccccc-0000-4000-8000-00000000000a',
} as const;

/**
 * Canais do item 1.9 sobre a fixture: a empresa Padaria Boa Massa (fixo em E.164); Ana Souza, contato dela, com celular
 * em E.164 e e-mail, uma oportunidade em aberto e uma ligação pendente para hoje; Bruno Fixo, com o fixo digitado à mão
 * e sem e-mail; Carla Marcada, marcada "Não contatar" pelo dono, com motivo; Diego Sem Telefone, sem telefone e com um
 * e-mail sem domínio completo; Gina Exterior, com um celular dos Estados Unidos em E.164 (achado 3 da revisão do 1.9); e
 * dois modelos, um com as variáveis do CRM e outro com uma desconhecida.
 */
export function withChannels(state: FixtureState) {
  const old = dayAt(-10);
  const base = { org_id: IDS.org, created_at: old, updated_at: old };
  const contact = (fields: Record<string, unknown>): FixtureRow =>
    withColumnDefaults('contacts', {
      ...base,
      last_name: null,
      email: null,
      phone: null,
      company_id: null,
      owner_id: IDS.owner,
      status: 'lead',
      job_title: null,
      source: null,
      notes: null,
      ...fields,
    } as unknown as FixtureRow);
  state.tables.companies.push(
    withColumnDefaults('companies', {
      id: CHANNEL_IDS.company,
      ...base,
      name: 'Padaria Boa Massa',
      domain: null,
      industry: 'Alimentação',
      size: null,
      revenue: null,
      website: null,
      linkedin_url: null,
      owner_id: IDS.owner,
      phone: '+551130000000',
    }),
  );
  state.tables.contacts.push(
    contact({
      id: CHANNEL_IDS.ana,
      first_name: 'Ana',
      last_name: 'Souza',
      email: 'ana.souza@example.test',
      phone: '+5511999990000',
      company_id: CHANNEL_IDS.company,
    }),
    contact({ id: CHANNEL_IDS.bruno, first_name: 'Bruno', last_name: 'Fixo', phone: '(11) 3000-0000' }),
    contact({
      id: CHANNEL_IDS.carla,
      first_name: 'Carla',
      last_name: 'Marcada',
      email: 'carla@example.test',
      phone: '+5511988887777',
      do_not_contact: true,
      do_not_contact_at: dayAt(-1),
      do_not_contact_by: IDS.owner,
      do_not_contact_reason: 'Pediu para parar de receber mensagens.',
    }),
    contact({ id: CHANNEL_IDS.diego, first_name: 'Diego', last_name: 'Sem Telefone', email: 'diego@empresa' }),
    contact({ id: CHANNEL_IDS.gina, first_name: 'Gina', last_name: 'Exterior', phone: '+14155550100' }),
  );
  const deal = state.tables.deals.find((row) => row.id === IDS.deal)!;
  state.tables.deals.push({
    ...deal,
    id: CHANNEL_IDS.deal,
    title: 'Site novo',
    contact_id: CHANNEL_IDS.ana,
    company_id: CHANNEL_IDS.company,
    owner_id: IDS.owner,
    value: 3000,
  });
  state.tables.activities.push(
    withColumnDefaults('activities', {
      id: CHANNEL_IDS.call,
      ...base,
      title: 'Ligar para a Ana',
      type: 'call',
      body: 'Apresentar a proposta.',
      due_date: dayAt(0, 23),
      end_date: null,
      completed_at: null,
      contact_id: CHANNEL_IDS.ana,
      company_id: CHANNEL_IDS.company,
      deal_id: CHANNEL_IDS.deal,
      user_id: IDS.owner,
      created_by: IDS.owner,
    }),
  );
  state.tables.email_templates.push(
    {
      id: CHANNEL_IDS.firstTemplate,
      ...base,
      name: 'Primeiro contato',
      subject: 'Proposta para a {{empresa}}',
      body: 'Olá, {{primeiro_nome}}! Aqui é {{meu_nome}}, da {{organizacao}}. Podemos falar sobre {{oportunidade}}?',
    },
    {
      id: CHANNEL_IDS.unknownTemplate,
      ...base,
      name: 'Com cupom',
      subject: '',
      body: 'Olá, {{primeiro_nome}}. Use o cupom {{cupom}}.',
    },
  );
  return state;
}

/** Registros da privacidade (item 1.10), acrescentados por `withPrivacy`. */
export const PRIVACY_IDS = {
  company: 'dddddddd-0000-4000-8000-000000000001',
  helena: 'dddddddd-0000-4000-8000-000000000002',
  igor: 'dddddddd-0000-4000-8000-000000000003',
  marta: 'dddddddd-0000-4000-8000-000000000004',
  anonymized: 'dddddddd-0000-4000-8000-000000000005',
  deal: 'dddddddd-0000-4000-8000-000000000006',
  martaDeal: 'dddddddd-0000-4000-8000-000000000007',
  done: 'dddddddd-0000-4000-8000-000000000008',
  pending: 'dddddddd-0000-4000-8000-000000000009',
  note: 'dddddddd-0000-4000-8000-00000000000a',
  igorTask: 'dddddddd-0000-4000-8000-00000000000b',
  martaTask: 'dddddddd-0000-4000-8000-00000000000c',
  payment: 'dddddddd-0000-4000-8000-00000000000d',
  dealTask: 'dddddddd-0000-4000-8000-00000000000e',
} as const;

/**
 * Privacidade do item 1.10 sobre a fixture: o padrão da empresa "Legítimo interesse"; Helena Duarte, do Ateliê Aurora,
 * com consentimento registrado pelo dono, uma ligação concluída e uma nota com o nome dela, um WhatsApp pendente, a
 * oportunidade "Proposta Helena Duarte", com uma tarefa sem contato, e o recebimento "Entrada Helena Duarte"; Igor
 * Lima, cujas observações, a origem e uma tarefa citam o nome completo de Helena (os outros registros da anonimização);
 * Marta Marcada, com "Não contatar", uma
 * oportunidade e uma tarefa pendente; e um contato já anonimizado, com uma ligação que ficou com ele.
 */
export function withPrivacy(state: FixtureState) {
  const old = dayAt(-10);
  const base = { org_id: IDS.org, created_at: old, updated_at: old };
  Object.assign(
    state.tables.organizations.find((row) => row.id === IDS.org)!,
    {
      default_legal_basis: 'legitimate_interest',
      default_legal_basis_at: old,
      default_legal_basis_by: IDS.owner,
    },
  );
  const contact = (fields: Record<string, unknown>): FixtureRow =>
    withColumnDefaults('contacts', {
      ...base,
      last_name: null,
      email: null,
      phone: null,
      company_id: null,
      owner_id: IDS.owner,
      status: 'lead',
      job_title: null,
      source: null,
      notes: null,
      legal_basis: 'legitimate_interest',
      legal_basis_at: old,
      legal_basis_by: IDS.owner,
      ...fields,
    } as unknown as FixtureRow);
  const activity = (fields: Record<string, unknown>): FixtureRow =>
    withColumnDefaults('activities', {
      ...base,
      body: null,
      due_date: dayAt(-2),
      end_date: null,
      completed_at: null,
      company_id: null,
      deal_id: null,
      user_id: IDS.owner,
      created_by: IDS.owner,
      ...fields,
    } as unknown as FixtureRow);
  state.tables.companies.push(
    withColumnDefaults('companies', {
      id: PRIVACY_IDS.company,
      ...base,
      name: 'Ateliê Aurora',
      domain: null,
      industry: 'Design',
      size: null,
      revenue: null,
      website: null,
      linkedin_url: null,
      owner_id: IDS.owner,
      phone: null,
    }),
  );
  state.tables.contacts.push(
    contact({
      id: PRIVACY_IDS.helena,
      first_name: 'Helena',
      last_name: 'Duarte',
      email: 'helena.duarte@example.test',
      phone: '+5511977776666',
      company_id: PRIVACY_IDS.company,
      job_title: 'Arquiteta',
      notes: 'Prefere contato à tarde.',
      legal_basis: 'consent',
      legal_basis_note: 'Marcou a caixa do formulário do site em 01/10/2026.',
    }),
    contact({
      id: PRIVACY_IDS.igor,
      first_name: 'Igor',
      last_name: 'Lima',
      email: 'igor.lima@example.test',
      source: 'Indicação de Helena Duarte',
      notes: 'Indicado por Helena Duarte.',
    }),
    contact({
      id: PRIVACY_IDS.marta,
      first_name: 'Marta',
      last_name: 'Marcada',
      email: 'marta@example.test',
      phone: '+5511966665555',
      do_not_contact: true,
      do_not_contact_at: dayAt(-1),
      do_not_contact_by: IDS.owner,
      do_not_contact_reason: 'Pediu para não receber ligações.',
    }),
    contact({
      id: PRIVACY_IDS.anonymized,
      first_name: 'Contato anonimizado',
      do_not_contact: true,
      do_not_contact_at: dayAt(-3),
      do_not_contact_by: IDS.owner,
      anonymized_at: dayAt(-3),
      anonymized_by: IDS.owner,
    }),
  );
  const deal = state.tables.deals.find((row) => row.id === IDS.deal)!;
  state.tables.deals.push(
    {
      ...deal,
      id: PRIVACY_IDS.deal,
      title: 'Proposta Helena Duarte',
      contact_id: PRIVACY_IDS.helena,
      company_id: PRIVACY_IDS.company,
      value: 5000,
    },
    {
      ...deal,
      id: PRIVACY_IDS.martaDeal,
      title: 'Renovação da Marta',
      contact_id: PRIVACY_IDS.marta,
      company_id: null,
      value: 1800,
    },
  );
  state.tables.activities.push(
    activity({
      id: PRIVACY_IDS.done,
      title: 'Ligação para Helena Duarte',
      type: 'call',
      body: 'Helena pediu a proposta por e-mail.',
      due_date: dayAt(-1, 15),
      completed_at: dayAt(-1, 15),
      outcome: 'answered',
      contact_id: PRIVACY_IDS.helena,
      company_id: PRIVACY_IDS.company,
      deal_id: PRIVACY_IDS.deal,
    }),
    activity({
      id: PRIVACY_IDS.pending,
      title: 'WhatsApp para Helena',
      type: 'whatsapp',
      due_date: dayAt(1, 9),
      contact_id: PRIVACY_IDS.helena,
      company_id: PRIVACY_IDS.company,
      deal_id: PRIVACY_IDS.deal,
    }),
    activity({
      id: PRIVACY_IDS.note,
      title: 'Helena gostou do portfólio',
      type: 'note',
      due_date: null,
      completed_at: dayAt(-2),
      contact_id: PRIVACY_IDS.helena,
    }),
    activity({
      id: PRIVACY_IDS.dealTask,
      title: 'Revisar a proposta com o financeiro',
      type: 'task',
      due_date: dayAt(2, 11),
      company_id: PRIVACY_IDS.company,
      deal_id: PRIVACY_IDS.deal,
    }),
    activity({
      id: PRIVACY_IDS.igorTask,
      title: 'Contar ao Igor sobre Helena Duarte',
      type: 'task',
      due_date: dayAt(2, 10),
      contact_id: PRIVACY_IDS.igor,
    }),
    activity({
      id: PRIVACY_IDS.martaTask,
      title: 'Preparar o contrato da Marta',
      type: 'task',
      due_date: dayAt(3, 10),
      contact_id: PRIVACY_IDS.marta,
      deal_id: PRIVACY_IDS.martaDeal,
    }),
    activity({
      id: randomUUID(),
      title: 'Ligação (contato anonimizado)',
      type: 'call',
      due_date: dayAt(-4),
      completed_at: dayAt(-4),
      outcome: 'no_answer',
      contact_id: PRIVACY_IDS.anonymized,
    }),
  );
  state.tables.payments.push({
    id: PRIVACY_IDS.payment,
    ...base,
    deal_id: PRIVACY_IDS.deal,
    contact_id: PRIVACY_IDS.helena,
    description: 'Entrada Helena Duarte',
    amount: 1500,
    currency: 'BRL',
    due_date: dayAt(5).slice(0, 10),
    paid_at: null,
    status: 'pending',
    payment_method: null,
    notes: null,
  });
  return state;
}
