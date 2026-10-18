import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  profile: null as null | { id: string; org_id: string | null; email: string },
  loading: false,
  signedOut: false,
  signOut: vi.fn(),
}));
const access = vi.hoisted(() => ({
  accessEnded: false,
  deactivatedAt: null as string | null,
  recheck: vi.fn(async () => 'ended' as const),
  options: [] as unknown[],
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ ...auth, profileError: null, refreshProfile: vi.fn() }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: (options: unknown) => {
    access.options.push(options);
    return { ...access, roles: access.accessEnded ? [] : ['member'], canWrite: !access.accessEnded };
  },
}));
// O CRM aberto: só o miolo das rotas interessa aqui.
vi.mock('@/components/shell/AppRail', () => ({ AppRail: () => <nav>Menu do CRM</nav> }));
vi.mock('@/components/RouteTransition', async () => {
  const { Outlet } = await import('react-router-dom');
  return { RouteTransition: () => <Outlet /> };
});
vi.mock('@/components/CommandPalette', () => ({
  CommandPalette: ({ open }: { open: boolean }) => (open ? <p>Busca aberta</p> : null),
}));
vi.mock('@/components/crm/AICopilot', () => ({ AICopilot: () => null }));
vi.mock('@/components/onboarding/CrmOnboardingProvider', () => ({
  CrmOnboardingProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/workspace/WorkspaceSetup', () => ({ WorkspaceSetup: () => <p>Conta sem organização</p> }));

function LoginProbe() {
  const location = useLocation();
  return (
    <p>
      login {location.search} {useNavigationType()}
    </p>
  );
}

function setup(path: string, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<LoginProbe />} />
          <Route element={<AppLayout />}>
            <Route path="/pipeline" element={<p>Pipeline</p>} />
            <Route path="/dashboard" element={<p>Hoje</p>} />
            <Route path="/invite" element={<p>Você já está na equipe</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  auth.user = null;
  auth.profile = null;
  auth.loading = false;
  auth.signedOut = false;
  auth.signOut.mockReset();
  access.accessEnded = false;
  access.deactivatedAt = null;
  access.recheck.mockReset().mockResolvedValue('ended');
  access.options = [];
});

describe('guarda de sessão do AppLayout', () => {
  it('sem sessão, volta ao login com o caminho e a consulta em ?next=, com replace', async () => {
    setup('/pipeline?deal=deal-7&status=all');
    expect(
      await screen.findByText(`login ?next=${encodeURIComponent('/pipeline?deal=deal-7&status=all')} REPLACE`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
  });

  it('depois de um Sair pedido nesta aba, vai ao login sem guardar a tela nem a busca', async () => {
    auth.signedOut = true;
    setup('/pipeline?q=cliente&deal=deal-7');
    expect(await screen.findByText('login REPLACE')).toBeInTheDocument();
  });

  it('enquanto a sessão carrega, não redireciona', () => {
    auth.loading = true;
    setup('/dashboard');
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText(/^login/)).not.toBeInTheDocument();
  });
});

describe('acesso encerrado (item 1.2)', () => {
  beforeEach(() => {
    auth.user = { id: 'user-1', email: 'fulano@empresa.com.br' };
    auth.profile = { id: 'user-1', org_id: 'org-1', email: 'fulano@empresa.com.br' };
  });

  it('com o papel ativo, abre o CRM e vigia o acesso (foco e intervalo)', () => {
    setup('/pipeline');
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Menu do CRM')).toBeInTheDocument();
    expect(access.options).toContainEqual({ watchAccess: true });
  });

  it('desativada, mostra "Seu acesso foi encerrado" no lugar do CRM, com a data e a conta', () => {
    access.accessEnded = true;
    access.deactivatedAt = '2026-10-13T15:00:00.000Z';
    setup('/pipeline');
    expect(screen.getByRole('heading', { level: 1, name: 'Seu acesso foi encerrado' })).toBeInTheDocument();
    expect(screen.getByText(/desativou o seu acesso a este CRM em 13\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText('fulano@empresa.com.br')).toBeInTheDocument();
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Menu do CRM')).not.toBeInTheDocument();
  });

  it('vale também em /invite, que diria "Você já está na equipe"', () => {
    access.accessEnded = true;
    access.deactivatedAt = '2026-10-13T15:00:00.000Z';
    setup('/invite?invite=11111111-1111-4111-8111-111111111111');
    expect(screen.getByRole('heading', { name: 'Seu acesso foi encerrado' })).toBeInTheDocument();
    expect(screen.queryByText('Você já está na equipe')).not.toBeInTheDocument();
  });

  it('a conta sem organização continua na tela de entrada na equipe', () => {
    auth.profile = { id: 'user-1', org_id: null, email: 'fulano@empresa.com.br' };
    access.accessEnded = true;
    setup('/dashboard');
    expect(screen.getByText('Conta sem organização')).toBeInTheDocument();
  });

  it('apaga do cache as consultas do CRM, menos a do papel', async () => {
    const client = new QueryClient();
    client.setQueryData(['crm', 'org-1', 'snapshot', 'user-1'], { contacts: [{ id: 'c1' }] });
    client.setQueryData(['crm', 'org-1', 'deals'], []);
    client.setQueryData(['crm', 'org-1', 'permissions', 'user-1'], [{ role: 'member', deactivatedAt: 'x' }]);
    client.setQueryData(['instance-status'], { hasOrganization: true });
    access.accessEnded = true;
    setup('/dashboard', client);
    await waitFor(() => expect(client.getQueryData(['crm', 'org-1', 'snapshot', 'user-1'])).toBeUndefined());
    expect(client.getQueryData(['crm', 'org-1', 'deals'])).toBeUndefined();
    expect(client.getQueryData(['crm', 'org-1', 'permissions', 'user-1'])).toBeDefined();
    expect(client.getQueryData(['instance-status'])).toBeDefined();
  });

  it('com o acesso ativo, o cache fica', async () => {
    const client = new QueryClient();
    client.setQueryData(['crm', 'org-1', 'snapshot', 'user-1'], { contacts: [] });
    setup('/dashboard', client);
    await screen.findByText('Hoje');
    expect(client.getQueryData(['crm', 'org-1', 'snapshot', 'user-1'])).toBeDefined();
  });

  it('"Sair da conta" sai; "Verificar de novo" relê o papel e diz que o acesso continua encerrado', async () => {
    access.accessEnded = true;
    access.deactivatedAt = '2026-10-13T15:00:00.000Z';
    setup('/dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' }));
    expect(access.recheck).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Seu acesso continua encerrado/)).toBeInTheDocument();
  });
});

// Revisão do item 1.11, achado 7: o Ctrl/Cmd+K abria a busca por cima do diálogo da importação, e escolher um resultado
// trocava a rota no meio da gravação.
describe('atalho da busca', () => {
  beforeEach(() => {
    auth.user = { id: 'user-1', email: 'fulano@empresa.com.br' };
    auth.profile = { id: 'user-1', org_id: 'org-1', email: 'fulano@empresa.com.br' };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('[data-test-dialog]').forEach((element) => element.remove());
  });

  it('Ctrl+K e Cmd+K abrem a busca fora das janelas', () => {
    setup('/pipeline');
    expect(screen.queryByText('Busca aberta')).not.toBeInTheDocument();
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('Busca aberta')).toBeInTheDocument();
  });

  it('com uma janela aberta (como a da importação durante a gravação), o atalho não abre a busca', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect);
    setup('/pipeline');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-test-dialog', '');
    document.body.appendChild(dialog);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    // O atalho do navegador continua bloqueado, e a busca não abre por trás da janela.
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByText('Busca aberta')).not.toBeInTheDocument();
    dialog.remove();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
    });
    expect(screen.getByText('Busca aberta')).toBeInTheDocument();
  });

  // Revisão do item 1.12: o popover do Radix (os filtros de "Contatos", o menu da pessoa) também tem role="dialog", mas
  // não é modal; com ele aberto, o atalho abre a busca.
  it('com um popover aberto (não modal), o atalho abre a busca', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect);
    setup('/pipeline');
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-radix-popper-content-wrapper', '');
    wrapper.setAttribute('data-test-dialog', '');
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    wrapper.appendChild(popover);
    document.body.appendChild(wrapper);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText('Busca aberta')).toBeInTheDocument();
  });
});
