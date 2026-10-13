import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingStorageKey } from '@/lib/interactions';
import { useInteractionPrompt } from './interaction-context';

const ANA = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({ canWrite: true, dialog: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: mocks.canWrite }) }));
vi.mock('@/hooks/useCrmSnapshot', () => ({
  useCrmSnapshot: () => ({
    data: {
      contacts: [{ id: ANA, first_name: 'Ana', last_name: 'Souza', email: null, phone: null }],
      companies: [],
      deals: [],
      activities: [],
      members: [],
    },
  }),
}));
// O diálogo do registro tem os próprios testes: aqui basta saber que ele abre com o pedido certo.
vi.mock('./InteractionDialog', () => ({
  InteractionDialog: (props: { request: unknown }) => {
    mocks.dialog(props.request);
    return <div role="dialog" aria-label="Registro" />;
  },
}));

import { InteractionPromptProvider } from './InteractionPromptProvider';

const KEY = pendingStorageKey('org-1', 'user-1');
function Opener({ channel = 'whatsapp' }: { channel?: 'whatsapp' | 'call' }) {
  const prompt = useInteractionPrompt();
  return (
    <button onClick={() => prompt.track({ channel, contactId: ANA })}>
      Abrir {channel} ({prompt.pending.length})
    </button>
  );
}
function setup() {
  return render(
    <InteractionPromptProvider>
      <Opener />
      <Opener channel="call" />
    </InteractionPromptProvider>,
  );
}
const stored = () => JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Record<string, unknown>[];
const dock = () => screen.queryByRole('region', { name: 'Para registrar' });

beforeEach(() => {
  mocks.canWrite = true;
  mocks.dialog.mockReset();
  sessionStorage.clear();
  // O jsdom não mede elementos: com medida, um diálogo no body conta como aberto (src/lib/dialogs.ts).
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('pendências "Para registrar" (item 1.9)', () => {
  it('abrir o mesmo alvo de novo não duplica, e a aba guarda só ids, canal e hora', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    expect(screen.getByRole('button', { name: 'Abrir whatsapp (1)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Abrir call/ }));
    expect(screen.getByRole('button', { name: 'Abrir whatsapp (2)' })).toBeInTheDocument();
    const items = stored();
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items)).not.toMatch(/Ana|Souza/);
    expect(Object.keys(items[0]).sort()).toEqual(
      ['activityId', 'channel', 'companyId', 'contactId', 'dealId', 'id', 'key', 'nextId', 'openedAt'].sort(),
    );
  });

  it('a faixa do rodapé mostra a mais recente com o nome do snapshot, abre o registro e descarta', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    fireEvent.click(screen.getByRole('button', { name: /Abrir call/ }));
    expect(dock()).toHaveTextContent(/Ligação para Ana Souza · \d{2}:\d{2}/);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas (2)' }));
    expect(dock()).toHaveTextContent('WhatsApp para Ana Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Registrar' })[0]);
    expect(mocks.dialog).toHaveBeenCalledWith(expect.objectContaining({ mode: 'register' }));
  });

  it('a faixa some enquanto um diálogo está aberto e volta quando ele fecha', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    expect(dock()).toBeInTheDocument();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    act(() => {
      document.body.appendChild(modal);
    });
    await waitFor(() => expect(dock()).not.toBeInTheDocument());
    act(() => modal.remove());
    await waitFor(() => expect(dock()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(dock()).not.toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('a faixa reserva a altura dela no fim da área de trabalho e devolve o espaço ao sair', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 120,
      width: 10,
      height: 10,
    } as DOMRect);
    const reserve = () => document.documentElement.style.getPropertyValue('--eia-dock-reserve');
    setup();
    expect(reserve()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    // Do topo da faixa ao fim da tela, mais a folga de 8 px.
    expect(reserve()).toBe('128px');
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(dock()).not.toBeInTheDocument();
    expect(reserve()).toBe('');
  });

  it('Somente leitura não recebe pendência', () => {
    mocks.canWrite = false;
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    expect(screen.getByRole('button', { name: 'Abrir whatsapp (0)' })).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(dock()).not.toBeInTheDocument();
  });

  it('volta da aba lendo o armazenamento e anuncia a pendência recente, sem tirar o foco', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir call/ }));
    const focused = document.activeElement;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(
      screen.getByText(/^Ligação aberta às \d{2}:\d{2}\. Quando terminar, use “Registrar” em “Para registrar”\.$/),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(focused);
  });

  it('com o armazenamento bloqueado, a lista fica só em memória e a tela não quebra', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    expect(screen.getByRole('button', { name: 'Abrir whatsapp (1)' })).toBeInTheDocument();
    expect(dock()).toBeInTheDocument();
  });

  it('as pendências sobrevivem a recarregar a aba', () => {
    const first = setup();
    fireEvent.click(screen.getByRole('button', { name: /Abrir whatsapp/ }));
    first.unmount();
    setup();
    expect(screen.getByRole('button', { name: 'Abrir whatsapp (1)' })).toBeInTheDocument();
  });
});
