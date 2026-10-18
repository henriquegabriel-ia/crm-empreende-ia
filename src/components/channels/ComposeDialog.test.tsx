import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelPhone } from '@/lib/channels';
import { InteractionPromptContext, type InteractionPromptValue } from './interaction-context';

const mocks = vi.hoisted(() => ({
  templates: [] as Record<string, unknown>[],
  toast: { success: vi.fn() },
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { name: 'Carla Dias' } }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'order']) chain[name] = () => chain;
      chain.range = async () => ({ data: mocks.templates, error: null });
      chain.maybeSingle = async () => ({ data: { name: 'Agência Exemplo' }, error: null });
      return chain;
    },
  },
}));

import { ComposeDialog } from './ComposeDialog';

const template = (id: string, name: string, subject: string, body: string) => ({ id, name, subject, body });
const ANA = { first_name: 'Ana', last_name: 'Souza' };
const TARGET = { channel: 'whatsapp' as const, contactId: '11111111-1111-4111-8111-111111111111' };

function setup(channel: 'whatsapp' | 'email' = 'whatsapp', overrides: Record<string, unknown> = {}) {
  const value: InteractionPromptValue = {
    enabled: true,
    pending: [],
    track: vi.fn(),
    pendingFor: vi.fn(),
    dismiss: vi.fn(),
    subjectOf: vi.fn(),
    openDialog: vi.fn(),
  };
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InteractionPromptContext.Provider value={value}>
        <ComposeDialog
          channel={channel}
          recipientName="Ana Souza"
          phone={channelPhone('+5511999990000')}
          email="ana@example.com"
          doNotContact={false}
          sources={{ contact: ANA, companyName: 'Padaria', dealTitle: null, ownerName: 'Bruno Lima' }}
          target={{ ...TARGET, channel }}
          onClose={onClose}
          {...overrides}
        />
      </InteractionPromptContext.Provider>
    </QueryClientProvider>,
  );
  loaded = () => client.getQueryData(['crm', 'org-1', 'templates']) !== undefined;
  return { value, onClose };
}
let loaded = () => false;
const dialog = () => screen.getByRole('dialog', { name: /Mensagem por/ });
async function chooseTemplate(name: string) {
  // Os modelos chegam por uma consulta: o seletor só os lista depois dela.
  await waitFor(() => expect(loaded()).toBe(true));
  fireEvent.keyDown(within(dialog()).getByLabelText('Modelo'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name }));
}
const cancelNavigation = (event: MouseEvent) => event.preventDefault();

beforeEach(() => {
  window.addEventListener('click', cancelNavigation);
  // O seletor do Radix rola a opção escolhida para a vista; o jsdom não tem scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  mocks.templates = [
    template(
      't1',
      'Primeiro contato',
      'Proposta para a {{empresa}}',
      'Olá, {{primeiro_nome}}! Aqui é {{meu_nome}}, da {{organizacao}}.',
    ),
    template('t2', 'Retorno', '', 'Oi, {{nome}}, sobre {{oportunidade}}.'),
  ];
  mocks.toast.success.mockReset();
});
afterEach(() => {
  window.removeEventListener('click', cancelNavigation);
  vi.restoreAllMocks();
  cleanup();
});

describe('Mensagem por WhatsApp e por e-mail (item 1.9)', () => {
  it('preenche o texto do modelo com as variáveis e abre o wa.me com ele, criando a pendência', async () => {
    const { value, onClose } = setup();
    await chooseTemplate('Primeiro contato');
    const text = 'Olá, Ana! Aqui é Carla Dias, da Agência Exemplo.';
    await waitFor(() => expect(within(dialog()).getByLabelText('Texto')).toHaveValue(text));
    const link = within(dialog()).getByRole('link', { name: 'Abrir no WhatsApp' });
    expect(link).toHaveAttribute('href', `https://wa.me/5511999990000?text=${encodeURIComponent(text)}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    fireEvent.click(link);
    expect(value.track).toHaveBeenCalledWith({ ...TARGET }, undefined);
    expect(onClose).toHaveBeenCalled();
  });

  it('a variável sem dado bloqueia a abertura até a pessoa apagar, e "Copiar texto" continua', async () => {
    setup();
    await chooseTemplate('Retorno');
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Complete ou apague antes de abrir:{{oportunidade}} (sem oportunidade nesta mensagem)',
    );
    const blocked = within(dialog()).getByRole('button', { name: 'Abrir no WhatsApp' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription(/Complete ou apague antes de abrir/);
    expect(within(dialog()).getByRole('button', { name: 'Copiar texto' })).toBeEnabled();
    fireEvent.change(within(dialog()).getByLabelText('Texto'), { target: { value: 'Oi, Ana Souza, sobre o site.' } });
    expect(within(dialog()).getByRole('link', { name: 'Abrir no WhatsApp' })).toBeInTheDocument();
  });

  it('trocar de modelo depois de editar pede confirmação', async () => {
    setup();
    await chooseTemplate('Primeiro contato');
    fireEvent.change(within(dialog()).getByLabelText('Texto'), { target: { value: 'Texto que escrevi' } });
    await chooseTemplate('Retorno');
    const confirm = await screen.findByRole('dialog', { name: 'Trocar o texto pelo do modelo?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(within(dialog()).getByLabelText('Texto')).toHaveValue('Texto que escrevi');
    await chooseTemplate('Retorno');
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Trocar o texto pelo do modelo?' })).getByRole('button', {
        name: 'Trocar o texto',
      }),
    );
    await waitFor(() =>
      expect(within(dialog()).getByLabelText('Texto')).toHaveValue('Oi, Ana Souza, sobre {{oportunidade}}.'),
    );
  });

  it('texto longo demais: copia e abre o WhatsApp sem o texto; com a cópia recusada, seleciona o texto e não abre', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const opened: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      opened.push(`${this.href} ${this.target} ${this.rel} ${this.referrerPolicy}`);
    });
    const { value } = setup();
    const long = 'ação '.repeat(400);
    fireEvent.change(within(dialog()).getByLabelText('Texto'), { target: { value: long } });
    expect(dialog()).toHaveTextContent('O texto é longo demais para abrir pelo link.');
    writeText.mockRejectedValueOnce(new Error('negado'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Copiar texto e abrir sem ele' }));
    const notice = await within(dialog()).findByRole('alert');
    expect(notice).toHaveTextContent('O texto está selecionado');
    // Achado 7 da revisão do item 1.9: a falha de cópia fica ligada às ações que dependem dela.
    expect(within(dialog()).getByRole('button', { name: 'Copiar texto e abrir sem ele' })).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining(notice.id),
    );
    expect(within(dialog()).getByRole('button', { name: 'Copiar texto' })).toHaveAttribute(
      'aria-describedby',
      notice.id,
    );
    expect(opened).toEqual([]);
    expect(value.track).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Copiar texto e abrir sem ele' }));
    await waitFor(() => expect(opened).toEqual(['https://wa.me/5511999990000 _blank noopener noreferrer no-referrer']));
    expect(writeText).toHaveBeenLastCalledWith(long);
    expect(value.track).toHaveBeenCalled();
  });

  it('e-mail: o assunto vem do modelo, e o menu tem os três destinos com a dica do Outlook web', async () => {
    const { value } = setup('email');
    await chooseTemplate('Primeiro contato');
    await waitFor(() => expect(within(dialog()).getByLabelText('Assunto')).toHaveValue('Proposta para a Padaria'));
    fireEvent.keyDown(within(dialog()).getByRole('button', { name: 'Abrir e-mail' }), { key: 'Enter' });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Abrir no Gmail',
      'Abrir no Outlook web',
      'Abrir no aplicativo de e-mail',
    ]);
    expect(screen.getByRole('menu')).toHaveTextContent(
      'Outlook web é para contas Microsoft 365 de trabalho ou escola.',
    );
    const gmail = new URL(items[0].getAttribute('href')!);
    expect(gmail.searchParams.get('su')).toBe('Proposta para a Padaria');
    expect(items[0]).toHaveAttribute('target', '_blank');
    expect(items[2].getAttribute('href')).toMatch(/^mailto:ana@example\.com\?subject=/);
    expect(items[2]).not.toHaveAttribute('target');
    fireEvent.click(items[1]);
    expect(value.track).toHaveBeenCalledWith({ ...TARGET, channel: 'email' }, 'Proposta para a Padaria');
  });

  // Achados 3 e 7 da revisão do item 1.9: o número de outro país funciona, e os avisos que não bloqueiam ficam na caixa
  // de alerta com role="status".
  it('número de outro país: o aviso na caixa de alerta e o wa.me com o código do país', () => {
    setup('whatsapp', { phone: channelPhone('+14155550100') });
    const notice = within(dialog()).getByRole('status');
    expect(notice).toHaveTextContent('Número de outro país.');
    expect(notice).toHaveClass('border-warning/40');
    expect(within(dialog()).getByRole('link', { name: 'Abrir no WhatsApp' }).getAttribute('href')).toMatch(
      /^https:\/\/wa\.me\/14155550100(\?|$)/,
    );
  });

  it('número fixo: o aviso na caixa de alerta, sem bloquear', () => {
    setup('whatsapp', { phone: channelPhone('+551130000000') });
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Número fixo: o WhatsApp só funciona se esse número usar o WhatsApp Business.',
    );
    expect(within(dialog()).getByRole('link', { name: 'Abrir no WhatsApp' })).toBeInTheDocument();
  });

  it('a marca "Não contatar" chegada com o diálogo aberto desliga a abertura', () => {
    setup('whatsapp', { doNotContact: true });
    expect(dialog()).toHaveTextContent('Este cadastro foi marcado como “Não contatar”.');
    expect(within(dialog()).getByRole('button', { name: 'Abrir no WhatsApp' })).toBeDisabled();
  });
});
