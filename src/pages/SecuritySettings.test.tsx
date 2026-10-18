import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from './SecuritySettings';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  canManage: false,
  success: vi.fn(),
  /** O que cada tabela devolve; a leitura registra as colunas pedidas. */
  results: {} as Record<string, { data: unknown; error: unknown; count?: number }>,
  selects: [] as { table: string; columns: string }[],
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-a' }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        mocks.selects.push({ table, columns });
        return chain;
      };
      for (const name of ['eq', 'order']) chain[name] = () => chain;
      chain.range = async () => mocks.results[table] ?? { data: [], error: null, count: 0 };
      return chain;
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'user-1', org_id: 'org-a' }, signOut: mocks.signOut }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canManage: mocks.canManage }) }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SecuritySettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.signOut.mockReset().mockResolvedValue(true);
  mocks.canManage = false;
  mocks.success.mockReset();
  mocks.results = {};
  mocks.selects = [];
});
afterEach(cleanup);

// O 'global' do Supabase impede as renovações, mas o acesso já emitido nos outros aparelhos vale até expirar (1 hora no
// padrão): o diálogo diz isso, como a Ajuda ("Como saio da conta ou encerro o acesso em outros aparelhos?").
describe('Segurança: encerrar todas as sessões', () => {
  it('o diálogo diz que este aparelho sai na hora e os outros em até 1 hora, e encerra pelo signOut global', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar todas as sessões' }));
    const dialog = screen.getByRole('dialog', { name: 'Encerrar todas as sessões?' });
    expect(dialog).toHaveAccessibleDescription(
      'Você sairá desta conta agora. Nos outros dispositivos, o acesso termina em até 1 hora, e será preciso entrar novamente. As alterações já salvas permanecem no CRM.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Encerrar sessões' }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith('global'));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Sessões encerradas'));
  });

  it('qualquer papel encerra as sessões; o histórico geral fica com donos e administradores', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Encerrar todas as sessões' })).toBeEnabled();
    expect(
      screen.getByText(
        'O histórico geral está disponível para donos e administradores. O histórico de cada oportunidade permanece em sua ficha.',
      ),
    ).toBeInTheDocument();
  });
});

// Item 1.10: as exportações e anonimizações de contatos, em "Segurança", para donos e administradores.
describe('Segurança: exportações e anonimizações', () => {
  const section = () => screen.getByRole('heading', { name: 'Exportações e anonimizações' }).closest('section')!;

  it('os demais papéis veem só o aviso, sem consultar o registro', () => {
    setup();
    expect(section()).toHaveTextContent('Disponível para donos e administradores.');
    expect(mocks.selects.filter((read) => read.table === 'privacy_actions')).toEqual([]);
  });

  it('donos e administradores veem quando, a ação, o contato atual (com link) e quem fez', async () => {
    mocks.canManage = true;
    mocks.results.privacy_actions = {
      data: [
        {
          id: 'p1',
          org_id: 'org-a',
          contact_id: 'c1',
          action: 'anonymize',
          performed_by: 'user-1',
          summary: {},
          created_at: '2026-10-13T12:00:00Z',
          contact: {
            id: 'c1',
            first_name: 'Contato anonimizado',
            last_name: null,
            email: null,
            phone: null,
            anonymized_at: '2026-10-13T12:00:00Z',
          },
          author: { id: 'user-1', name: 'Ana Lima', email: 'ana@example.test' },
        },
        {
          id: 'p2',
          org_id: 'org-a',
          contact_id: null,
          action: 'export',
          performed_by: 'user-1',
          summary: {},
          created_at: '2026-10-12T12:00:00Z',
          contact: null,
          author: { id: 'user-2', name: 'Bruno Reis', email: 'bruno@example.test' },
        },
      ],
      error: null,
      count: 2,
    };
    // Quem saiu da equipe aparece com a marca "(desativado)" (item 1.2), pela situação do papel.
    mocks.results.user_roles = {
      data: [
        { id: 'r1', user_id: 'user-1', role: 'admin', deactivated_at: null },
        { id: 'r2', user_id: 'user-2', role: 'member', deactivated_at: '2026-10-14T12:00:00Z' },
      ],
      error: null,
    };
    setup();
    expect(section()).toHaveTextContent(
      'Os pedidos de acesso e de exclusão atendidos pelo CRM. O registro guarda o identificador do contato, e não o nome.',
    );
    const table = await within(section()).findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(
      rows.map((item) =>
        within(item)
          .getAllByRole('cell')
          .slice(1)
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['Anonimização', 'Contato anonimizado', 'Ana Lima'],
      ['Exportação', 'Contato excluído', 'Bruno Reis (desativado)'],
    ]);
    expect(within(rows[0]).getByRole('link', { name: 'Contato anonimizado' })).toHaveAttribute(
      'href',
      '/contacts?contact=c1',
    );
    expect(within(section()).getByText('2 registros · página 1')).toBeInTheDocument();
    // O contato e quem fez vêm pelas FKs compostas de privacy_actions.
    expect(mocks.selects.find((read) => read.table === 'privacy_actions')!.columns).toContain(
      'contacts!privacy_actions_contact_id_org_id_fkey',
    );
    // A seção fica acima do histórico geral.
    const history = screen.getByRole('heading', { name: 'Histórico de alterações' });
    expect(section().compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('com um registro só, a contagem fica no singular', async () => {
    mocks.canManage = true;
    mocks.results.privacy_actions = {
      data: [
        {
          id: 'p1',
          org_id: 'org-a',
          contact_id: 'c1',
          action: 'export',
          performed_by: 'user-1',
          summary: {},
          created_at: '2026-10-13T12:00:00Z',
          contact: { id: 'c1', first_name: 'Ana', last_name: 'Souza', email: null, phone: null, anonymized_at: null },
          author: { id: 'user-1', name: 'Ana Lima', email: 'ana@example.test' },
        },
      ],
      error: null,
      count: 1,
    };
    setup();
    expect(await within(section()).findByText('1 registro · página 1')).toBeInTheDocument();
  });

  it('sem registros, e num banco sem a migração, diz o que acontece', async () => {
    mocks.canManage = true;
    setup();
    expect(await within(section()).findByText('Nenhuma exportação ou anonimização registrada.')).toBeInTheDocument();
    cleanup();
    mocks.results.privacy_actions = {
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.privacy_actions' in the schema cache" },
    };
    setup();
    expect(
      await within(section()).findByText(
        'Este CRM ainda não tem a atualização de privacidade (LGPD). Peça a quem administra para aplicar a migração mais recente.',
      ),
    ).toBeInTheDocument();
  });
});
