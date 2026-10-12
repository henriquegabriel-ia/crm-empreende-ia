import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { OFFLINE_AUTH_MESSAGE, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signUp: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  backendConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signInWithOtp: mocks.signInWithOtp,
      signUp: mocks.signUp,
      resetPasswordForEmail: vi.fn(),
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

function Destination() {
  const location = useLocation();
  return (
    <p>
      destino {location.pathname}
      {location.search} {useNavigationType()}
    </p>
  );
}
function setup(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}
const next = (path: string) => `/?next=${encodeURIComponent(path)}`;

beforeEach(() => {
  mocks.user = null;
  mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
  mocks.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  mocks.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocks.toast.mockReset();
});

describe('retorno ao deep link depois do login', () => {
  it('quem já tem sessão vai direto ao destino guardado, com replace', async () => {
    mocks.user = { id: 'user-1' };
    setup(next('/pipeline?deal=deal-7'));
    expect(await screen.findByText('destino /pipeline?deal=deal-7 REPLACE')).toBeInTheDocument();
  });

  it('ao entrar com senha, navega para o destino validado com replace', async () => {
    setup(next('/pipeline?deal=deal-7'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pessoa@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('destino /pipeline?deal=deal-7 REPLACE')).toBeInTheDocument();
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'pessoa@example.test', password: 'senha-de-teste' });
  });

  it.each([
    '//example.test/roubo',
    'https://example.test/roubo',
    '/\\example.test',
    '/',
    '/.//example.test',
    '/%2e//example.test',
  ])('ignora o destino %s e segue para Hoje', async (target) => {
    mocks.user = { id: 'user-1' };
    setup(next(target));
    expect(await screen.findByText('destino /dashboard REPLACE')).toBeInTheDocument();
  });

  it('com convite, passa pelo aceite levando o destino', async () => {
    mocks.user = { id: 'user-1' };
    setup(`/?invite=convite-1&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    expect(
      await screen.findByText(
        `destino /invite?invite=convite-1&next=${encodeURIComponent('/pipeline?deal=deal-7')} REPLACE`,
      ),
    ).toBeInTheDocument();
  });

  it('o link por e-mail volta para o login com o convite e o destino', async () => {
    setup(`/?invite=convite-1&next=${encodeURIComponent('/pipeline?deal=deal-7')}`);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Link por e-mail' }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'pessoa@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link de acesso' }));
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledOnce());
    const redirect = new URL(mocks.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirect.origin).toBe(window.location.origin);
    expect(redirect.pathname).toBe('/');
    expect(redirect.searchParams.get('invite')).toBe('convite-1');
    expect(redirect.searchParams.get('next')).toBe('/pipeline?deal=deal-7');
  });
});

describe('entrar sem conexão', () => {
  it('mostra que falta conexão, sem falar em salvar, e fica no login', async () => {
    // O Auth repete a mensagem do OfflineRequestError que o fetch do cliente rejeitou.
    mocks.signInWithPassword.mockResolvedValue({
      error: Object.assign(new Error(OFFLINE_REQUEST_MESSAGE), { name: 'AuthRetryableFetchError' }),
    });
    setup(next('/pipeline?deal=deal-7'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pessoa@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        title: 'Erro ao entrar',
        description: OFFLINE_AUTH_MESSAGE,
        variant: 'destructive',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(screen.queryByText(/^destino/)).not.toBeInTheDocument();
  });

  it('outros erros do Auth continuam com a mensagem original', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') });
    setup('/');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'pessoa@example.test' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Invalid login credentials' })),
    );
  });
});
