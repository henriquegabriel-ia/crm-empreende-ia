import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingInteraction } from '@/lib/interactions';
import { InteractionPromptContext, type InteractionPromptValue, type InteractionRequest } from './interaction-context';

type Row = Record<string, unknown>;
const ME = '99999999-9999-4999-8999-999999999999';
const ANA = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const CALL = '44444444-4444-4444-8444-444444444444';
const mocks = vi.hoisted(() => ({
  data: null as Record<string, unknown[]> | null,
  // O snapshot avisa quem o lê quando muda, como a consulta do React Query depois de invalidateCrmTables.
  listeners: new Set<() => void>(),
  insert: vi.fn(),
  rpc: vi.fn(),
  existing: [] as Row[],
  toast: { success: vi.fn() },
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: ME } }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: true }) }));
vi.mock('@/hooks/useCrmSnapshot', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  };
  return {
    useCrmSnapshot: () => ({ data: useSyncExternalStore(subscribe, () => mocks.data), isError: false }),
  };
});
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/integrations/supabase/crm-client', () => ({
  crmDb: {
    rpc: mocks.rpc,
    from: () => ({
      insert: (rows: Row[]) => ({ select: () => mocks.insert(rows) }),
      select: () => {
        const chain = {
          eq: () => chain,
          in: async (_column: string, ids: string[]) => ({
            data: mocks.existing.filter((row) => ids.includes(String(row.id))),
            error: null,
          }),
        };
        return chain;
      },
    }),
  },
}));

import { InteractionDialog } from './InteractionDialog';

const today = (hour: number) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};
function activity(fields: Row = {}): Row {
  return {
    id: CALL,
    org_id: 'org-1',
    type: 'call',
    title: 'Ligar para a Ana',
    body: 'Plano.',
    contact_id: ANA,
    company_id: COMPANY,
    deal_id: DEAL,
    user_id: ME,
    due_date: today(23),
    end_date: null,
    completed_at: null,
    outcome: null,
    created_by: ME,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00.123456+00:00',
    ...fields,
  };
}
function snapshot(activities: Row[] = []) {
  mocks.data = {
    contacts: [
      {
        id: ANA,
        first_name: 'Ana',
        last_name: 'Souza',
        email: null,
        phone: '+5511999990000',
        company_id: COMPANY,
        owner_id: ME,
      },
    ],
    companies: [{ id: COMPANY, name: 'Padaria', owner_id: ME }],
    deals: [{ id: DEAL, title: 'Site novo', status: 'open', contact_id: ANA, company_id: COMPANY, owner_id: ME }],
    activities,
    members: [{ id: ME, name: 'Carla Dias', email: 'carla@example.com' }],
  };
  mocks.listeners.forEach((listener) => listener());
}
const pending = (fields: Partial<PendingInteraction> = {}): PendingInteraction => ({
  key: `call:${ANA}:${DEAL}`,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  nextId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  channel: 'call',
  contactId: ANA,
  companyId: COMPANY,
  dealId: DEAL,
  activityId: null,
  openedAt: new Date(Date.now() - 60_000).toISOString(),
  ...fields,
});
function setup(request: InteractionRequest) {
  const value: InteractionPromptValue = {
    enabled: true,
    pending: [],
    track: vi.fn(),
    pendingFor: vi.fn(),
    dismiss: vi.fn(),
    subjectOf: vi.fn(() => undefined),
    openDialog: vi.fn(),
  };
  const onClose = vi.fn();
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <InteractionPromptContext.Provider value={value}>
        <InteractionDialog request={request} onClose={onClose} />
      </InteractionPromptContext.Provider>
    </QueryClientProvider>,
  );
  return { value, onClose };
}
const dialog = () => screen.getByRole('dialog');
const CHANGED_REFUSAL = {
  code: 'P0001',
  message: 'Esta atividade mudou ou não está mais disponível. Revise os dados atuais antes de tentar novamente.',
};
const click = (name: string) => fireEvent.click(within(dialog()).getByRole('button', { name }));

beforeEach(() => {
  snapshot();
  mocks.existing = [];
  mocks.insert.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.toast.success.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  // A caixa e os botões de opção do Radix medem o tamanho com ResizeObserver, que o jsdom não tem.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe('registro da interação (item 1.9)', () => {
  it('ligação nova: um só POST com a interação e a próxima ação, as mesmas chaves e os ids da pendência', async () => {
    const { value, onClose } = setup({ mode: 'register', pending: pending() });
    expect(screen.getByRole('dialog', { name: 'Registrar ligação' })).toBeInTheDocument();
    click('Registrar');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Escolha o resultado da ligação.');
    expect(mocks.insert).not.toHaveBeenCalled();
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Não atendeu' }));
    expect(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' })).toBeChecked();
    fireEvent.change(within(dialog()).getByLabelText('Anotação'), { target: { value: 'Caixa cheia.' } });
    click('Registrar');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    const [rows] = mocks.insert.mock.calls[0] as [Row[]];
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(rows[1]).sort());
    expect(rows[0]).toMatchObject({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'call',
      title: 'Ligação para Ana Souza',
      body: 'Caixa cheia.',
      outcome: 'no_answer',
      user_id: ME,
      contact_id: ANA,
      company_id: COMPANY,
      deal_id: DEAL,
    });
    expect(rows[0].completed_at).toBe(rows[0].due_date);
    expect(rows[1]).toMatchObject({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      type: 'call',
      completed_at: null,
      outcome: null,
    });
    expect(value.dismiss).toHaveBeenCalledWith(`call:${ANA}:${DEAL}`);
    expect(mocks.toast.success).toHaveBeenCalledWith('Ligação registrada', {
      description: expect.stringMatching(/^Próxima ação: amanhã às 09:00$/),
    });
  });

  it('uma ligação pendente até o fim do dia vira a sugestão: conclui por complete_activity, ou registra como nova', async () => {
    snapshot([activity()]);
    const { onClose } = setup({ mode: 'register', pending: pending() });
    const suggested = within(dialog()).getByRole('radio', { name: /Concluir “Ligar para a Ana”/ });
    expect(suggested).toBeChecked();
    expect(within(dialog()).queryByLabelText('Quando *')).not.toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Atendeu' }));
    click('Concluir');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.rpc).toHaveBeenCalledWith('complete_activity', {
      p_activity_id: CALL,
      p_version: '2026-10-01T10:00:00.123456+00:00',
      p_outcome: 'answered',
      p_note: null,
      p_next: expect.objectContaining({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        type: 'call',
        user_id: ME,
        contact_id: ANA,
        company_id: COMPANY,
        deal_id: DEAL,
      }),
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    cleanup();
    setup({ mode: 'register', pending: pending() });
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Registrar como nova' }));
    expect(within(dialog()).getByLabelText('Quando *')).toBeInTheDocument();
  });

  it('com duas ligações pendentes, não sugere nenhuma', () => {
    snapshot([activity(), activity({ id: '55555555-5555-4555-8555-555555555555' })]);
    setup({ mode: 'register', pending: pending() });
    expect(within(dialog()).queryByRole('radio', { name: /Concluir “/ })).not.toBeInTheDocument();
    expect(dialog()).toHaveTextContent('Há 2 ligações pendentes para este contato até o fim do dia');
  });

  it('a chave repetida depois de uma resposta perdida é conferida pela leitura e tratada como sucesso', async () => {
    mocks.insert.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    mocks.existing = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }];
    const { onClose, value } = setup({ mode: 'register', pending: pending({ channel: 'whatsapp', key: 'w' }) });
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' }));
    click('Registrar');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(value.dismiss).toHaveBeenCalledWith('w');
    expect(mocks.toast.success).toHaveBeenCalledWith('WhatsApp registrado', undefined);
  });

  it('a chave repetida sem as linhas gravadas mostra o erro e mantém o preenchimento', async () => {
    mocks.insert.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    const { onClose } = setup({ mode: 'register', pending: pending({ channel: 'whatsapp' }) });
    fireEvent.change(within(dialog()).getByLabelText('Anotação'), { target: { value: 'Fica.' } });
    click('Registrar');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Já existe um cadastro com estes dados');
    expect(within(dialog()).getByLabelText('Anotação')).toHaveValue('Fica.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"Concluir e agendar a próxima": a próxima ação é obrigatória, e o conflito relê a atividade para tentar de novo', async () => {
    // A recusa por versão chega junto com a releitura: o colega mudou a atividade, que continua pendente.
    mocks.rpc.mockImplementationOnce(async () => {
      snapshot([activity({ title: 'Ligar para a Ana (revisado)', updated_at: '2026-10-01T11:00:00.654321+00:00' })]);
      return { data: null, error: CHANGED_REFUSAL };
    });
    snapshot([activity()]);
    const { onClose } = setup({ mode: 'complete', activity: activity() as never, requireNext: true });
    expect(screen.getByRole('dialog', { name: 'Concluir e agendar a próxima' })).toBeInTheDocument();
    expect(within(dialog()).queryByRole('checkbox', { name: 'Agendar a próxima ação' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Caixa postal' }));
    fireEvent.change(within(dialog()).getByLabelText('Anotação'), { target: { value: 'Recado.' } });
    fireEvent.change(within(dialog()).getByLabelText('O que precisa acontecer? *'), { target: { value: '' } });
    click('Concluir');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Informe o que precisa acontecer na próxima ação.',
    );
    fireEvent.change(within(dialog()).getByLabelText('O que precisa acontecer? *'), {
      target: { value: 'Ligar de novo' },
    });
    click('Concluir');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Esta atividade mudou ou não está mais disponível.',
    );
    expect(mocks.rpc).toHaveBeenCalledWith('complete_activity', {
      p_activity_id: CALL,
      p_version: '2026-10-01T10:00:00.123456+00:00',
      p_outcome: 'voicemail',
      p_note: 'Recado.',
      p_next: expect.objectContaining({ title: 'Ligar de novo', type: 'call' }),
    });
    // Na conclusão, os vínculos ficam com o banco (copiados da atividade concluída).
    expect(mocks.rpc.mock.calls[0][1].p_next).not.toHaveProperty('contact_id');
    expect(within(dialog()).getByLabelText('Anotação')).toHaveValue('Recado.');
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(
      'Os dados atuais da atividade foram carregados: confira e use “Concluir” de novo.',
    );
    // A atividade continua pendente: nada de "Registrar como nova", que duplicaria a conversa.
    expect(within(dialog()).queryByRole('button', { name: 'Registrar como nova' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // A nova tentativa vale para a versão relida, com o mesmo preenchimento e o mesmo id da próxima ação.
    click('Concluir');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({
      p_activity_id: CALL,
      p_version: '2026-10-01T11:00:00.654321+00:00',
      p_outcome: 'voicemail',
      p_note: 'Recado.',
    });
    expect(mocks.rpc.mock.calls[1][1].p_next.id).toBe(mocks.rpc.mock.calls[0][1].p_next.id);
  });

  it('conflito com a atividade já concluída: não grava de novo nem oferece "Registrar como nova", e tira a pendência', async () => {
    // A tentativa anterior concluiu, mas a resposta se perdeu (ou um colega concluiu antes).
    mocks.rpc.mockImplementationOnce(async () => {
      snapshot([activity({ completed_at: new Date().toISOString(), updated_at: '2026-10-01T11:00:00Z' })]);
      return { data: null, error: CHANGED_REFUSAL };
    });
    snapshot([activity()]);
    const origin = pending({ key: `activity:${CALL}`, activityId: CALL });
    const { value, onClose } = setup({ mode: 'complete', pending: origin });
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Atendeu' }));
    fireEvent.change(within(dialog()).getByLabelText('Anotação'), { target: { value: 'Fechou a visita.' } });
    click('Concluir');
    expect(await within(dialog()).findByText(/Esta atividade já foi concluída/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Concluir' })).toBeDisabled();
    expect(within(dialog()).queryByRole('button', { name: 'Registrar como nova' })).not.toBeInTheDocument();
    expect(within(dialog()).getByLabelText('Anotação')).toHaveValue('Fechou a visita.');
    await waitFor(() => expect(value.dismiss).toHaveBeenCalledWith(`activity:${CALL}`));
    expect(value.dismiss).toHaveBeenCalledTimes(1);
    fireEvent.submit(within(dialog()).getByLabelText('Anotação').closest('form')!);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a pendência cuja atividade de origem já chega concluída abre avisando, sem gravar', () => {
    snapshot([activity({ completed_at: new Date().toISOString() })]);
    const { value } = setup({ mode: 'complete', pending: pending({ key: `activity:${CALL}`, activityId: CALL }) });
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Esta atividade já foi concluída.');
    expect(within(dialog()).getByRole('button', { name: 'Concluir' })).toBeDisabled();
    expect(value.dismiss).toHaveBeenCalledWith(`activity:${CALL}`);
  });

  it('conflito com a atividade excluída: oferece registrar a conversa como nova', async () => {
    mocks.rpc.mockImplementationOnce(async () => {
      snapshot([]);
      return { data: null, error: CHANGED_REFUSAL };
    });
    snapshot([activity()]);
    setup({ mode: 'complete', pending: pending({ key: `activity:${CALL}`, activityId: CALL }) });
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Atendeu' }));
    click('Concluir');
    expect(await within(dialog()).findByText('Esta atividade não está mais disponível.')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Concluir' })).toBeDisabled();
    click('Registrar como nova');
    expect(within(dialog()).getByLabelText('Quando *')).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Registrar' })).toBeEnabled();
  });

  it('"Não contatar": avisa com a concordância certa e não propõe nem exige a próxima ação', () => {
    snapshot([activity()]);
    (mocks.data!.contacts[0] as Row).do_not_contact = true;
    setup({ mode: 'register', pending: pending({ channel: 'whatsapp', dealId: null }) });
    // Item 1.10 (achado 9 da revisão do 1.9): o aviso diz o que a próxima ação pode ser.
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Este contato está marcado como “Não contatar”. Registre o que aconteceu; a próxima ação, se houver, só pode ser uma tarefa interna.',
    );
    expect(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' })).not.toBeChecked();
    // Os tipos de contato ficam desabilitados na próxima ação, com o motivo ligado ao seletor (o banco os recusa).
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' }));
    const type = within(dialog()).getByLabelText('Tipo');
    expect(type).toHaveTextContent('Tarefa');
    expect(type).toHaveAccessibleDescription(
      'Ligação, WhatsApp, e-mail, reunião e visita ficam indisponíveis: este contato está marcado como “Não contatar”.',
    );
    fireEvent.keyDown(type, { key: 'ArrowDown' });
    const disabled = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-disabled') === 'true')
      .map((option) => option.textContent);
    expect(disabled).toEqual(['Ligação', 'WhatsApp', 'E-mail', 'Reunião', 'Visita']);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    cleanup();
    // "Concluir e agendar a próxima" vira um "Concluir" com a próxima ação opcional, do tipo tarefa.
    setup({ mode: 'complete', activity: activity() as never, requireNext: true });
    expect(screen.getByRole('dialog', { name: 'Concluir “Ligar para a Ana”' })).toBeInTheDocument();
    const schedule = within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' });
    expect(schedule).not.toBeChecked();
    fireEvent.click(schedule);
    expect(within(dialog()).getByLabelText('Tipo')).toHaveTextContent('Tarefa');
    cleanup();
    // "Agendar a próxima": o aviso diz que só uma tarefa interna cabe.
    setup({ mode: 'schedule', activity: activity({ completed_at: new Date().toISOString() }) as never });
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Este contato está marcado como “Não contatar”: a próxima ação só pode ser uma tarefa interna, como preparar um documento.',
    );
    cleanup();
    // A empresa sem contato: "Esta empresa está marcada", e só ligação e WhatsApp ficam desabilitados.
    snapshot();
    (mocks.data!.companies[0] as Row).do_not_contact = true;
    setup({ mode: 'register', pending: pending({ contactId: null, key: `call:${COMPANY}:-`, dealId: null }) });
    expect(within(dialog()).getByRole('status')).toHaveTextContent(
      'Esta empresa está marcada como “Não contatar”. Registre o que aconteceu; a próxima ação não pode ser ligação nem WhatsApp para o telefone dela.',
    );
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' }));
    fireEvent.keyDown(within(dialog()).getByLabelText('Tipo'), { key: 'ArrowDown' });
    expect(
      screen
        .getAllByRole('option')
        .filter((option) => option.getAttribute('aria-disabled') === 'true')
        .map((option) => option.textContent),
    ).toEqual(['Ligação', 'WhatsApp']);
  });

  it('sem marca, nenhum tipo da próxima ação fica desabilitado', () => {
    setup({ mode: 'register', pending: pending({ channel: 'whatsapp' }) });
    const type = within(dialog()).getByLabelText('Tipo');
    expect(type).not.toHaveAccessibleDescription(/indisponíveis/);
    fireEvent.keyDown(type, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').some((option) => option.getAttribute('aria-disabled') === 'true')).toBe(false);
  });

  // Achado 9 da revisão do item 1.9: com a empresa como alvo, a frase das pendentes fala da empresa.
  it('com duas ligações pendentes para a empresa sem contato, a frase fala da empresa', () => {
    snapshot([
      activity({ contact_id: null, deal_id: null }),
      activity({ id: '55555555-5555-4555-8555-555555555555', contact_id: null, deal_id: null }),
    ]);
    setup({ mode: 'register', pending: pending({ contactId: null, key: `call:${COMPANY}:-`, dealId: null }) });
    expect(dialog()).toHaveTextContent('Há 2 ligações pendentes para esta empresa até o fim do dia');
  });

  // Achado 4 da revisão do item 1.9: depois de uma resposta perdida, a nova tentativa grava só o que falta.
  it('a tentativa anterior gravou só a interação: a nova grava só a próxima ação que a pessoa marcou depois', async () => {
    mocks.insert
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } })
      .mockResolvedValueOnce({ data: [], error: null });
    mocks.existing = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'WhatsApp para Ana Souza' }];
    const { onClose } = setup({ mode: 'register', pending: pending({ channel: 'whatsapp' }) });
    expect(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' })).toBeChecked();
    click('Registrar');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect((mocks.insert.mock.calls[0][0] as Row[]).map((row) => row.id)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    expect((mocks.insert.mock.calls[1][0] as Row[]).map((row) => row.id)).toEqual([
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('WhatsApp registrado', expect.anything());
  });

  it('a tentativa anterior gravou a próxima ação que a pessoa desmarcou: o sucesso avisa, sem excluir', async () => {
    mocks.insert.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    mocks.existing = [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'WhatsApp para Ana Souza' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'WhatsApp para Ana Souza' },
    ];
    const { onClose } = setup({ mode: 'register', pending: pending({ channel: 'whatsapp' }) });
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Agendar a próxima ação' }));
    click('Registrar');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.toast.success).toHaveBeenCalledWith('WhatsApp registrado', {
      description:
        'A tentativa anterior já tinha criado a próxima ação “WhatsApp para Ana Souza”. Se ela não for mais necessária, conclua ou edite em “Atividades”.',
    });
  });

  // Item 1.10: a recusa do banco ao criar a próxima ação (por exemplo, "Não contatar" marcado por um colega com o
  // diálogo aberto) aparece com a mensagem dele.
  it('a recusa do banco na próxima ação aparece como está', async () => {
    const refusal =
      'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre como concluído o que já aconteceu, ou use uma tarefa para o trabalho interno.';
    mocks.insert.mockResolvedValue({ data: null, error: { code: 'P0001', message: refusal } });
    setup({ mode: 'register', pending: pending({ channel: 'whatsapp' }) });
    click('Registrar');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(refusal);
  });

  it('num banco sem a migração dos canais, explica o que falta', async () => {
    mocks.insert.mockResolvedValue({
      data: null,
      error: { code: 'PGRST204', message: "Could not find the 'outcome' column of 'activities' in the schema cache" },
    });
    setup({ mode: 'register', pending: pending({ channel: 'email' }) });
    click('Registrar');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Este CRM ainda não tem a atualização dos canais. Peça a quem administra para aplicar a migração mais recente.',
    );
  });

  it('"Agendar a próxima" depois de um "Concluir": só a próxima ação, com os vínculos da atividade concluída', async () => {
    const done = activity({ completed_at: new Date().toISOString(), type: 'whatsapp' });
    const { onClose } = setup({ mode: 'schedule', activity: done as never });
    expect(screen.getByRole('dialog', { name: 'Agendar a próxima' })).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText('Anotação')).not.toBeInTheDocument();
    click('Agendar');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [rows] = mocks.insert.mock.calls[0] as [Row[]];
    expect(rows).toEqual([
      expect.objectContaining({
        type: 'whatsapp',
        title: 'WhatsApp para Ana Souza',
        completed_at: null,
        contact_id: ANA,
        company_id: COMPANY,
        deal_id: DEAL,
        user_id: ME,
      }),
    ]);
    expect(mocks.toast.success).toHaveBeenCalledWith('Próxima ação agendada', expect.anything());
  });

  it('o registro não aceita um horário depois de agora mais 5 minutos', async () => {
    setup({ mode: 'register', pending: pending({ channel: 'whatsapp' }) });
    const future = new Date(Date.now() + 60 * 60_000);
    const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    fireEvent.change(within(dialog()).getByLabelText('Quando *'), { target: { value: local } });
    click('Registrar');
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('O registro é do que já aconteceu');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
