import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionPromptContext, type InteractionPromptValue } from './interaction-context';

const mocks = vi.hoisted(() => ({ canWrite: true, toast: { success: vi.fn(), message: vi.fn() } }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: mocks.canWrite }) }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { name: 'Carla Dias' } }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'order']) chain[name] = () => chain;
      chain.range = async () => ({ data: [], error: null });
      chain.maybeSingle = async () => ({ data: { name: 'Agência Exemplo' }, error: null });
      return chain;
    },
  },
}));

import { ChannelBar, type ChannelBarProps } from './ChannelBar';

const ana = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Ana',
  last_name: 'Souza',
  email: 'ana@example.com',
  phone: '+5511999990000',
  company_id: '22222222-2222-4222-8222-222222222222',
  owner_id: null,
  do_not_contact: false,
};
const company = { id: '22222222-2222-4222-8222-222222222222', name: 'Padaria', phone: '(11) 3000-0000' };

function prompt(overrides: Partial<InteractionPromptValue> = {}): InteractionPromptValue {
  return {
    enabled: mocks.canWrite,
    pending: [],
    track: vi.fn(),
    pendingFor: vi.fn((target) => ({
      key: 'k',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      nextId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      channel: target.channel,
      contactId: target.contactId ?? null,
      companyId: target.companyId ?? null,
      dealId: target.dealId ?? null,
      activityId: target.activityId ?? null,
      openedAt: new Date().toISOString(),
    })),
    dismiss: vi.fn(),
    subjectOf: vi.fn(),
    openDialog: vi.fn(),
    ...overrides,
  };
}
function setup(props: ChannelBarProps, value = prompt()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <InteractionPromptContext.Provider value={value}>{children}</InteractionPromptContext.Provider>
    </QueryClientProvider>
  );
  render(wrap(<ChannelBar {...props} />));
  return value;
}
const button = (name: string) => screen.getByRole('button', { name });
// O Radix abre o menu pelo teclado no jsdom (sem PointerEvent).
const openCallMenu = () => fireEvent.keyDown(button('Ligar'), { key: 'Enter' });

// O jsdom não navega: os links tel: são cancelados depois do React, como no E2E.
const cancelNavigation = (event: MouseEvent) => event.preventDefault();
beforeEach(() => {
  window.addEventListener('click', cancelNavigation);
  mocks.canWrite = true;
  mocks.toast.success.mockReset();
  mocks.toast.message.mockReset();
});
afterEach(() => {
  window.removeEventListener('click', cancelNavigation);
  cleanup();
});

describe('barra de canais (item 1.9)', () => {
  it('mostra WhatsApp, E-mail e Ligar para o contato, com o telefone e o e-mail dele', () => {
    setup({ contact: ana, company });
    const group = screen.getByRole('group', { name: 'Canais de Ana Souza' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['WhatsApp', 'E-mail', 'Ligar']);
    for (const name of ['WhatsApp', 'E-mail', 'Ligar']) expect(button(name)).toBeEnabled();
  });

  it.each([
    [{ ...ana, phone: null }, 'WhatsApp', 'Cadastre um telefone para usar o WhatsApp e a ligação.'],
    [{ ...ana, phone: '99999-0000' }, 'Ligar', 'Confira o telefone no cadastro: ele precisa do DDD.'],
    [{ ...ana, email: null }, 'E-mail', 'Cadastre um e-mail no contato para escrever a ele.'],
    [
      { ...ana, email: 'ana@empresa' },
      'E-mail',
      'Confira o e-mail no cadastro: ele precisa ser um endereço só, como nome@empresa.com.br.',
    ],
  ])('desabilita o controle com o motivo ligado a ele: %#', (contact, name, reason) => {
    setup({ contact });
    expect(button(name)).toBeDisabled();
    expect(button(name)).toHaveAccessibleDescription(reason);
  });

  it('"Não contatar" desliga os três controles, com a explicação ligada a cada um', () => {
    setup({ contact: { ...ana, do_not_contact: true } });
    for (const name of ['WhatsApp', 'E-mail', 'Ligar']) {
      expect(button(name)).toBeDisabled();
      expect(button(name)).toHaveAccessibleDescription('Este contato está marcado como “Não contatar”.');
    }
  });

  it('sem contato, usa o telefone da empresa, a marca dela e explica o e-mail', () => {
    setup({ company: { ...company, do_not_contact: false } });
    expect(screen.getByRole('group', { name: 'Canais de Padaria' })).toBeInTheDocument();
    expect(button('WhatsApp')).toBeEnabled();
    expect(button('E-mail')).toHaveAccessibleDescription(
      'Empresas não têm e-mail no cadastro: use o e-mail de um contato da empresa.',
    );
    cleanup();
    setup({ company: { ...company, do_not_contact: true } });
    expect(button('Ligar')).toHaveAccessibleDescription('Esta empresa está marcada como “Não contatar”.');
  });

  it('número fixo não bloqueia o WhatsApp, que avisa no diálogo', async () => {
    setup({ contact: { ...ana, phone: '(11) 3000-0000' } });
    expect(button('WhatsApp')).toBeEnabled();
    fireEvent.click(button('WhatsApp'));
    const dialog = await screen.findByRole('dialog', { name: 'Mensagem por WhatsApp' });
    expect(dialog).toHaveTextContent('Número fixo: o WhatsApp só funciona se esse número usar o WhatsApp Business.');
  });

  it('o menu Ligar tem o link tel: sem aba nova, "Copiar número" e "Registrar ligação", que cria a pendência', async () => {
    const value = setup({ contact: ana, deal: { id: '33333333-3333-4333-8333-333333333333', title: 'Site' } });
    openCallMenu();
    const call = await screen.findByRole('menuitem', { name: 'Ligar' });
    expect(call).toHaveAttribute('href', 'tel:+5511999990000');
    expect(call).not.toHaveAttribute('target');
    expect(call).toHaveAttribute('rel', 'noopener noreferrer');
    expect(call).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.click(call);
    expect(value.track).toHaveBeenCalledWith({
      channel: 'call',
      contactId: ana.id,
      companyId: ana.company_id,
      dealId: '33333333-3333-4333-8333-333333333333',
      activityId: null,
    });
    openCallMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Registrar ligação' }));
    expect(value.openDialog).toHaveBeenCalledWith(expect.objectContaining({ mode: 'register' }));
    expect((value.openDialog as ReturnType<typeof vi.fn>).mock.calls[0][0].pending).toMatchObject({
      channel: 'call',
      contactId: ana.id,
    });
  });

  it('"Copiar número" copia o E.164 e avisa com o número formatado; sem área de transferência, mostra o número', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const value = setup({ contact: ana });
    openCallMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copiar número' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Número copiado: (11) 99999-0000'));
    expect(writeText).toHaveBeenCalledWith('+5511999990000');
    expect(value.track).toHaveBeenCalledWith(expect.objectContaining({ channel: 'call' }));
    writeText.mockRejectedValueOnce(new Error('sem foco'));
    openCallMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copiar número' }));
    await waitFor(() =>
      expect(mocks.toast.message).toHaveBeenCalledWith('Não foi possível copiar. Número: +5511999990000', {
        duration: 15_000,
      }),
    );
  });

  it('Somente leitura abre os canais, mas não vê "Registrar ligação"', async () => {
    mocks.canWrite = false;
    setup({ contact: ana });
    openCallMenu();
    expect(await screen.findByRole('menuitem', { name: 'Copiar número' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Registrar ligação' })).not.toBeInTheDocument();
  });

  it('a atividade pendente do mesmo canal é a origem do registro; a de outro canal, não', async () => {
    const activity = { id: '44444444-4444-4444-8444-444444444444', type: 'call', completed_at: null };
    const value = setup({ contact: ana, activity, only: 'call' });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').map((item) => item.textContent)).toEqual(['Ligar']);
    openCallMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Registrar ligação' }));
    expect(value.openDialog).toHaveBeenCalledWith(expect.objectContaining({ mode: 'complete' }));
    expect(value.pendingFor).toHaveBeenCalledWith(expect.objectContaining({ activityId: activity.id }));
    cleanup();
    const other = setup({ contact: ana, activity: { ...activity, type: 'email' } });
    openCallMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ligar' }));
    expect(other.track).toHaveBeenCalledWith(expect.objectContaining({ activityId: null }));
  });

  it('mostra as pendências deste alvo, e só as dele, dentro do painel', () => {
    const own = {
      key: `whatsapp:${ana.id}:-`,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      nextId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      channel: 'whatsapp' as const,
      contactId: ana.id,
      companyId: ana.company_id,
      dealId: null,
      activityId: null,
      openedAt: new Date(2026, 9, 13, 14, 5).toISOString(),
    };
    const value = prompt({
      pending: [own, { ...own, key: 'whatsapp:outro:-', contactId: null, channel: 'call' }],
    });
    setup({ contact: ana, showPending: true }, value);
    const list = screen.getByRole('list', { name: 'Para registrar' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('WhatsApp aberto às 14:05');
    fireEvent.click(within(list).getByRole('button', { name: 'Registrar' }));
    expect(value.openDialog).toHaveBeenCalledWith({ mode: 'register', pending: own });
    fireEvent.click(within(list).getByRole('button', { name: 'Agora não' }));
    expect(value.dismiss).toHaveBeenCalledWith(own.key);
  });
});
