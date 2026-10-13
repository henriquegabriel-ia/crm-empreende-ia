import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AccessCheck } from '@/hooks/useCrmPermissions';
import { AccessEnded } from './AccessEnded';

const props = (overrides: Partial<Parameters<typeof AccessEnded>[0]> = {}) => ({
  deactivatedAt: '2026-10-13T15:00:00.000Z',
  email: 'fulano@empresa.com.br',
  onCheckAgain: vi.fn(async (): Promise<AccessCheck> => 'ended'),
  onSignOut: vi.fn(),
  ...overrides,
});

describe('Seu acesso foi encerrado (item 1.2)', () => {
  it('diz quando e por quem o acesso foi encerrado, com a conta e as duas saídas', () => {
    const current = props();
    render(<AccessEnded {...current} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Seu acesso foi encerrado' })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Um dono ou administrador desativou o seu acesso a este CRM em 13\/10\/2026\. Os registros continuam com a empresa, mas você não consegue mais consultá-los nem alterá-los\. Se acha que é um engano, fale com quem administra o CRM\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('fulano@empresa.com.br').closest('p')).toHaveTextContent('Conta: fulano@empresa.com.br');
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
    expect(current.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('sem data, explica que a conta não tem papel ativo', () => {
    render(<AccessEnded {...props({ deactivatedAt: null })} />);
    expect(screen.getByText(/^Sua conta não tem um papel ativo neste CRM\./)).toBeInTheDocument();
    expect(screen.queryByText(/desativou/)).not.toBeInTheDocument();
  });

  it('"Verificar de novo" fica em "Verificando…" só durante o clique e diz que o acesso continua encerrado', async () => {
    let finish!: (result: AccessCheck) => void;
    const onCheckAgain = vi.fn(() => new Promise<AccessCheck>((resolve) => (finish = resolve)));
    render(<AccessEnded {...props({ onCheckAgain })} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' }));
    expect(screen.getByRole('button', { name: 'Verificando…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Verificando…' }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    await act(async () => finish('ended'));
    expect(screen.getByRole('button', { name: 'Verificar de novo' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Seu acesso continua encerrado. Se acha que é um engano, fale com quem administra o CRM.',
    );
  });

  it('uma falha na verificação pede para tentar de novo, e uma nova tentativa limpa o aviso', async () => {
    const onCheckAgain = vi
      .fn<() => Promise<AccessCheck>>()
      .mockResolvedValueOnce('failed')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('active');
    render(<AccessEnded {...props({ onCheckAgain })} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' })));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Não foi possível verificar agora. Confira a conexão e tente de novo.',
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' })));
    expect(screen.getByRole('status')).toHaveTextContent('Não foi possível verificar agora.');
    // Reativada: quem chama troca a tela pelo CRM; aqui, nenhum aviso fica.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verificar de novo' })));
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(onCheckAgain).toHaveBeenCalledTimes(3);
  });
});
