import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
const mock = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  profile: vi.fn(),
  initial: vi.fn(),
  signOut: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  backendConfigured: true,
  supabase: {
    auth: {
      onAuthStateChange: (listener: typeof mock.listener) => {
        mock.listener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => mock.initial(),
      signOut: (options: unknown) => mock.signOut(options),
    },
  },
}));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: { from: () => ({ select: () => ({ eq: () => ({ single: () => mock.profile() }) }) }) },
}));
vi.mock('sonner', () => ({ toast: { error: mock.toastError } }));
const session = { user: { id: 'user-a' }, access_token: 'test' };
function Consumer() {
  const { loading, profile, profileError, signedOut, signOut } = useAuth();
  return (
    <div>
      {loading ? (
        <span>Loading auth</span>
      ) : profileError ? (
        <span>{profileError}</span>
      ) : profile ? (
        <input aria-label="Unsaved form" defaultValue="Keep this draft" />
      ) : (
        <span>No profile</span>
      )}
      <span>{signedOut ? 'Saída pedida' : 'Sem saída pedida'}</span>
      <button onClick={() => void signOut()}>Sair</button>
      <button onClick={() => void signOut('global')}>Sair de todos</button>
    </div>
  );
}
function setup() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mock.listener = null;
  mock.profile.mockReset().mockResolvedValue({ data: { id: 'user-a', org_id: 'org-a', name: 'A' }, error: null });
  mock.initial.mockResolvedValue({ data: { session }, error: null });
  mock.signOut.mockReset().mockResolvedValue({ error: null });
  mock.toastError.mockReset();
});
describe('authentication lifecycle', () => {
  it('reports logout failure without discarding the session and allows retry', async () => {
    setup();
    const input = await screen.findByLabelText('Unsaved form');
    mock.signOut.mockResolvedValueOnce({ error: { message: 'offline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(mock.toastError).toHaveBeenCalledWith(expect.stringContaining('Não foi possível sair')));
    expect(screen.getByLabelText('Unsaved form')).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('No profile')).toBeInTheDocument();
  });
  it('marks a voluntary sign-out until the next sign-in, so the login does not keep the last screen', async () => {
    setup();
    await screen.findByLabelText('Unsaved form');
    expect(screen.getByText('Sem saída pedida')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('No profile')).toBeInTheDocument();
    expect(screen.getByText('Saída pedida')).toBeInTheDocument();
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await act(async () => {
      mock.listener?.('SIGNED_IN', { ...session, user: { id: 'user-b' } });
    });
    expect(await screen.findByLabelText('Unsaved form')).toBeInTheDocument();
    expect(screen.getByText('Sem saída pedida')).toBeInTheDocument();
  });
  it('ends every session with the global scope, also as a voluntary sign-out', async () => {
    setup();
    await screen.findByLabelText('Unsaved form');
    fireEvent.click(screen.getByRole('button', { name: 'Sair de todos' }));
    expect(await screen.findByText('Saída pedida')).toBeInTheDocument();
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'global' });
  });
  it('a session lost without Sair (expired or ended elsewhere) is not a voluntary sign-out', async () => {
    setup();
    await screen.findByLabelText('Unsaved form');
    await act(async () => {
      mock.listener?.('SIGNED_OUT', null);
    });
    expect(screen.getByText('No profile')).toBeInTheDocument();
    expect(screen.getByText('Sem saída pedida')).toBeInTheDocument();
  });
  it('a failed sign-out is not marked as voluntary', async () => {
    setup();
    await screen.findByLabelText('Unsaved form');
    mock.signOut.mockResolvedValueOnce({ error: { message: 'offline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(mock.toastError).toHaveBeenCalled());
    expect(screen.getByText('Sem saída pedida')).toBeInTheDocument();
  });
  it('keeps the same mounted form when the same user token is refreshed', async () => {
    setup();
    const input = await screen.findByLabelText('Unsaved form');
    await act(async () => {
      mock.listener?.('TOKEN_REFRESHED', { ...session, access_token: 'new-test-token' });
    });
    expect(screen.getByLabelText('Unsaved form')).toBe(input);
    expect(mock.profile).toHaveBeenCalledTimes(1);
  });
  it('reports profile fetch failures instead of starting onboarding with missing access', async () => {
    mock.profile.mockResolvedValue({ data: null, error: { message: 'offline' } });
    setup();
    expect(await screen.findByText(/Não foi possível carregar seu acesso/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Unsaved form')).not.toBeInTheDocument();
  });
  it('ignores a profile response that arrives after logout', async () => {
    let resolve!: (result: unknown) => void;
    mock.profile.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    setup();
    await waitFor(() => expect(mock.profile).toHaveBeenCalled());
    await act(async () => {
      mock.listener?.('SIGNED_OUT', null);
      resolve({ data: { id: 'user-a', org_id: 'org-a', name: 'A' }, error: null });
    });
    expect(screen.getByText('No profile')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unsaved form')).not.toBeInTheDocument();
  });
});
