import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '@/lib/activity-logic';
import type { Contact } from '@/lib/contact-model';

// Item 1.14: Hoje com o recorte de uma pessoa da equipe, o número do menu sempre da conta e a releitura dos lembretes
// que falharam quando a rotina carrega (achado 6 da revisão do 1.12).
const mocks = vi.hoisted(() => ({
  canViewTeam: true,
  canWrite: false,
  retry: vi.fn(),
  refetch: vi.fn(),
  snapshot: {} as Record<string, unknown>,
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' }, profile: { name: 'Pessoa de Teste' }, loading: false }),
}));
vi.mock('@/hooks/useCrmPermissions', () => ({
  useCrmPermissions: () => ({
    canWrite: mocks.canWrite,
    canManage: false,
    canViewTeam: mocks.canViewTeam,
    loading: false,
  }),
}));
vi.mock('@/hooks/useCrmSnapshot', () => ({ useCrmSnapshot: () => mocks.snapshot }));
vi.mock('@/hooks/useActivityReminders', () => ({ useRetryFailedReminders: () => mocks.retry }));
vi.mock('@/integrations/supabase/crm-client', () => ({ crmDb: { from: vi.fn() } }));

import Dashboard from './Dashboard';

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const activity = (id: string, userId: string | null, due: string | null, fields: Partial<Activity> = {}) =>
  ({
    id,
    org_id: 'org-1',
    type: 'task',
    title: `Tarefa ${id}`,
    body: null,
    contact_id: null,
    company_id: null,
    deal_id: null,
    user_id: userId,
    due_date: due,
    end_date: null,
    completed_at: null,
    outcome: null,
    created_by: null,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    ...fields,
  }) as Activity;
const members = [
  { id: 'me', name: 'Pessoa de Teste', email: 'me@example.test', active: true },
  { id: 'bia', name: 'Bia Souza', email: 'bia@example.test', active: true },
  { id: 'fulano', name: 'Fulano Vendedor', email: 'fulano@example.test', active: false },
];
const data = {
  contacts: [] as Contact[],
  companies: [],
  deals: [],
  members,
  pipelines: [],
  stages: [],
  riskRules: [
    {
      id: 'rule-overdue',
      org_id: 'org-1',
      type: 'overdue',
      name: 'Atividades vencidas',
      enabled: true,
      threshold_days: 7,
      priority: 1,
    },
    {
      id: 'rule-owner',
      org_id: 'org-1',
      type: 'no_owner',
      name: 'Sem responsável',
      enabled: true,
      threshold_days: 7,
      priority: 2,
    },
  ],
  activities: [
    activity('minha-vencida', 'me', hoursFromNow(-30)),
    activity('da-bia-1', 'bia', hoursFromNow(-30)),
    activity('da-bia-2', 'bia', hoursFromNow(-26)),
    activity('do-fulano', 'fulano', hoursFromNow(-30)),
  ],
};

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
function mount(path = '/dashboard') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Dashboard />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const stat = (label: string) => screen.getByText(label, { selector: '.eia-stat-label' }).closest('.eia-stat');
const overdueCount = () => within(stat('Vencidas') as HTMLElement).getByText(/^\d+$/).textContent;

/** Contato da carteira de alguém, cadastrado há 10 dias e sem próxima ação. */
const contact = (id: string, ownerId: string) =>
  ({
    id,
    org_id: 'org-1',
    first_name: 'Cliente',
    last_name: id,
    email: null,
    phone: null,
    company_id: null,
    owner_id: ownerId,
    status: 'lead',
    job_title: null,
    source: null,
    notes: null,
    created_at: hoursFromNow(-240),
    updated_at: hoursFromNow(-240),
  }) as Contact;
/** Os dados de `data` com mais pessoas, atividades, contatos ou regras. */
function withData(extra: Partial<typeof data>) {
  mocks.snapshot = { ...mocks.snapshot, data: { ...data, ...extra } };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.canViewTeam = true;
  mocks.canWrite = false;
  mocks.snapshot = {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    dataUpdatedAt: 1,
    refetch: mocks.refetch,
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Hoje com o recorte de uma pessoa (item 1.14)', () => {
  it('“Minha rotina” é o padrão, e a frase liga a lista ao número do menu', () => {
    mount();
    expect(screen.getByRole('combobox', { name: 'Recorte da rotina' })).toHaveTextContent('Minha rotina');
    expect(overdueCount()).toBe('1');
    expect(screen.getByText(/O número ao lado de “Hoje”, no menu, conta as mesmas\./)).toBeTruthy();
    expect(screen.queryByText(/Você está vendo a rotina de/)).toBeNull();
  });

  it('o seletor lista as pessoas da equipe sem a própria conta, com quem foi desativado por último', () => {
    mount();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Recorte da rotina' }), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Minha rotina',
      'Toda a organização',
      'Bia Souza',
      'Fulano Vendedor (desativado)',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Bia Souza' }));
    expect(screen.getByTestId('location').textContent).toBe('?owner=bia');
  });

  it('a rotina de outra pessoa mostra as atividades dela e diz que o número do menu continua sendo o seu', () => {
    mount('/dashboard?owner=bia');
    expect(screen.getByRole('combobox', { name: 'Recorte da rotina' })).toHaveTextContent('Bia Souza');
    expect(screen.getByText('Você está vendo a rotina de Bia Souza.')).toBeTruthy();
    expect(overdueCount()).toBe('2');
    expect(screen.getByText(/O número ao lado de “Hoje”, no menu, continua contando só as suas\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tarefa da-bia-1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tarefa minha-vencida' })).toBeNull();
    expect(screen.getByRole('link', { name: /Ver atividades/ })).toHaveAttribute(
      'href',
      '/activities?owner=bia&status=pending',
    );
  });

  it('a carteira que ficou com quem foi desativado aparece com a marca e o motivo na fila', () => {
    mount('/dashboard?owner=fulano');
    expect(screen.getByText('Você está vendo a rotina de Fulano Vendedor (desativado).')).toBeTruthy();
    expect(overdueCount()).toBe('1');
    expect(screen.getByText('Atividade pendente com responsável desativado.')).toBeTruthy();
    // As pendentes de quem saiu passaram a quem recebeu a carteira (D9): o link abre "Todas", com o histórico.
    expect(screen.getByRole('link', { name: /Ver atividades/ })).toHaveAttribute(
      'href',
      '/activities?owner=fulano&status=all',
    );
  });

  // Revisão do item 1.14: os textos de ajuda do recorte de uma pessoa, testados pela tela, e não só pela função.
  it('o estado vazio dos próximos passos cita a pessoa escolhida', () => {
    withData({
      members: [...members, { id: 'carla', name: 'Carla Lima', email: 'carla@example.test', active: true }],
      activities: [...data.activities, activity('da-carla', 'carla', hoursFromNow(48))],
    });
    mount('/dashboard?owner=carla');
    expect(screen.getByText('Sem pendências com prazo até hoje')).toBeTruthy();
    expect(
      screen.getByText(
        'Carla Lima não tem atividades pendentes com prazo até hoje. Consulte também os itens sem prazo.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tarefa da-carla' })).toBeNull();
  });

  it('o item agrupado da fila fala dos contatos da pessoa escolhida, e não dos seus', () => {
    withData({
      contacts: Array.from({ length: 11 }, (_, n) => contact(`bia-${n}`, 'bia')),
      riskRules: [
        ...data.riskRules,
        {
          id: 'rule-next',
          org_id: 'org-1',
          type: 'no_next_action',
          name: 'Sem próxima ação',
          enabled: true,
          threshold_days: 7,
          priority: 2,
        },
      ],
    });
    mount('/dashboard?owner=bia');
    const group = document.querySelector('[data-attention-group="contacts"]') as HTMLElement;
    expect(within(group).getByText('11 contatos sem próxima ação')).toBeTruthy();
    expect(group.textContent).toContain('Contatos ativos sob a responsabilidade de Bia Souza, cadastrados');
    expect(group.textContent).not.toContain('sob sua responsabilidade');
    cleanup();
    // Na própria rotina, os contatos da Bia não entram.
    mount();
    expect(document.querySelector('[data-attention-group="contacts"]')).toBeNull();
  });

  // Revisão do item 1.14: a atividade nova nasce na rotina que está na tela.
  it('“Nova atividade” começa com a pessoa escolhida; com quem foi desativado, com a conta', () => {
    mocks.canWrite = true;
    mount('/dashboard?owner=bia');
    fireEvent.click(screen.getByRole('button', { name: /^Nova atividade/ }));
    expect(screen.getByLabelText('Responsável')).toHaveTextContent('Bia Souza');
    cleanup();
    mount('/dashboard?owner=fulano');
    fireEvent.click(screen.getByRole('button', { name: /^Nova atividade/ }));
    expect(screen.getByLabelText('Responsável')).toHaveTextContent('Pessoa de Teste');
    cleanup();
    mount('/dashboard?owner=all');
    fireEvent.click(screen.getByRole('button', { name: /^Nova atividade/ }));
    expect(screen.getByLabelText('Responsável')).toHaveTextContent('Pessoa de Teste');
  });

  it('em “Toda a organização”, o número do menu continua sendo o da conta', () => {
    mount('/dashboard?owner=all');
    expect(overdueCount()).toBe('4');
    expect(screen.getByText(/continua contando só as suas\./)).toBeTruthy();
  });

  it('sem ver a equipe, a pessoa da URL vira “Minha rotina” e o seletor não lista pessoas', () => {
    mocks.canViewTeam = false;
    mount('/dashboard?owner=bia');
    expect(screen.getByRole('combobox', { name: 'Recorte da rotina' })).toHaveTextContent('Minha rotina');
    expect(overdueCount()).toBe('1');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Recorte da rotina' }), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Minha rotina',
      'Toda a organização',
    ]);
  });
});

// Achado 6 da revisão do 1.12: o "?" do menu não fica ao lado de uma rotina já carregada.
describe('Hoje refaz as leituras do menu que falharam', () => {
  it('ao ler a rotina com sucesso, uma vez por leitura', () => {
    mount();
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });

  it('no “Tentar novamente”, relê a rotina e os lembretes', () => {
    mocks.snapshot = { ...mocks.snapshot, data: undefined, isError: true, isSuccess: false, dataUpdatedAt: 0 };
    mount();
    expect(mocks.retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});
