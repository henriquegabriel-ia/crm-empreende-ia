import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Team from './Team';

const NEW_ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const mock = vi.hoisted(() => ({
  roles: ['owner'] as string[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpc: vi.fn(),
  writes: [] as { table: string; method: string }[],
}));
vi.mock('@/integrations/supabase/crm-client', () => {
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: () => Promise.resolve({ data: mock.tables[table] ?? [], error: null }),
      insert: () => {
        mock.writes.push({ table, method: 'insert' });
        return chain;
      },
      delete: () => {
        mock.writes.push({ table, method: 'delete' });
        return chain;
      },
      single: () => Promise.resolve({ data: { id: 'x' }, error: null }),
    };
    return chain;
  };
  return { crmDb: { from, rpc: mock.rpc } };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'user-1', org_id: 'org-a' } }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({
    roles: mock.roles,
    canManage: mock.roles.some((role) => role === 'owner' || role === 'admin'),
    loading: false,
  }),
}));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }));

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const invitation = (id: string, email: string, role: string, expires_at: string) => ({
  id,
  org_id: 'org-a',
  email,
  role,
  expires_at,
  accepted_at: null,
  created_at: past,
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Team />
    </QueryClientProvider>,
  );
}
const inviteForm = () => screen.getByRole('heading', { name: 'Convidar uma pessoa' }).closest('section')!;
const roleOptions = () =>
  within(screen.getByLabelText('Papel do convite'))
    .getAllByRole('option')
    .map((option) => option.textContent);

beforeEach(() => {
  mock.roles = ['owner'];
  mock.tables = {
    profiles: [{ id: 'user-1', org_id: 'org-a', name: 'Pessoa Dona', email: 'dona@example.test' }],
    user_roles: [{ id: 'r1', org_id: 'org-a', user_id: 'user-1', role: 'owner' }],
    invitations: [
      invitation('11111111-1111-4111-8111-111111111111', 'valida@example.test', 'member', future),
      invitation('22222222-2222-4222-8222-222222222222', 'vencida@example.test', 'viewer', past),
      invitation('33333333-3333-4333-8333-333333333333', 'socia@example.test', 'owner', past),
    ],
  };
  mock.rpc.mockReset().mockResolvedValue({ data: NEW_ID, error: null });
  mock.writes = [];
});

describe('convites da Equipe (item 1.1)', () => {
  it('o dono pode convidar como Dono, com o aviso do papel', async () => {
    setup();
    await screen.findByText('Pessoa Dona (você)');
    expect(roleOptions()).toEqual(['Colaborador', 'Somente leitura', 'Administrador', 'Dono']);
    fireEvent.change(screen.getByLabelText('Papel do convite'), { target: { value: 'owner' } });
    expect(screen.getByText(/Dono tem todos os poderes, inclusive alterar o papel de outros donos/)).toBeVisible();
  });

  it('o administrador não vê a opção Dono', async () => {
    mock.roles = ['admin'];
    setup();
    await screen.findByText('Pessoa Dona (você)');
    expect(roleOptions()).toEqual(['Colaborador', 'Somente leitura', 'Administrador']);
  });

  // O campo de e-mail tira os espaços das pontas; a RPC normaliza maiúsculas (e espaços, se vierem pela API).
  it('cria o convite pela RPC, com o e-mail e o papel, e mostra o link', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('E-mail da pessoa'), { target: { value: ' Nova@Example.test ' } });
    fireEvent.change(screen.getByLabelText('Papel do convite'), { target: { value: 'admin' } });
    fireEvent.click(within(inviteForm()).getByRole('button', { name: 'Criar convite' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Link do convite')).toHaveValue(`${window.location.origin}/?invite=${NEW_ID}`),
    );
    expect(mock.rpc).toHaveBeenCalledWith('create_invitation', { p_email: 'Nova@Example.test', p_role: 'admin' });
    expect(screen.getByLabelText('E-mail da pessoa')).toHaveValue('');
    expect(mock.writes.filter((write) => write.method === 'insert')).toEqual([]);
  });

  it('a recusa do banco aparece junto do formulário, ligada ao botão, e o preenchimento fica', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message:
          'Já existe um convite válido para este e-mail. Copie o link na lista de convites ou revogue-o antes de criar outro.',
      },
    });
    setup();
    fireEvent.change(await screen.findByLabelText('E-mail da pessoa'), { target: { value: 'valida@example.test' } });
    fireEvent.click(within(inviteForm()).getByRole('button', { name: 'Criar convite' }));
    const alert = await within(inviteForm()).findByRole('alert');
    expect(alert).toHaveTextContent('Já existe um convite válido para este e-mail.');
    expect(screen.getAllByRole('alert')).toEqual([alert]);
    // Logo depois do formulário, antes da lista de convites.
    expect(inviteForm().querySelector('form')!.nextElementSibling).toBe(alert);
    expect(within(inviteForm()).getByRole('button', { name: 'Criar convite' })).toHaveAccessibleDescription(
      'Já existe um convite válido para este e-mail. Copie o link na lista de convites ou revogue-o antes de criar outro.',
    );
    expect(screen.getByLabelText('E-mail da pessoa')).toHaveValue('valida@example.test');
  });

  it('a recusa de "Gerar novo link" aparece sobre a lista de convites', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'Esta pessoa já faz parte da equipe.' },
    });
    setup();
    const expired = (await screen.findByText('vencida@example.test')).parentElement!.parentElement!;
    fireEvent.click(within(expired).getByRole('button', { name: 'Gerar novo link' }));
    const alert = await within(inviteForm()).findByRole('alert');
    expect(alert).toHaveTextContent('Esta pessoa já faz parte da equipe.');
    expect(alert.nextElementSibling).toContainElement(expired);
    expect(within(inviteForm()).getByRole('button', { name: 'Criar convite' })).not.toHaveAttribute('aria-describedby');
  });

  it('uma falha técnica não mostra texto em inglês', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    setup();
    fireEvent.change(await screen.findByLabelText('E-mail da pessoa'), { target: { value: 'nova@example.test' } });
    fireEvent.click(within(inviteForm()).getByRole('button', { name: 'Criar convite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível criar o convite. Seu preenchimento foi preservado.',
    );
  });

  it('o convite expirado troca "Copiar" por "Gerar novo link", que cria outro com o mesmo e-mail e papel', async () => {
    setup();
    const expired = (await screen.findByText('vencida@example.test')).parentElement!.parentElement!;
    expect(within(expired).getByText(/Expirado/)).toBeVisible();
    expect(within(expired).queryByRole('button', { name: 'Copiar' })).not.toBeInTheDocument();
    const valid = screen.getByText('valida@example.test').parentElement!.parentElement!;
    expect(within(valid).getByRole('button', { name: 'Copiar' })).toBeInTheDocument();
    expect(within(valid).queryByRole('button', { name: 'Gerar novo link' })).not.toBeInTheDocument();
    fireEvent.click(within(expired).getByRole('button', { name: 'Gerar novo link' }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith('create_invitation', { p_email: 'vencida@example.test', p_role: 'viewer' }),
    );
    expect(await screen.findByLabelText('Link do convite')).toHaveValue(`${window.location.origin}/?invite=${NEW_ID}`);
  });

  it('o dono renova o convite de dono expirado', async () => {
    setup();
    const ownerInvite = (await screen.findByText('socia@example.test')).parentElement!.parentElement!;
    expect(within(ownerInvite).getByRole('button', { name: 'Gerar novo link' })).toBeInTheDocument();
  });

  it('o administrador não vê "Gerar novo link" num convite de dono', async () => {
    mock.roles = ['admin'];
    setup();
    const ownerInvite = (await screen.findByText('socia@example.test')).parentElement!.parentElement!;
    expect(within(ownerInvite).queryByRole('button', { name: 'Gerar novo link' })).not.toBeInTheDocument();
    expect(within(ownerInvite).getByRole('button', { name: 'Revogar' })).toBeInTheDocument();
    const expired = screen.getByText('vencida@example.test').parentElement!.parentElement!;
    expect(within(expired).getByRole('button', { name: 'Gerar novo link' })).toBeInTheDocument();
  });

  // O que cada papel faz, nas mesmas palavras da Ajuda ("O que cada papel pode fazer?"): o dono convida donos, o
  // administrador não mexe em donos, o colaborador não exclui e o somente leitura só consulta.
  it('mostra o que cada papel faz, na lista e ao alterar o papel', async () => {
    mock.tables.profiles = [
      ...mock.tables.profiles,
      { id: 'user-2', org_id: 'org-a', name: 'Pessoa Admin', email: 'admin@example.test' },
      { id: 'user-3', org_id: 'org-a', name: 'Pessoa Colaboradora', email: 'colab@example.test' },
      { id: 'user-4', org_id: 'org-a', name: 'Pessoa Leitora', email: 'leitora@example.test' },
    ];
    mock.tables.user_roles = [
      ...mock.tables.user_roles,
      { id: 'r2', org_id: 'org-a', user_id: 'user-2', role: 'admin' },
      { id: 'r3', org_id: 'org-a', user_id: 'user-3', role: 'member' },
      { id: 'r4', org_id: 'org-a', user_id: 'user-4', role: 'viewer' },
    ];
    setup();
    const copy = {
      owner:
        'Faz tudo o que o administrador faz e também convida donos, altera o papel de outros donos e desativa ou reativa donos.',
      admin:
        'Convida pessoas, altera papéis, desativa e reativa pessoas (menos donos), configura o CRM, o catálogo e as automações, exporta contatos e reuniões, exporta e anonimiza os dados de um contato e exclui registros.',
      member:
        'Cria e edita contatos, empresas, oportunidades (com os itens), atividades, lançamentos e modelos e importa contatos. Não exclui registros nem altera configurações.',
      viewer: 'Consulta os registros. Não cria nem altera dados ou configurações.',
    };
    const card = async (name: string) => (await screen.findByText(name)).closest('article')!;
    expect(await card('Pessoa Dona (você)')).toHaveTextContent(copy.owner);
    expect(await card('Pessoa Admin')).toHaveTextContent(copy.admin);
    expect(await card('Pessoa Colaboradora')).toHaveTextContent(copy.member);
    expect(await card('Pessoa Leitora')).toHaveTextContent(copy.viewer);
    fireEvent.click(within(await card('Pessoa Leitora')).getByRole('button', { name: 'Alterar papel' }));
    const dialog = screen.getByRole('dialog', { name: 'Alterar permissão' });
    expect(dialog).toHaveTextContent(copy.viewer);
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'member' } });
    expect(dialog).toHaveTextContent(copy.member);
  });

  it('colaborador e somente leitura não leem convites nem veem o formulário', async () => {
    mock.roles = ['member'];
    setup();
    await screen.findByText('Pessoa Dona (você)');
    expect(screen.queryByRole('heading', { name: 'Convidar uma pessoa' })).not.toBeInTheDocument();
    expect(screen.queryByText('valida@example.test')).not.toBeInTheDocument();
  });
});

describe('pessoas ativas e desativadas (item 1.2)', () => {
  const people = [
    { id: 'user-1', org_id: 'org-a', name: 'Pessoa Dona', email: 'dona@example.test' },
    { id: 'user-2', org_id: 'org-a', name: 'Segunda Dona', email: 'socia@example.test' },
    { id: 'user-3', org_id: 'org-a', name: 'Pessoa Admin', email: 'admin@example.test' },
    { id: 'user-4', org_id: 'org-a', name: 'Pessoa Colaboradora', email: 'colab@example.test' },
    { id: 'user-5', org_id: 'org-a', name: 'Fulano', email: 'fulano@example.test' },
    { id: 'user-6', org_id: 'org-a', name: 'Dona Antiga', email: 'antiga@example.test' },
  ];
  const memberRoles = [
    { id: 'r1', org_id: 'org-a', user_id: 'user-1', role: 'owner', deactivated_at: null },
    { id: 'r2', org_id: 'org-a', user_id: 'user-2', role: 'owner', deactivated_at: null },
    { id: 'r3', org_id: 'org-a', user_id: 'user-3', role: 'admin', deactivated_at: null },
    { id: 'r4', org_id: 'org-a', user_id: 'user-4', role: 'member', deactivated_at: null },
    { id: 'r5', org_id: 'org-a', user_id: 'user-5', role: 'member', deactivated_at: '2026-10-13T15:00:00.000Z' },
    { id: 'r6', org_id: 'org-a', user_id: 'user-6', role: 'owner', deactivated_at: '2026-10-12T15:00:00.000Z' },
  ];
  const transfer = (overrides: Record<string, unknown>) => ({
    org_id: 'org-a',
    performed_by: 'user-1',
    deactivation: true,
    accounts_transferred: true,
    deals: 0,
    activities: 0,
    contacts: 0,
    companies: 0,
    invitations: 0,
    ...overrides,
  });
  beforeEach(() => {
    mock.tables.profiles = people;
    mock.tables.user_roles = memberRoles;
    mock.tables.portfolio_transfers = [
      transfer({
        id: 't1',
        from_user_id: 'user-5',
        to_user_id: 'user-4',
        deals: 3,
        activities: 5,
        contacts: 12,
        companies: 2,
        invitations: 1,
        created_at: '2026-10-13T15:00:00.000Z',
      }),
      transfer({ id: 't0', from_user_id: 'user-6', to_user_id: null, created_at: '2026-10-12T15:00:00.000Z' }),
    ];
  });
  const card = async (name: string) => (await screen.findByText(name)).closest('article')!;
  const section = (title: RegExp) => screen.getByRole('heading', { name: title }).closest('section')!;

  it('separa as pessoas ativas das desativadas, com a marca e a data', async () => {
    setup();
    await screen.findByText('Pessoa Dona (você)');
    expect(screen.getByRole('heading', { name: 'Pessoas ativas (4)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pessoas desativadas (2)' })).toBeInTheDocument();
    const deactivated = section(/Pessoas desativadas/);
    expect(deactivated).toHaveTextContent(
      'Quem foi desativado não entra mais no CRM. O nome continua no histórico, com a marca “(desativado)”.',
    );
    expect(within(deactivated).getByText('Fulano (desativado)').closest('article')).toHaveTextContent(
      'Acesso desativado em 13/10/2026',
    );
    expect(within(section(/Pessoas ativas/)).queryByText(/Fulano/)).not.toBeInTheDocument();
  });

  it('o dono desativa qualquer outra pessoa, nunca o próprio acesso, e vê a passagem e as ações nos desativados', async () => {
    setup();
    expect(
      within(await card('Pessoa Dona (você)')).queryByRole('button', { name: 'Desativar' }),
    ).not.toBeInTheDocument();
    for (const name of ['Segunda Dona', 'Pessoa Admin', 'Pessoa Colaboradora'])
      expect(within(await card(name)).getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    const fulano = await card('Fulano (desativado)');
    expect(fulano).toHaveTextContent(
      'Carteira passada por Pessoa Dona para Pessoa Colaboradora: 3 oportunidades em aberto, 5 atividades pendentes, 12 contatos e 2 empresas. 1 convite revogado.',
    );
    expect(within(fulano).getByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(within(fulano).getByRole('button', { name: 'Passar carteira' })).toBeInTheDocument();
    const antiga = await card('Dona Antiga (desativado)');
    expect(antiga).toHaveTextContent('Sem carteira para passar.');
    expect(within(antiga).getByRole('button', { name: 'Reativar' })).toBeInTheDocument();
  });

  it('com os contatos e as empresas mantidos na desativação, o resumo diz que eles ficaram com a pessoa', async () => {
    mock.tables.portfolio_transfers = [
      transfer({
        id: 't2',
        from_user_id: 'user-5',
        to_user_id: null,
        accounts_transferred: false,
        created_at: '2026-10-13T15:00:00.000Z',
      }),
      transfer({
        id: 't3',
        from_user_id: 'user-6',
        to_user_id: 'user-4',
        accounts_transferred: false,
        deals: 2,
        created_at: '2026-10-12T15:00:00.000Z',
      }),
    ];
    setup();
    const fulano = await card('Fulano (desativado)');
    expect(fulano).toHaveTextContent(
      'Nada foi passado. Os contatos e as empresas ficaram com a pessoa. Use “Passar carteira” para passar esses registros.',
    );
    expect(fulano).not.toHaveTextContent('Sem carteira para passar.');
    expect(await card('Dona Antiga (desativado)')).toHaveTextContent(
      'Carteira passada por Pessoa Dona para Pessoa Colaboradora: 2 oportunidades em aberto. Os contatos e as empresas ficaram com a pessoa.',
    );
  });

  // Achados 1 e 4 da revisão do item 1.2 (corrigidos no item 1.6): o perfil da organização sem papel nenhum (gravado
  // por SQL depois da migração) aparece entre os desativados, e a reativação sugere Somente leitura.
  it.each([['owner'], ['admin']])(
    'o perfil sem papel aparece em "Pessoas desativadas" com "Sem papel ativo", e %s reativa como Somente leitura',
    async (role) => {
      mock.roles = [role];
      mock.tables.profiles = [
        ...people,
        { id: 'user-7', org_id: 'org-a', name: 'Sem Papel', email: 'sempapel@example.test' },
      ];
      setup();
      const orphan = await card('Sem Papel (desativado)');
      expect(orphan.closest('section')).toBe(section(/Pessoas desativadas/));
      expect(screen.getByRole('heading', { name: 'Pessoas desativadas (3)' })).toBeInTheDocument();
      expect(orphan).toHaveTextContent('Sem papel ativo');
      expect(within(orphan).getByRole('button', { name: 'Passar carteira' })).toBeInTheDocument();
      fireEvent.click(within(orphan).getByRole('button', { name: 'Reativar' }));
      const dialog = await screen.findByRole('dialog', { name: 'Reativar Sem Papel' });
      expect(within(dialog).getByLabelText('Novo papel')).toHaveValue('viewer');
    },
  );

  it('o administrador não desativa nem reativa donos', async () => {
    mock.roles = ['admin'];
    setup();
    const owner = await card('Segunda Dona');
    expect(within(owner).queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
    expect(within(owner).queryByRole('button', { name: 'Alterar papel' })).not.toBeInTheDocument();
    expect(within(await card('Pessoa Colaboradora')).getByRole('button', { name: 'Desativar' })).toBeInTheDocument();
    const antiga = await card('Dona Antiga (desativado)');
    expect(within(antiga).queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument();
    expect(within(antiga).getByRole('button', { name: 'Passar carteira' })).toBeInTheDocument();
    expect(within(await card('Fulano (desativado)')).getByRole('button', { name: 'Reativar' })).toBeInTheDocument();
  });

  it.each([['member'], ['viewer']])(
    'o papel %s vê as duas listas sem ações e sem os detalhes da passagem',
    async (role) => {
      mock.roles = [role];
      setup();
      await screen.findByText('Pessoa Dona (você)');
      expect(
        screen.getByText(/Convidar pessoas, alterar papéis e desativar acessos fica com donos e administradores/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Passar carteira' })).not.toBeInTheDocument();
      expect(await card('Fulano (desativado)')).toHaveTextContent('Acesso desativado em 13/10/2026');
      expect(screen.queryByText(/Carteira passada/)).not.toBeInTheDocument();
    },
  );

  it('cada convite diz quem o criou: a pessoa, "(desativado)" ou o painel do Supabase', async () => {
    mock.tables.invitations = [
      {
        ...invitation('a1', 'por-dona@example.test', 'member', future),
        invited_by: 'user-1',
        created_at: '2026-10-10T15:00:00Z',
      },
      {
        ...invitation('a2', 'por-fulano@example.test', 'viewer', future),
        invited_by: 'user-5',
        created_at: '2026-10-11T15:00:00Z',
      },
      {
        ...invitation('a3', 'pelo-painel@example.test', 'owner', future),
        invited_by: null,
        created_at: '2026-10-12T15:00:00Z',
      },
    ];
    setup();
    const row = async (email: string) => (await screen.findByText(email)).parentElement!;
    expect(await row('por-dona@example.test')).toHaveTextContent('Criado por Pessoa Dona em 10/10/2026');
    expect(await row('por-fulano@example.test')).toHaveTextContent('Criado por Fulano (desativado) em 11/10/2026');
    expect(await row('pelo-painel@example.test')).toHaveTextContent('Criado pelo painel do Supabase em 12/10/2026');
  });

  it('ao alterar o papel, avisa quais convites pendentes da pessoa serão revogados', async () => {
    mock.tables.invitations = [
      { ...invitation('b1', 'dono-pela-segunda@example.test', 'owner', future), invited_by: 'user-2' },
      { ...invitation('b2', 'colab-pela-segunda@example.test', 'member', future), invited_by: 'user-2' },
      { ...invitation('b3', 'aceito@example.test', 'member', future), invited_by: 'user-2', accepted_at: past },
    ];
    setup();
    fireEvent.click(within(await card('Segunda Dona')).getByRole('button', { name: 'Alterar papel' }));
    const dialog = screen.getByRole('dialog', { name: 'Alterar permissão' });
    expect(within(dialog).queryByText(/será revogado|serão revogados/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'admin' } });
    expect(dialog).toHaveTextContent(
      'O convite pendente criado por Segunda Dona será revogado, porque o novo papel não permite criá-lo.',
    );
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'viewer' } });
    expect(dialog).toHaveTextContent(
      'Os 2 convites pendentes criados por Segunda Dona serão revogados, porque o novo papel não permite criá-los.',
    );
  });

  it('a recusa do banco ao alterar o papel aparece no diálogo, ligada ao botão', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'Mantenha pelo menos um dono ativo na organização.' },
    });
    setup();
    fireEvent.click(within(await card('Pessoa Dona (você)')).getByRole('button', { name: 'Alterar papel' }));
    const dialog = screen.getByRole('dialog', { name: 'Alterar permissão' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'admin' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar alteração' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Mantenha pelo menos um dono ativo na organização.');
    expect(within(dialog).getByRole('button', { name: 'Confirmar alteração' })).toHaveAccessibleDescription(
      'Mantenha pelo menos um dono ativo na organização.',
    );
    expect(mock.rpc).toHaveBeenCalledWith('set_member_role', { p_user_id: 'user-1', p_role: 'admin' });
  });

  it('"Desativar", "Passar carteira" e "Reativar" abrem os seus diálogos', async () => {
    mock.rpc.mockImplementation(async (name: string) =>
      name === 'member_portfolio'
        ? { data: [{ deals: 1, activities: 0, contacts: 0, companies: 0, invitations: 0 }], error: null }
        : { data: null, error: null },
    );
    setup();
    fireEvent.click(within(await card('Pessoa Colaboradora')).getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByRole('dialog', { name: 'Desativar Pessoa Colaboradora' })).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('member_portfolio', { p_user_id: 'user-4' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(within(await card('Fulano (desativado)')).getByRole('button', { name: 'Passar carteira' }));
    expect(await screen.findByRole('dialog', { name: 'Passar a carteira de Fulano' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(within(await card('Fulano (desativado)')).getByRole('button', { name: 'Reativar' }));
    expect(await screen.findByRole('dialog', { name: 'Reativar Fulano' })).toBeInTheDocument();
  });
});
