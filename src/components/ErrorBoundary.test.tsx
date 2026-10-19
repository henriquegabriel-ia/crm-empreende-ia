import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// O e-mail de suporte é lido quando o módulo carrega: a simulação vale para o arquivo inteiro.
const mock = vi.hoisted(() => ({ email: 'suporte@acme.example' }));
vi.mock('@/lib/support', () => ({
  get SUPPORT_EMAIL() {
    return mock.email;
  },
}));

function Broken(): never {
  throw new Error('Falha simulada');
}

beforeEach(() => {
  // O React registra o erro capturado no console; o ErrorBoundary também.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mock.email = 'suporte@acme.example';
});

// Revisão do item 1.6: o botão "Reportar" manda o erro ao supportEmail da marca (docs/MARCA.md), num produto todo em
// pt-BR.
describe('ErrorBoundary', () => {
  it('"Reportar" abre o e-mail do suporte com o assunto e o corpo em pt-BR', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Algo deu errado' })).toBeInTheDocument();
    const errorId = screen.getByText(/^ID do erro: /).textContent!.replace('ID do erro: ', '');
    fireEvent.click(screen.getByRole('button', { name: 'Reportar' }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('suporte@acme.example');
    expect(url.searchParams.get('subject')).toBe(`Erro no CRM: ${errorId}`);
    expect(url.searchParams.get('subject')).not.toMatch(/Bug|Report/i);
    expect(url.searchParams.get('body')).toContain('Erro: Falha simulada');
  });

  it('sem e-mail de suporte, pede para informar o código a quem administra', () => {
    mock.email = '';
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('button', { name: 'Reportar' })).not.toBeInTheDocument();
    expect(screen.getByText('Se o erro continuar, informe este código a quem administra o CRM.')).toBeInTheDocument();
  });

  // Achado 4 da revisão do 1.7b (corrigido no 1.7a): sem conexão, recarregar trocaria o CRM pela página de erro do
  // navegador. A tela diz que está sem conexão e só habilita "Recarregar" quando a conexão volta, sem recarregar sozinha.
  it('sem conexão, diz isso e deixa "Recarregar" desabilitado até a conexão voltar', () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Esta tela não abriu sem conexão' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Algo deu errado' })).not.toBeInTheDocument();
    expect(screen.getByText('Confira a internet. Quando a conexão voltar, use Recarregar.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Recarregar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Confira a internet. Quando a conexão voltar, use Recarregar.');
    onLine.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(button).toBeEnabled();
    expect(reload).not.toHaveBeenCalled();
    // Com a conexão de volta, a tela diz isso (e não "Algo deu errado"), e o botão recarrega.
    expect(screen.getByRole('heading', { name: 'A conexão voltou' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Algo deu errado' })).not.toBeInTheDocument();
    expect(screen.getByText('Use Recarregar para abrir a tela.')).toBeInTheDocument();
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('com conexão, a tela é a de sempre, e cair a conexão depois desabilita o botão', () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Algo deu errado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeEnabled();
    onLine.mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeDisabled();
    // O erro aconteceu com conexão: continua "Algo deu errado", com a dica de esperar a conexão.
    expect(screen.getByRole('heading', { name: 'Algo deu errado' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Esta tela não abriu sem conexão' })).not.toBeInTheDocument();
    expect(screen.getByText('Confira a internet. Quando a conexão voltar, use Recarregar.')).toBeInTheDocument();
  });
});
