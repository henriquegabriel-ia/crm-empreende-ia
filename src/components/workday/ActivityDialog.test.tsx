import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  canWrite: true,
  insert: vi.fn(),
  update: vi.fn(),
  from: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  success: vi.fn(),
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'organization-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useCrmPermissions', () => ({ useCrmPermissions: () => ({ canWrite: mocks.canWrite }) }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));
import { ActivityDialog } from './ActivityDialog';
import type { Activity } from '@/lib/activity-logic';
const data = {
  contacts: [],
  companies: [],
  deals: [],
  activities: [],
  members: [{ id: 'user-1', name: 'Pessoa', email: 'pessoa@example.com' }],
};
function mount(activity?: Activity, defaults = {}) {
  const onSaved = vi.fn(),
    onClose = vi.fn();
  const cache = new QueryClient();
  const content = (record?: Activity) => (
    <QueryClientProvider client={cache}>
      <ActivityDialog data={data} activity={record} defaults={defaults} onSaved={onSaved} onClose={onClose} />
    </QueryClientProvider>
  );
  const view = render(content(activity));
  return { onSaved, onClose, rerender: (record: Activity) => view.rerender(content(record)) };
}
describe('editor único de atividades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canWrite = true;
    const chain = {
      insert: mocks.insert,
      update: mocks.update,
      eq: mocks.eq,
      select: mocks.select,
      single: mocks.single,
      maybeSingle: mocks.maybeSingle,
    };
    mocks.from.mockReturnValue(chain);
    mocks.insert.mockReturnValue(chain);
    mocks.update.mockReturnValue(chain);
    mocks.eq.mockReturnValue(chain);
    mocks.select.mockReturnValue(chain);
    mocks.single.mockResolvedValue({ data: { id: 'activity-1' }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'activity-1' }, error: null });
  });
  afterEach(cleanup);
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  it('ação sem prazo é explícita e mantém vínculos predefinidos na gravação', async () => {
    const { onSaved } = mount(undefined, {
      title: 'Revisar sugestão',
      body: 'Evidência consultada',
      deal_id: 'deal-1',
      contact_id: 'contact-1',
    });
    expect(screen.getByLabelText('Título *')).toHaveValue('Revisar sugestão');
    expect(screen.getByText(/Sem prazo, a atividade aparece/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('activity-1'));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: null,
        end_date: null,
        deal_id: 'deal-1',
        contact_id: 'contact-1',
        org_id: 'organization-1',
        created_by: 'user-1',
      }),
    );
  });
  it('reagendar reunião move término junto e preserva duração de 90 minutos', async () => {
    const activity = {
      id: 'activity-1',
      type: 'meeting',
      title: 'Reunião',
      updated_at: '2026-09-06T10:00:00.123456Z',
      due_date: new Date(2026, 8, 6, 10).toISOString(),
      end_date: new Date(2026, 8, 6, 11, 30).toISOString(),
      body: null,
      user_id: 'user-1',
      contact_id: null,
      company_id: null,
      deal_id: null,
      completed_at: null,
    } as Activity;
    const { onSaved } = mount(activity);
    fireEvent.change(screen.getByLabelText('Início *'), { target: { value: '2026-09-07T14:00' } });
    expect(screen.getByLabelText('Término *')).toHaveValue('2026-09-07T15:30');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: new Date(2026, 8, 7, 14).toISOString(),
        end_date: new Date(2026, 8, 7, 15, 30).toISOString(),
      }),
    );
    expect(mocks.eq).toHaveBeenCalledWith('org_id', 'organization-1');
    expect(mocks.eq).toHaveBeenCalledWith('updated_at', activity.updated_at);
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('completed_at');
  });
  it('falha não apaga sugestão revisada nem fecha diálogo', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { code: 'network' } });
    const { onSaved, onClose } = mount(undefined, { title: 'Sugestão revisável' });
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Minha revisão' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seu preenchimento foi preservado');
    expect(screen.getByLabelText('Título *')).toHaveValue('Minha revisão');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it('preserva revisão e não reabre tarefa concluída por colega, mesmo após atualização das props', async () => {
    const activity = {
      id: 'activity-1',
      org_id: 'organization-1',
      type: 'task',
      title: 'Retorno',
      body: 'Contexto inicial',
      user_id: 'user-1',
      due_date: null,
      end_date: null,
      completed_at: null,
      updated_at: '2026-09-06T10:00:00.123456Z',
    } as Activity;
    const { onSaved, onClose, rerender } = mount(activity);
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Meu retorno revisado' } });
    fireEvent.change(screen.getByLabelText('Detalhes'), { target: { value: 'Minha anotação preservada' } });
    const stored = {
      ...activity,
      completed_at: '2026-09-06T10:05:00.000000Z',
      updated_at: '2026-09-06T10:05:00.000001Z',
    };
    rerender(stored);
    mocks.maybeSingle.mockImplementation(async () => {
      const matches = mocks.eq.mock.calls.every(([column, value]) => stored[column as keyof Activity] === value);
      if (matches) Object.assign(stored, mocks.update.mock.calls.at(-1)![0]);
      return { data: matches ? { id: stored.id } : null, error: null };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta atividade mudou');
    expect(screen.getByLabelText('Título *')).toHaveValue('Meu retorno revisado');
    expect(screen.getByLabelText('Detalhes')).toHaveValue('Minha anotação preservada');
    expect(stored).toEqual(
      expect.objectContaining({
        title: 'Retorno',
        body: 'Contexto inicial',
        completed_at: '2026-09-06T10:05:00.000000Z',
      }),
    );
    expect(mocks.eq).toHaveBeenCalledWith('updated_at', activity.updated_at);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('o padrão nunca cai num responsável desativado, e o seletor não o oferece (item 1.2)', () => {
    const team = {
      ...data,
      members: [
        { id: 'user-1', name: 'Pessoa', email: 'pessoa@example.com', active: true },
        { id: 'user-2', name: 'Bruno', email: 'bruno@example.com', active: false },
      ],
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityDialog data={team} defaults={{ user_id: 'user-2', title: 'Retorno' }} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    const trigger = screen.getByLabelText('Responsável');
    expect(trigger).toHaveTextContent('Pessoa');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Sem responsável', 'Pessoa']);
  });
  // Item 1.9: visita como compromisso, o resultado da ligação concluída e o aviso de "Não contatar".
  it('a visita pede início e término, como a reunião, e os tipos novos aparecem no seletor', async () => {
    const { onSaved } = mount(undefined, {
      type: 'visit',
      title: 'Visitar a fábrica',
      due_date: new Date(2026, 9, 20, 9).toISOString(),
    });
    expect(screen.getByLabelText('Início *')).toHaveValue('2026-10-20T09:00');
    expect(screen.getByLabelText('Término *')).toHaveValue('2026-10-20T10:00');
    fireEvent.keyDown(screen.getByLabelText('Tipo'), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Tarefa',
      'Ligação',
      'WhatsApp',
      'E-mail',
      'Reunião',
      'Visita',
      'Nota',
    ]);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'visit',
        due_date: new Date(2026, 9, 20, 9).toISOString(),
        end_date: new Date(2026, 9, 20, 10).toISOString(),
      }),
    );
    expect(mocks.insert.mock.calls[0][0]).not.toHaveProperty('outcome');
  });
  it('o "Editar" de uma ligação concluída corrige o resultado, e só ela envia o campo', async () => {
    const call = {
      id: 'activity-1',
      type: 'call',
      title: 'Ligação',
      updated_at: '2026-09-06T10:00:00.123456Z',
      due_date: new Date(2026, 8, 6, 10).toISOString(),
      end_date: new Date(2026, 8, 6, 10, 30).toISOString(),
      body: null,
      user_id: 'user-1',
      contact_id: null,
      company_id: null,
      deal_id: null,
      completed_at: '2026-09-06T10:20:00.000000Z',
      outcome: 'no_answer',
    } as Activity;
    const { onSaved } = mount(call);
    const outcome = screen.getByLabelText('Resultado');
    expect(outcome).toHaveTextContent('Não atendeu');
    fireEvent.keyDown(outcome, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Sem resultado',
      'Atendeu',
      'Não atendeu',
      'Caixa postal',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Atendeu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'answered' }));
    cleanup();
    mount({ ...call, completed_at: null } as Activity);
    expect(screen.queryByLabelText('Resultado')).not.toBeInTheDocument();
  });
  it('ligação concluída sem a coluna outcome (banco sem a migração): editar o título não envia o resultado', async () => {
    const legacy = {
      id: 'activity-1',
      type: 'call',
      title: 'Ligação antiga',
      updated_at: '2026-09-06T10:00:00.123456Z',
      due_date: new Date(2026, 8, 6, 10).toISOString(),
      end_date: new Date(2026, 8, 6, 10, 30).toISOString(),
      body: null,
      user_id: 'user-1',
      contact_id: null,
      company_id: null,
      deal_id: null,
      completed_at: '2026-09-06T10:20:00.000000Z',
    } as unknown as Activity;
    const { onSaved } = mount(legacy);
    expect(screen.getByLabelText('Resultado')).toHaveTextContent('Sem resultado');
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Ligação antiga (corrigida)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ligação antiga (corrigida)' }));
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('outcome');
    // Um resultado gravado e mantido também não vai: só a mudança.
    cleanup();
    vi.clearAllMocks();
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'activity-1' }, error: null });
    mount({ ...legacy, outcome: 'answered' } as Activity);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('outcome');
  });
  // Item 1.10: o banco recusa a ação de contato pendente para quem tem "Não contatar"; o formulário só cria esses tipos
  // com "Já aconteceu", travada, e a recusa do banco aparece com a mensagem dele.
  const markedData = {
    ...data,
    contacts: [
      { id: 'contact-1', first_name: 'Ana', last_name: null, email: null, phone: null, do_not_contact: true },
      { id: 'contact-2', first_name: 'Bia', last_name: null, email: null, phone: null, do_not_contact: false },
      {
        id: 'contact-3',
        first_name: 'Contato anonimizado',
        last_name: null,
        email: null,
        phone: null,
        do_not_contact: true,
        anonymized_at: '2026-10-13T12:00:00Z',
      },
    ],
    companies: [{ id: 'company-1', name: 'Padaria', phone: '+551130000000', do_not_contact: true }],
  };
  function mountMarked(defaults: Record<string, unknown>, activity?: Activity) {
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityDialog
          data={markedData as never}
          activity={activity}
          defaults={defaults}
          onSaved={onSaved}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    return { onSaved };
  }
  it('contato marcado: a ação de contato só nasce com "Já aconteceu", travada, e é gravada concluída', async () => {
    const { onSaved } = mountMarked({ type: 'whatsapp', contact_id: 'contact-1', title: 'Mensagem recebida' });
    const happened = screen.getByRole('checkbox', { name: 'Já aconteceu' });
    expect(happened).toBeChecked();
    expect(happened).toBeDisabled();
    expect(happened).toHaveAccessibleDescription(
      'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre aqui o que já aconteceu, ou escolha Tarefa.',
    );
    const when = screen.getByLabelText('Quando aconteceu *');
    // Abre com a hora atual, para registrar na hora.
    expect(when).not.toHaveValue('');
    // O aviso da edição não aparece na criação: a caixa travada já explica.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.change(when, { target: { value: '2026-10-10T09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const at = new Date(2026, 9, 10, 9, 30).toISOString();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'whatsapp', contact_id: 'contact-1', due_date: at, completed_at: at }),
    );
    expect(mocks.success).toHaveBeenCalledWith('Atividade registrada como concluída');
  });
  it('contato marcado: a tarefa continua livre, e "Já aconteceu" volta a ser opcional', () => {
    mountMarked({ type: 'whatsapp', contact_id: 'contact-1', title: 'Preparar contrato' });
    fireEvent.keyDown(screen.getByLabelText('Tipo'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Tarefa' }));
    const happened = screen.getByRole('checkbox', { name: 'Já aconteceu' });
    expect(happened).not.toBeChecked();
    expect(happened).toBeEnabled();
    expect(screen.getByLabelText('Prazo')).toBeInTheDocument();
  });
  it('empresa marcada sem contato: ligação e WhatsApp travados; e-mail, reunião e visita livres', () => {
    mountMarked({ type: 'call', company_id: 'company-1', title: 'Ligação recebida' });
    const happened = () => screen.getByRole('checkbox', { name: 'Já aconteceu' });
    expect(happened()).toBeDisabled();
    expect(happened()).toHaveAccessibleDescription(
      'Esta empresa está marcada como “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Registre aqui o que já aconteceu, ou escolha Tarefa.',
    );
    // A ligação que já aconteceu mostra o resultado, e abre com a hora atual e o término 1 hora depois (o campo é
    // obrigatório no navegador).
    expect(screen.getByLabelText('Resultado')).toHaveTextContent('Sem resultado');
    const start = (screen.getByLabelText('Quando aconteceu *') as HTMLInputElement).value;
    const finish = (screen.getByLabelText('Término *') as HTMLInputElement).value;
    expect(new Date(finish).getTime() - new Date(start).getTime()).toBe(3_600_000);
    for (const type of ['E-mail', 'Reunião', 'Visita']) {
      fireEvent.keyDown(screen.getByLabelText('Tipo'), { key: 'ArrowDown' });
      fireEvent.click(screen.getByRole('option', { name: type }));
      expect(happened(), type).toBeEnabled();
      expect(happened(), type).not.toBeChecked();
    }
  });
  it('contato liberado numa empresa marcada não trava nada', () => {
    mountMarked({ type: 'call', contact_id: 'contact-2', company_id: 'company-1', title: 'Ligar para a Bia' });
    expect(screen.getByRole('checkbox', { name: 'Já aconteceu' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Já aconteceu' })).not.toBeChecked();
  });
  it('"Já aconteceu" em qualquer contato: a hora até agora, o resultado da ligação e a gravação concluída', async () => {
    const { onSaved } = mount(undefined, { type: 'call', title: 'Ligação recebida' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Já aconteceu' }));
    const when = screen.getByLabelText('Quando aconteceu *');
    // A hora atual entra no campo ao marcar.
    expect((when as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    fireEvent.change(when, { target: { value: '2099-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '“Já aconteceu” é o registro do que passou: use um horário até agora.',
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    fireEvent.change(when, { target: { value: '2026-10-12T16:00' } });
    fireEvent.keyDown(screen.getByLabelText('Resultado'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Atendeu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const at = new Date(2026, 9, 12, 16).toISOString();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'call', due_date: at, completed_at: at, outcome: 'answered' }),
    );
  });
  it('a nota não tem "Já aconteceu", e a edição também não', () => {
    mount(undefined, { type: 'note', title: 'Contexto' });
    expect(screen.queryByRole('checkbox', { name: 'Já aconteceu' })).not.toBeInTheDocument();
    cleanup();
    mount({
      id: 'activity-1',
      type: 'call',
      title: 'Ligar',
      updated_at: '2026-09-06T10:00:00.123456Z',
      due_date: new Date(2026, 8, 6, 10).toISOString(),
      end_date: null,
      body: null,
      user_id: 'user-1',
      contact_id: null,
      company_id: null,
      deal_id: null,
      completed_at: null,
    } as Activity);
    expect(screen.queryByRole('checkbox', { name: 'Já aconteceu' })).not.toBeInTheDocument();
  });
  it('a edição de uma ação já agendada para um contato marcado avisa, e a recusa do banco aparece com a mensagem dele', async () => {
    const refusal =
      'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre como concluído o que já aconteceu, ou use uma tarefa para o trabalho interno.';
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: 'P0001', message: refusal } });
    mountMarked({}, {
      id: 'activity-1',
      org_id: 'organization-1',
      type: 'task',
      title: 'Preparar proposta',
      updated_at: '2026-09-06T10:00:00.123456Z',
      due_date: new Date(2026, 8, 6, 10).toISOString(),
      end_date: null,
      body: null,
      user_id: 'user-1',
      contact_id: 'contact-1',
      company_id: null,
      deal_id: null,
      completed_at: null,
    } as Activity);
    fireEvent.keyDown(screen.getByLabelText('Tipo'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Ligação' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Este contato está marcado como “Não contatar”. A ação já agendada continua, e trocar o tipo por outra ação de contato (ligação, WhatsApp, e-mail, reunião ou visita) é recusado.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
  });
  // O aviso segue o que o banco recusa: reunião e visita pendentes do contato marcado também; na empresa sem contato, só
  // ligação e WhatsApp; numa atividade concluída, só reabrir.
  it('o aviso da edição segue o estado da atividade e o alvo marcado', () => {
    const base = {
      org_id: 'organization-1',
      title: 'Ação',
      updated_at: '2026-09-06T10:00:00.123456Z',
      due_date: new Date(2026, 8, 6, 10).toISOString(),
      end_date: null,
      body: null,
      user_id: 'user-1',
      contact_id: null,
      company_id: null,
      deal_id: null,
      completed_at: null,
    };
    mountMarked({}, {
      ...base,
      id: 'activity-1',
      type: 'meeting',
      end_date: new Date(2026, 8, 6, 11).toISOString(),
      contact_id: 'contact-1',
    } as Activity);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Este contato está marcado como “Não contatar”. A ação já agendada continua, e trocar o tipo por outra ação de contato',
    );
    cleanup();
    mountMarked({}, { ...base, id: 'activity-2', type: 'call', company_id: 'company-1' } as Activity);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Esta empresa está marcada como “Não contatar”. A ação já agendada continua, e trocar o tipo por ligação ou WhatsApp é recusado.',
    );
    cleanup();
    // Na empresa sem contato, o e-mail não é recusado: sem aviso.
    mountMarked({}, { ...base, id: 'activity-3', type: 'email', company_id: 'company-1' } as Activity);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    cleanup();
    mountMarked({}, {
      ...base,
      id: 'activity-4',
      type: 'call',
      contact_id: 'contact-1',
      completed_at: new Date(2026, 8, 6, 10).toISOString(),
    } as Activity);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Este contato está marcado como “Não contatar”. Corrigir este registro continua possível, e reabrir é recusado.',
    );
  });
  it('o contato anonimizado não é oferecido para um vínculo novo', () => {
    mountMarked({ title: 'Retorno' });
    fireEvent.keyDown(screen.getByLabelText('Contato'), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Sem contato', 'Ana', 'Bia']);
  });
  it('num banco sem a migração dos canais, explica o que falta', async () => {
    mocks.single.mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: 'new row for relation "activities" violates check constraint "activities_type_check"',
      },
    });
    mount(undefined, { type: 'whatsapp', title: 'Mensagem' });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar atividade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Este CRM ainda não tem a atualização dos canais.');
  });
  it('não grava uma edição para perfil somente de consulta', () => {
    mocks.canWrite = false;
    mount(undefined, { title: 'Somente consulta' });
    expect(screen.getByRole('button', { name: 'Salvar atividade' })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('Título *').closest('form')!);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
