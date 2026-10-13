import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replies: [] as { data: unknown; error: unknown }[],
  selects: [] as string[],
}));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from: () => ({
      select: (columns: string) => {
        mocks.selects.push(columns);
        const reply = mocks.replies.length > 1 ? mocks.replies.shift()! : mocks.replies[0];
        const chain = {
          eq: () => chain,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(reply).then(resolve, reject),
        };
        return chain;
      },
    }),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
import { useCrmPermissions } from './useCrmPermissions';
import { RequireRole } from '@/components/layout/RequireRole';
import { EDITOR_ROLES } from '@/lib/roles';

// Mesmo padrão do App: dados frescos por 5 min e sem recarregar no foco.
const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
  });

function setup(options?: { watchAccess?: boolean }) {
  const client = newClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useCrmPermissions(options), { wrapper }) };
}

/**
 * Uma tela como Contatos, Atividades e Agenda: o editor só monta com `canWrite`, dentro da guarda de papel, e a releitura
 * do papel é a do AppLayout (`watchAccess`).
 */
function EditorScreen() {
  const watcher = useCrmPermissions({ watchAccess: true });
  const { canWrite } = useCrmPermissions();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={watcher.refresh}>Reler o papel</button>
      <button onClick={() => setOpen(true)}>Novo contato</button>
      {open && canWrite && <input aria-label="Nome do contato" />}
      {open && !canWrite && <p>Seu papel permite consultar registros.</p>}
    </>
  );
}

beforeEach(() => {
  mocks.replies = [];
  mocks.selects = [];
});
afterEach(() => {
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});

describe('papel da conta (item 1.2)', () => {
  it('papel ativo: grava conforme o papel e não encerra o acesso', async () => {
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: null }], error: null }];
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({
      canWrite: true,
      canManage: false,
      roles: ['member'],
      active: true,
      accessEnded: false,
      deactivatedAt: null,
    });
    expect(mocks.selects).toEqual(['role,deactivated_at']);
  });

  it('papel desativado: nada grava, o acesso é encerrado e a data vem junto', async () => {
    mocks.replies = [{ data: [{ role: 'admin', deactivated_at: '2026-10-13T15:00:00Z' }], error: null }];
    const { result } = setup();
    await waitFor(() => expect(result.current.accessEnded).toBe(true));
    expect(result.current).toMatchObject({
      canWrite: false,
      canManage: false,
      roles: [],
      active: false,
      deactivatedAt: '2026-10-13T15:00:00Z',
    });
  });

  it('sem papel na organização, o acesso também é encerrado, sem data', async () => {
    mocks.replies = [{ data: [], error: null }];
    const { result } = setup();
    await waitFor(() => expect(result.current.accessEnded).toBe(true));
    expect(result.current.deactivatedAt).toBeNull();
  });

  it('uma falha de leitura não encerra o acesso nem libera gravações', async () => {
    mocks.replies = [{ data: null, error: { code: 'PGRST000', message: 'falha' } }];
    const { result } = setup();
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current).toMatchObject({ accessEnded: false, canWrite: false, canManage: false });
  });

  it('banco sem a migração: lê só o papel e trata a conta como ativa', async () => {
    mocks.replies = [
      { data: null, error: { code: '42703', message: 'column user_roles.deactivated_at does not exist' } },
      { data: [{ role: 'owner' }], error: null },
    ];
    const { result } = setup();
    await waitFor(() => expect(result.current.canManage).toBe(true));
    expect(mocks.selects).toEqual(['role,deactivated_at', 'role']);
    expect(result.current).toMatchObject({ accessEnded: false, active: true, roles: ['owner'] });
  });

  it('com watchAccess, relê ao voltar para a aba com dados de mais de 30 s e a cada 60 s', async () => {
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: null }], error: null }];
    const { result, client } = setup({ watchAccess: true });
    await waitFor(() => expect(result.current.active).toBe(true));
    const reads = () => mocks.selects.length;
    const returnToTab = () =>
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
    returnToTab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(reads()).toBe(1);
    // A pessoa foi desativada enquanto o CRM estava aberto.
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: '2026-10-13T15:00:00Z' }], error: null }];
    const loadedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(loadedAt + 31_000);
    returnToTab();
    await waitFor(() => expect(result.current.accessEnded).toBe(true));
    expect(reads()).toBe(2);
    const query = client.getQueryCache().find({ queryKey: ['crm', 'org-1', 'permissions', 'user-1'] })!;
    expect(query.observers[0].options).toMatchObject({ refetchInterval: 60_000, refetchOnWindowFocus: true });
  });

  it('sem watchAccess, segue o padrão do app (sem recarga periódica)', async () => {
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: null }], error: null }];
    const { result, client } = setup();
    await waitFor(() => expect(result.current.active).toBe(true));
    const query = client.getQueryCache().find({ queryKey: ['crm', 'org-1', 'permissions', 'user-1'] })!;
    expect(query.observers[0].options.refetchInterval).toBeUndefined();
  });

  it('"Verificar de novo" (recheck) diz se o acesso continua encerrado, falhou ou voltou', async () => {
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: '2026-10-13T15:00:00Z' }], error: null }];
    const { result } = setup();
    await waitFor(() => expect(result.current.accessEnded).toBe(true));
    expect(await act(() => result.current.recheck())).toBe('ended');
    mocks.replies = [{ data: null, error: { code: 'PGRST000', message: 'falha' } }];
    expect(await act(() => result.current.recheck())).toBe('failed');
    expect(result.current.accessEnded).toBe(true);
    mocks.replies = [{ data: [{ role: 'viewer', deactivated_at: null }], error: null }];
    expect(await act(() => result.current.recheck())).toBe('active');
    await waitFor(() => expect(result.current.accessEnded).toBe(false));
  });

  it('depois de encerrado, uma falha na releitura não reabre o CRM', async () => {
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: '2026-10-13T15:00:00Z' }], error: null }];
    const { result, client } = setup();
    await waitFor(() => expect(result.current.accessEnded).toBe(true));
    mocks.replies = [{ data: null, error: { code: 'PGRST000', message: 'falha' } }];
    act(() => result.current.refresh());
    const query = () => client.getQueryCache().find({ queryKey: ['crm', 'org-1', 'permissions', 'user-1'] })!;
    await waitFor(() => expect(query().state.status).toBe('error'));
    expect(result.current).toMatchObject({ accessEnded: true, canWrite: false, active: false });
  });

  it('leitura certa e depois uma releitura com falha: as permissões e o acesso seguem os da última leitura', async () => {
    mocks.replies = [{ data: [{ role: 'admin', deactivated_at: null }], error: null }];
    const { result, client } = setup({ watchAccess: true });
    await waitFor(() => expect(result.current.canManage).toBe(true));
    mocks.replies = [{ data: null, error: { code: 'PGRST000', message: 'falha' } }];
    act(() => result.current.refresh());
    const query = () => client.getQueryCache().find({ queryKey: ['crm', 'org-1', 'permissions', 'user-1'] })!;
    await waitFor(() => expect(query().state.status).toBe('error'));
    expect(mocks.selects).toHaveLength(2);
    expect(result.current).toMatchObject({
      canWrite: true,
      canManage: true,
      accessEnded: false,
      active: true,
      roles: ['admin'],
      error: null,
    });
  });

  it('uma releitura com falha não desmonta a tela nem o formulário aberto', async () => {
    mocks.replies = [{ data: [{ role: 'member', deactivated_at: null }], error: null }];
    render(
      <QueryClientProvider client={newClient()}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <RequireRole roles={EDITOR_ROLES} title="Contatos" purpose="Contatos serve para cadastrar pessoas.">
            <EditorScreen />
          </RequireRole>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Novo contato' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome do contato' }), { target: { value: 'Ana Souza' } });
    mocks.replies = [{ data: null, error: { code: 'PGRST000', message: 'falha' } }];
    fireEvent.click(screen.getByRole('button', { name: 'Reler o papel' }));
    await waitFor(() => expect(mocks.selects).toHaveLength(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByRole('textbox', { name: 'Nome do contato' })).toHaveValue('Ana Souza');
    expect(screen.queryByText('Não foi possível verificar seu acesso')).not.toBeInTheDocument();
    expect(screen.queryByText('Seu papel permite consultar registros.')).not.toBeInTheDocument();
  });
});
