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
  it('um canal para um contato marcado "Não contatar" avisa sem bloquear', () => {
    const marked = {
      ...data,
      contacts: [
        { id: 'contact-1', first_name: 'Ana', last_name: null, email: null, phone: null, do_not_contact: true },
      ],
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityDialog
          data={marked as never}
          defaults={{ type: 'whatsapp', contact_id: 'contact-1', title: 'Mensagem' }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Este contato está marcado como “Não contatar”.');
    expect(screen.getByRole('button', { name: 'Salvar atividade' })).toBeEnabled();
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
