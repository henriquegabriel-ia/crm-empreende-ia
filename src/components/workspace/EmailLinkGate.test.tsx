import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { EmailLinkGate } from './EmailLinkGate';
import { AUTH_ERROR_MESSAGES } from '@/lib/auth-errors';

const mock = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { verifyOtp: mock.verifyOtp } } }));
vi.mock('@/components/brand/AuthBrandPanel', () => ({ AuthBrandPanel: () => null }));
vi.mock('@/components/brand/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/brand/Wordmark', () => ({ default: () => null }));

const ID = '3f2b8c1e-9d4a-4e6b-8a7c-1b2c3d4e5f60';
const HASH = '3f9a1c27b84e5d6030c1f2e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0';

function CurrentUrl() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}${location.hash}`}</span>;
}
function setup(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <EmailLinkGate>
        <Routes>
          <Route path="/" element={<h1>Tela de entrada</h1>} />
          <Route path="/reset-password" element={<h1>Senha nova</h1>} />
        </Routes>
      </EmailLinkGate>
      <CurrentUrl />
    </MemoryRouter>,
  );
}
const url = () => screen.getByTestId('url').textContent;

beforeEach(() => {
  mock.verifyOtp.mockReset().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
});

describe('link do e-mail com o toque da pessoa (revisão de 13/10/2026)', () => {
  it('sem token no fragmento, mostra a rota pedida', () => {
    setup(`/?invite=${ID}#access_token=antigo`);
    expect(screen.getByRole('heading', { name: 'Tela de entrada' })).toBeInTheDocument();
    expect(mock.verifyOtp).not.toHaveBeenCalled();
  });

  it('abrir o link não gasta o token: só o toque em "Continuar" o confere, e a rota aparece sem o token', async () => {
    setup(`/?invite=${ID}&next=${encodeURIComponent('/pipeline')}#token_hash=${HASH}&type=email`);
    expect(screen.getByRole('heading', { name: 'Entrar no CRM' })).toBeInTheDocument();
    expect(
      screen.getByText('Você abriu o link enviado ao seu e-mail. Use “Continuar” para entrar no CRM.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/os filtros de segurança do e-mail, que abrem os links antes de você/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Tela de entrada' })).not.toBeInTheDocument();
    // O filtro do e-mail só carrega a página: nenhum pedido ao Auth.
    expect(mock.verifyOtp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { name: 'Tela de entrada' })).toBeInTheDocument();
    expect(mock.verifyOtp).toHaveBeenCalledOnce();
    expect(mock.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'email' });
    expect(url()).toBe(`/?invite=${ID}&next=${encodeURIComponent('/pipeline')}`);
  });

  it('a redefinição de senha volta a /reset-password com a sessão, sem o token na URL', async () => {
    setup(`/reset-password#token_hash=${HASH}&type=recovery`);
    expect(screen.getByRole('heading', { name: 'Redefinir senha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { name: 'Senha nova' })).toBeInTheDocument();
    expect(mock.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'recovery' });
    expect(url()).toBe('/reset-password');
  });

  it('o convite pelo painel (invite) também espera o toque', async () => {
    setup(`/#token_hash=${HASH}&type=invite`);
    expect(mock.verifyOtp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(mock.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'invite' }));
  });

  it('link expirado ou já usado: o motivo em pt-BR, ligado ao botão, e a volta à entrada sem o token', async () => {
    mock.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Email link is invalid or has expired', 403, 'otp_expired'),
    });
    setup(`/?invite=${ID}#token_hash=${HASH}&type=email`);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(AUTH_ERROR_MESSAGES.linkExpired);
    expect(screen.getByRole('button', { name: 'Continuar' })).toHaveAttribute('aria-describedby', alert.id);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a tela de entrada' }));
    expect(await screen.findByRole('heading', { name: 'Tela de entrada' })).toBeInTheDocument();
    expect(url()).toBe(`/?invite=${ID}`);
  });

  it('na redefinição de senha, o link expirado manda pedir outro em "Esqueceu a senha?"', async () => {
    mock.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Email link is invalid or has expired', 403, 'otp_expired'),
    });
    setup(`/reset-password#token_hash=${HASH}&type=recovery`);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.recoveryLinkExpired);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a tela de entrada' }));
    expect(await screen.findByRole('heading', { name: 'Tela de entrada' })).toBeInTheDocument();
    expect(url()).toBe('/');
  });

  it('sem conexão com o Auth, pede para tentar de novo, e o botão volta a funcionar', async () => {
    mock.verifyOtp.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    setup(`/#token_hash=${HASH}&type=email`);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_ERROR_MESSAGES.network);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { name: 'Tela de entrada' })).toBeInTheDocument();
    expect(mock.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['sem o tipo', `token_hash=${HASH}`],
    ['com o tipo da troca de e-mail', `token_hash=${HASH}&type=email_change`],
    ['sem o token', 'token_hash=&type=email'],
  ])('link incompleto (%s): explica, sem conferir nada no Auth, e volta à entrada', async (_label, fragment) => {
    setup(`/?invite=${ID}#${fragment}`);
    expect(screen.getByRole('heading', { name: 'Link incompleto' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('O endereço deste link está incompleto.');
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a tela de entrada' }));
    expect(await screen.findByRole('heading', { name: 'Tela de entrada' })).toBeInTheDocument();
    expect(url()).toBe(`/?invite=${ID}`);
    expect(mock.verifyOtp).not.toHaveBeenCalled();
  });
});

// Item 1.6: a tela do link também leva o rodapé com o nome da marca.
describe('marca da instância', () => {
  it('mostra o nome da marca no rodapé', () => {
    setup(`/#token_hash=${HASH}&type=email`);
    expect(screen.getByText('Empreende.IA · CRM')).toBeInTheDocument();
    expect(screen.queryByText('Feito com Empreende.IA')).not.toBeInTheDocument();
  });
});
