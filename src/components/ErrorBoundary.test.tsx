import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
