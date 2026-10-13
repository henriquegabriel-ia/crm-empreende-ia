import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ACME_BRAND } from '@/test/brand-mock';
import { HelpCenter } from './HelpCenter';

// A marca simulada é lida quando os módulos carregam (o e-mail de suporte) e a cada abertura (o crédito).
const mock = vi.hoisted(() => ({ brand: {} as Record<string, unknown> }));
vi.mock('@/lib/brand', async (importOriginal) => {
  const { ACME_BRAND: brand } = await import('@/test/brand-mock');
  Object.assign(mock.brand, brand);
  return { ...(await importOriginal<typeof import('@/lib/brand')>()), BRAND: mock.brand };
});

function renderHelp() {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HelpCenter open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
  return screen.getByRole('dialog', { name: 'Ajuda do CRM' });
}

afterEach(() => {
  cleanup();
  mock.brand.baseCredit = true;
});

// Item 1.6: "Falar com suporte" usa o e-mail da marca, e o rodapé da Ajuda leva o crédito da base quando ligado.
describe('Central de ajuda com a marca de outra empresa', () => {
  it('com o crédito ligado: suporte da marca, crédito no rodapé e a pergunta sobre o crédito', () => {
    const help = renderHelp();
    expect(within(help).getByRole('link', { name: 'Falar com suporte' })).toHaveAttribute(
      'href',
      `mailto:${ACME_BRAND.supportEmail}`,
    );
    const credit = within(help).getByText('Feito com Empreende.IA');
    expect(credit.tagName).toBe('P');
    expect(credit.closest('div.text-xs')).not.toBeNull();
    fireEvent.change(within(help).getByRole('searchbox', { name: 'Buscar nas perguntas frequentes' }), {
      target: { value: 'credito' },
    });
    expect(within(help).getByRole('button', { name: 'O que significa “Feito com Empreende.IA”?' })).toBeInTheDocument();
  });

  it('com o crédito desligado, a Ajuda não cita a base em lugar nenhum', () => {
    mock.brand.baseCredit = false;
    const help = renderHelp();
    expect(within(help).queryByText('Feito com Empreende.IA')).not.toBeInTheDocument();
    expect(help.textContent).not.toMatch(/Empreende/);
    expect(within(help).getByRole('link', { name: 'Falar com suporte' })).toBeInTheDocument();
  });
});
