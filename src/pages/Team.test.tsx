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
      owner: 'Faz tudo o que o administrador faz e também convida donos e altera o papel de outros donos.',
      admin:
        'Convida pessoas, altera papéis (menos o de donos), configura o CRM e as automações, exporta dados e exclui registros.',
      member:
        'Cria e edita contatos, empresas, oportunidades, atividades, lançamentos e modelos e importa contatos. Não exclui registros nem altera configurações.',
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
