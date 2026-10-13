import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmRole } from '@/lib/roles';
import Pipeline from './Pipeline';

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  role: 'owner' as string,
  pipelines: [] as Row[],
  stages: [] as Row[],
  toastError: vi.fn(),
}));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: {} }));
vi.mock('@/components/pipeline/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/pipeline/data')>()),
  // Funis e etapas do teste; oportunidades e próximas ações vazias.
  loadPipelineReferences: async () => ({
    pipelines: mocks.pipelines,
    stages: mocks.stages,
    people: [],
    contacts: [],
    companies: [],
  }),
  allRows: async () => [],
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, profile: { id: 'user-1', org_id: 'org-a' } }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({
    roles: [mocks.role],
    canWrite: ['owner', 'admin', 'member'].includes(mocks.role),
    canManage: ['owner', 'admin'].includes(mocks.role),
    loading: false,
    error: null,
  }),
}));
vi.mock('@/components/shell/PageScaffold', () => ({
  PageScaffold: ({
    title,
    actions,
    toolbar,
    children,
  }: {
    title: ReactNode;
    actions?: ReactNode;
    toolbar?: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {toolbar}
      {children}
    </main>
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

function setup(role: CrmRole, path = '/pipeline') {
  mocks.role = role;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Pipeline />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const managerHint = 'Crie um funil com etapas em Configurações, na aba Funis, para criar oportunidades.';
const memberHint = 'Ainda não há funil com etapas. Donos e administradores os criam em Configurações, na aba Funis.';

beforeEach(() => {
  mocks.pipelines = [];
  mocks.stages = [];
  mocks.toastError.mockReset();
});
afterEach(cleanup);

// A tela se chama Pipeline e mostra um funil por vez. Funis e etapas ficam em Configurações, na aba Funis, e só donos e
// administradores os editam: os textos de ajuda dos estados vazios mudam com o papel.
describe('Pipeline sem funil ou sem etapas', () => {
  it.each(['owner', 'admin'] as const)('%s sem funil: cria o primeiro funil em Configurações', async (role) => {
    setup(role);
    expect(await screen.findByRole('heading', { name: 'Seu primeiro funil começa aqui' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Crie um funil com as etapas comerciais em Configurações, na aba Funis, para organizar suas oportunidades.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurar funis' })).toHaveAttribute('href', '/settings?tab=pipelines');
    expect(screen.getByRole('combobox', { name: 'Funil selecionado' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Nova oportunidade/ })).toHaveAttribute('title', managerHint);
  });

  it.each(['member', 'viewer'] as const)('%s sem funil: sabe que donos e administradores criam', async (role) => {
    setup(role);
    expect(await screen.findByRole('heading', { name: 'Seu primeiro funil começa aqui' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ainda não há funil. Donos e administradores criam funis e etapas em Configurações, na aba Funis.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configurar funis' })).not.toBeInTheDocument();
  });

  it.each(['owner', 'admin'] as const)('%s com funil sem etapas: adiciona etapas em Configurações', async (role) => {
    mocks.pipelines = [{ id: 'p1', org_id: 'org-a', name: 'Comercial', is_default: true, currency: 'BRL' }];
    setup(role);
    expect(await screen.findByRole('heading', { name: 'Este funil ainda não tem etapas' })).toBeInTheDocument();
    expect(
      screen.getByText('Adicione etapas em Configurações, na aba Funis, para começar a criar oportunidades.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurar etapas' })).toHaveAttribute('href', '/settings?tab=pipelines');
  });

  it.each(['member', 'viewer'] as const)('%s com funil sem etapas: sabe quem adiciona', async (role) => {
    mocks.pipelines = [{ id: 'p1', org_id: 'org-a', name: 'Comercial', is_default: true, currency: 'BRL' }];
    setup(role);
    expect(await screen.findByRole('heading', { name: 'Este funil ainda não tem etapas' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Donos e administradores adicionam etapas em Configurações, na aba Funis. Depois disso, as oportunidades podem ser criadas aqui.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configurar etapas' })).not.toBeInTheDocument();
  });

  it('o colaborador vê no botão desabilitado e no aviso de ?create=1 que não é ele quem cria funis', async () => {
    setup('member', '/pipeline?create=1');
    await screen.findByRole('heading', { name: 'Seu primeiro funil começa aqui' });
    expect(screen.getByRole('button', { name: /Nova oportunidade/ })).toHaveAttribute('title', memberHint);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(memberHint));
  });

  it('o dono que abre ?create=1 sem funil é mandado a Configurações', async () => {
    setup('owner', '/pipeline?create=1');
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(managerHint));
  });

  it('com acesso somente leitura, ?create=1 avisa só o papel', async () => {
    setup('viewer', '/pipeline?create=1');
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Seu papel permite somente leitura.'));
    expect(screen.queryByRole('button', { name: /Nova oportunidade/ })).not.toBeInTheDocument();
  });
});
