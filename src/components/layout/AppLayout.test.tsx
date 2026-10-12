import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, signedOut: false }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    ...auth,
    profile: null,
    profileError: null,
    refreshProfile: vi.fn(),
    signOut: vi.fn(),
  }),
}));

function LoginProbe() {
  const location = useLocation();
  return (
    <p>
      login {location.search} {useNavigationType()}
    </p>
  );
}

function setup(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LoginProbe />} />
        <Route element={<AppLayout />}>
          <Route path="/pipeline" element={<p>Pipeline</p>} />
          <Route path="/dashboard" element={<p>Hoje</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('guarda de sessão do AppLayout', () => {
  it('sem sessão, volta ao login com o caminho e a consulta em ?next=, com replace', async () => {
    auth.user = null;
    auth.loading = false;
    auth.signedOut = false;
    setup('/pipeline?deal=deal-7&status=all');
    expect(
      await screen.findByText(`login ?next=${encodeURIComponent('/pipeline?deal=deal-7&status=all')} REPLACE`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
  });

  it('depois de um Sair pedido nesta aba, vai ao login sem guardar a tela nem a busca', async () => {
    auth.user = null;
    auth.loading = false;
    auth.signedOut = true;
    setup('/pipeline?q=cliente&deal=deal-7');
    expect(await screen.findByText('login REPLACE')).toBeInTheDocument();
  });

  it('enquanto a sessão carrega, não redireciona', () => {
    auth.user = null;
    auth.loading = true;
    setup('/dashboard');
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText(/^login/)).not.toBeInTheDocument();
  });
});
